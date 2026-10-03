import { FastifyPluginAsync } from 'fastify';
import { HaremService } from '../../services/HaremService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateHaremRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma);
  const haremService = new HaremService(fastify.prisma, characterService);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.get('/harem/:userId', {
    schema: {
      description: 'Lista todos os personagens pertencentes ao harém global do usuário',
      tags: ['Harém & Coleção (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          sort: { type: 'string', enum: ['keys', 'date', 'rarity'], default: 'keys' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const query = request.query as any;

      const result = await haremService.getUserHarem(
        userId,
        query.page ? Number(query.page) : 1,
        query.limit ? Number(query.limit) : 20,
        query.sort || 'keys'
      );

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  fastify.patch('/harem/:userId/:characterId/favorite', {
    schema: {
      description: 'Define um personagem do harém como o favorito principal em destaque (firstmarry)',
      tags: ['Harém & Coleção (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.params as { userId: string; characterId: string };
      const result = await haremService.setFavorite(userId, characterId);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  fastify.patch('/harem/:userId/:characterId/note', {
    schema: {
      description: 'Adiciona ou edita uma anotação pessoal para o personagem no harém',
      tags: ['Harém & Coleção (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['note'],
        properties: {
          note: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.params as { userId: string; characterId: string };
      const { note } = request.body as { note: string };

      const result = await haremService.setNote(userId, characterId, note);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  fastify.get('/soulmates/:userId', {
    schema: {
      description: 'Lista todos os Soulmates (personagens com 10+ keys) do usuário',
      tags: ['Harém & Coleção (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const soulmates = await haremService.getSoulmates(userId);

      return reply.send({
        success: true,
        data: soulmates,
      });
    },
  });

  fastify.patch('/soulmates/:userId/:characterId', {
    schema: {
      description: 'Edita o apelido (alias) ou anotação de um Soulmate',
      tags: ['Harém & Coleção (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.params as { userId: string; characterId: string };
      const { alias, note } = request.body as { alias?: string; note?: string };

      const result = await haremService.updateSoulmate(userId, characterId, alias, note);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });
};
