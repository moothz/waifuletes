import { FastifyPluginAsync } from 'fastify';
import { CharacterService } from '../../services/CharacterService.js';
import { isTrustedRequest } from '../../plugins/auth.js';
import { Rarity, Gender } from '@prisma/client';

export const publicCharacterRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);

  fastify.get('/characters', {
    schema: {
      description: 'Consulta pública de personagens cadastrados com filtros e paginação',
      tags: ['Personagens (Público)'],
      querystring: {
        type: 'object',
        properties: {
          series: { type: 'string' },
          rarity: { type: 'string', enum: ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] },
          gender: { type: 'string', enum: ['FEMALE', 'MALE', 'OTHER'] },
          tag: { type: 'string' },
          search: { type: 'string' },
          maritalStatus: { type: 'string', enum: ['all', 'single', 'married'] },
          page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as any;
      const isTrusted = isTrustedRequest(request);

      let cacheKey: string | null = null;
      if (!isTrusted) {
        cacheKey = `cache:characters:list:${JSON.stringify(query)}`;
        const cached = await fastify.redis.get(cacheKey);
        if (cached) {
          try {
            reply.header('Cache-Control', 'public, max-age=30');
            return reply.send({
              success: true,
              data: JSON.parse(cached),
            });
          } catch (_) {}
        }
      }

      const result = await characterService.listCharacters(
        {
          series: query.series,
          rarity: query.rarity as Rarity,
          gender: query.gender as Gender,
          tag: query.tag,
          search: query.search,
          maritalStatus: query.maritalStatus,
          page: query.page ? Math.min(1000, Math.max(1, Number(query.page))) : 1,
          limit: query.limit ? Math.min(100, Math.max(1, Number(query.limit))) : 20,
        },
        isTrusted
      );

      if (!isTrusted) {
        reply.header('Cache-Control', 'public, max-age=30');
        if (cacheKey) {
          await fastify.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
        }
      }

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  fastify.get('/characters/stats', {
    schema: {
      description: 'Retorna estatísticas da base de dados de personagens e probabilidades de sorteio por raridade',
      tags: ['Personagens (Público)'],
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Permitido apenas em requisições autenticadas' },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as any;
      const isTrusted = isTrustedRequest(request);

      // Proteção de PII: userId é aceito exclusivamente para bots/clientes autenticados
      const authorizedUserId = isTrusted ? query.userId : undefined;
      const stats = await characterService.getStats(authorizedUserId);

      if (!isTrusted && !authorizedUserId) {
        reply.header('Cache-Control', 'public, max-age=30');
      }

      return reply.send({
        success: true,
        data: stats,
      });
    },
  });

  fastify.get('/characters/:id', {
    schema: {
      description: 'Obtém detalhes de um personagem específico por ID/slug',
      tags: ['Personagens (Público)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const isTrusted = isTrustedRequest(request);
      const character = await characterService.getCharacterById(id, isTrusted);

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CHARACTER_NOT_FOUND',
            message: 'Personagem não encontrado.',
          },
        });
      }

      if (!isTrusted) {
        reply.header('Cache-Control', 'public, max-age=30');
      }

      return reply.send({
        success: true,
        data: character,
      });
    },
  });
};
