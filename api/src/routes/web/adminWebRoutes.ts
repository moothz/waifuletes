import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { WebSessionService } from '../../services/WebSessionService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { Rarity, SuggestionStatus, SuggestionType } from '@prisma/client';

export const adminWebRoutes: FastifyPluginAsync = async (fastify) => {
  const webSessionService = new WebSessionService(fastify.redis, fastify.prisma);
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);

  /**
   * Middleware para checar autenticação de administrador
   */
  async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (request.headers['x-admin-token']) {
      token = String(request.headers['x-admin-token']).trim();
    } else if ((request.query as any)?.adminToken) {
      token = String((request.query as any).adminToken).trim();
    }

    const isValid = await webSessionService.validateAdminSession(token);
    if (!isValid) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED_ADMIN', message: 'Acesso negado. Senha de administrador requerida ou sessão expirada.' },
      });
    }
  }

  /**
   * Login do Administrador via senha única do .env
   */
  fastify.post('/api/admin/login', {
    schema: {
      description: 'Login no painel administrativo via senha única',
      tags: ['Admin (Web)'],
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { password } = request.body as { password: string };

      const passBuffer = Buffer.from(password || '');
      const expectedBuffer = Buffer.from(config.ADMIN_PASSWORD || '');

      const isMatch =
        passBuffer.length > 0 &&
        passBuffer.length === expectedBuffer.length &&
        timingSafeEqual(passBuffer, expectedBuffer);

      if (!isMatch) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Senha de administrador incorreta.' },
        });
      }

      const session = await webSessionService.createAdminSession();

      return reply.send({
        success: true,
        data: {
          message: 'Login efetuado com sucesso!',
          token: session.token,
          expiresIn: session.expiresIn,
        },
      });
    },
  });

  /**
   * Logout do Administrador
   */
  fastify.post('/api/admin/logout', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Encerra a sessão de administrador',
      tags: ['Admin (Web)'],
    },
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.replace(/^Bearer\s+/, '') || String(request.headers['x-admin-token'] || '');

      await webSessionService.invalidateAdminSession(token);
      return reply.send({
        success: true,
        data: { message: 'Sessão encerrada com sucesso.' },
      });
    },
  });

  /**
   * Verificação de integridade da sessão do admin
   */
  fastify.get('/api/admin/me', {
    preHandler: requireAdminAuth,
    handler: async () => ({
      success: true,
      data: { authenticated: true },
    }),
  });

  /**
   * Edição completa de personagem pelo Admin (nome, descrição, raridade, foto)
   */
  fastify.put('/api/admin/characters/:id', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Atualiza propriedades do personagem e/ou altera sua foto oficial',
      tags: ['Admin (Web)'],
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const character = await fastify.prisma.character.findUnique({
        where: { id },
      });

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CHARACTER_NOT_FOUND', message: 'Personagem não encontrado.' },
        });
      }

      let name = character.name;
      let description = character.description;
      let baseRarity = character.baseRarity;
      let newImageBuffer: Buffer | null = null;

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'name' && part.value) name = String(part.value).trim();
            if (part.fieldname === 'description') description = String(part.value).trim();
            if (part.fieldname === 'baseRarity' && part.value) baseRarity = String(part.value) as Rarity;
          } else if (part.type === 'file' && part.fieldname === 'image') {
            newImageBuffer = await part.toBuffer();
          }
        }
      } else {
        const body = (request.body as any) || {};
        if (body.name) name = String(body.name).trim();
        if (body.description !== undefined) description = String(body.description).trim();
        if (body.baseRarity) baseRarity = body.baseRarity as Rarity;
        if (body.imageBase64) {
          newImageBuffer = Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
      }

      let updatedImageUrls = [...character.imageUrls];

      if (newImageBuffer && newImageBuffer.length > 0) {
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', character.id);
        await fs.mkdir(uploadsDir, { recursive: true });

        const fileName = `${Date.now()}_default.png`;
        const filePath = path.join(uploadsDir, fileName);
        await fs.writeFile(filePath, newImageBuffer);

        const relPath = `uploads/characters/${character.id}/${fileName}`;
        updatedImageUrls = [relPath, ...character.imageUrls];
      }

      const updated = await fastify.prisma.character.update({
        where: { id: character.id },
        data: {
          name,
          description,
          baseRarity,
          imageUrls: updatedImageUrls,
        },
      });

      // Invalida cache de personagens no Redis
      try {
        const keys = await fastify.redis.keys('cache:characters:*');
        if (keys.length > 0) {
          await fastify.redis.del(...keys);
        }
      } catch (_) {}

      return reply.send({
        success: true,
        data: {
          message: `Personagem ${updated.name} atualizado com sucesso!`,
          character: {
            ...updated,
            imageUrl: characterService.getRandomImageUrl(updated.id, updated.imageUrls),
          },
        },
      });
    },
  });

  /**
   * Listagem de sugestões para moderação
   */
  fastify.get('/api/admin/suggestions', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista sugestões de raridade e imagem para aprovação/rejeição',
      tags: ['Admin (Web)'],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'all'], default: 'PENDING' },
          type: { type: 'string', enum: ['RARITY', 'IMAGE'] },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as any;
      const suggestions = await suggestionService.listSuggestions({
        status: query.status as SuggestionStatus | 'all',
        type: query.type as SuggestionType,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
      });

      return reply.send({
        success: true,
        data: suggestions,
      });
    },
  });

  /**
   * Aprovar e aplicar sugestão
   */
  fastify.post('/api/admin/suggestions/:id/approve', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Aprova uma sugestão e aplica a modificação automaticamente ao personagem',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await suggestionService.approveSuggestion(id, 'admin');
      return reply.send(result);
    },
  });

  /**
   * Rejeitar sugestão
   */
  fastify.post('/api/admin/suggestions/:id/reject', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Rejeita uma sugestão de usuário',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          rejectionReason: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { rejectionReason } = (request.body as any) || {};

      const result = await suggestionService.rejectSuggestion(id, rejectionReason, 'admin');
      return reply.send(result);
    },
  });
};
