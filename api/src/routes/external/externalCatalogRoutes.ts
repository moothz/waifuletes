import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { verifyExternalApiKey } from '../../plugins/auth.js';
import { config } from '../../config.js';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

const characterQuerySchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
    search: { type: 'string' },
    updatedAfter: { type: 'string' },
    key: { type: 'string' },
    apiKey: { type: 'string' },
  },
  additionalProperties: false,
};

export const externalCatalogRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Todas as rotas neste plugin são protegidas pela chave externa
  fastify.addHook('preHandler', verifyExternalApiKey);

  /**
   * 🎲 GET /pool
   * Retorna o pool leve de sorteio contendo todos os personagens ativos.
   * Usado por nós satélites para carregar em RAM sem precisar importar todo o banco.
   */
  fastify.get('/characters/pool', {
    schema: {
      description: 'Pool leve de sorteio para nós satélites [id, baseRarity, gender]',
      tags: ['External Catalog'],
    },
    handler: async (request, reply) => {
      const items = await fastify.prisma.character.findMany({
        where: { isActive: true },
        select: {
          id: true,
          baseRarity: true,
          gender: true,
        },
      });

      reply.header('Cache-Control', 'public, max-age=1800'); // Cache por 30 minutos
      return {
        success: true,
        count: items.length,
        pool: items,
      };
    },
  });

  /**
   * 🔍 GET /characters/:id
   * Retorna os metadados crus de um personagem específico.
   * Não expõe casamentos, likes, usuários ou dados locais.
   */
  fastify.get('/characters/:id', {
    schema: {
      description: 'Metadados crus de um personagem para JIT Cache em nós satélites',
      tags: ['External Catalog'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const character = await fastify.prisma.character.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          series: true,
          description: true,
          baseRarity: true,
          rank: true,
          gender: true,
          tags: true,
          imageUrls: true,
          addedAt: true,
          updatedAt: true,
        },
      });

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CHARACTER_NOT_FOUND',
            message: `Personagem com ID '${id}' não encontrado no acervo central.`,
          },
        });
      }

      reply.header('Cache-Control', 'public, max-age=3600');
      return {
        success: true,
        data: character,
      };
    },
  });

  /**
   * 📑 GET /characters
   * Lista / busca personagens do acervo com paginação ou filtro incremental.
   */
  fastify.get('/characters', {
    schema: {
      description: 'Lista paginada de personagens crus do acervo central',
      tags: ['External Catalog'],
      querystring: characterQuerySchema,
    },
    handler: async (request, reply) => {
      const query = request.query as {
        page?: number;
        limit?: number;
        search?: string;
        updatedAfter?: string;
      };

      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(1000, Math.max(1, Number(query.limit) || 100));
      const skip = (page - 1) * limit;

      const where: any = { isActive: true };

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { series: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      if (query.updatedAfter) {
        const date = new Date(query.updatedAfter);
        if (!isNaN(date.getTime())) {
          where.updatedAt = { gte: date };
        }
      }

      const [characters, total] = await Promise.all([
        fastify.prisma.character.findMany({
          where,
          skip,
          take: limit,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            series: true,
            description: true,
            baseRarity: true,
            rank: true,
            gender: true,
            tags: true,
            imageUrls: true,
            addedAt: true,
            updatedAt: true,
          },
        }),
        fastify.prisma.character.count({ where }),
      ]);

      return {
        success: true,
        data: {
          characters,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      };
    },
  });

  /**
   * 🖼️ GET /media/*
   * Streaming de imagens locais com autenticação e cache agressivo.
   */
  fastify.get('/media/*', {
    schema: {
      description: 'Streaming autenticado de mídias do acervo com cache HTTP',
      tags: ['External Catalog'],
    },
    handler: async (request, reply) => {
      const rawPath = (request.params as any)['*'] || '';
      const safePath = path.normalize(rawPath).replace(/^(\.\.[\/\\])+/, '');
      const fullPath = path.resolve(config.MEDIA_DIR, safePath);

      // Garante que o caminho não saia da pasta de mídias (prevenção de Directory Traversal)
      if (!fullPath.startsWith(path.resolve(config.MEDIA_DIR))) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Acesso negado a caminho fora do diretório de mídias.' },
        });
      }

      let fileToServe = fullPath;
      if (!fs.existsSync(fileToServe) || fs.statSync(fileToServe).isDirectory()) {
        const defaultPath = path.resolve(config.MEDIA_DIR, 'default.jpg');
        if (fs.existsSync(defaultPath)) {
          fileToServe = defaultPath;
        } else {
          return reply.status(404).send({
            success: false,
            error: { code: 'FILE_NOT_FOUND', message: 'Mídia solicitada não encontrada.' },
          });
        }
      }

      // Detecção de MIME Type
      const ext = path.extname(fileToServe).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.gif') contentType = 'image/gif';

      const stat = fs.statSync(fileToServe);

      reply
        .header('Content-Type', contentType)
        .header('Content-Length', stat.size)
        .header('Cache-Control', 'public, max-age=86400, immutable')
        .header('Last-Modified', stat.mtime.toUTCString());

      return reply.send(fs.createReadStream(fileToServe));
    },
  });
};
