import { FastifyPluginAsync } from 'fastify';
import { verifyApiKey } from '../../plugins/auth.js';
import { CollectionService } from '../../services/CollectionService.js';
import { CharacterService } from '../../services/CharacterService.js';

export const privateCollectionRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const collectionService = new CollectionService(fastify.prisma, characterService);

  /**
   * Lista coleções do usuário
   */
  fastify.get('/user/:userId/collections', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Lista todas as coleções de waifus pertencentes a um usuário',
      tags: ['Coleções (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const data = await collectionService.listUserCollections(userId);
      return reply.send({ success: true, data });
    },
  });

  /**
   * Cria uma nova coleção para o usuário (máx 15)
   */
  fastify.post('/user/:userId/collections', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Cria uma nova coleção de personagens para o usuário (limite de 15)',
      tags: ['Coleções (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string', maxLength: 200 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as { name: string; description?: string };
      const result = await collectionService.createCollection(userId, body.name, body.description);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Apaga uma coleção (os personagens permanecem no harém geral)
   */
  fastify.delete('/user/:userId/collections/:collectionId', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Remove uma coleção do usuário, desvinculando os personagens de volta ao harém geral',
      tags: ['Coleções (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'collectionId'],
        properties: {
          userId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, collectionId } = request.params as { userId: string; collectionId: string };
      const result = await collectionService.deleteCollection(userId, collectionId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Adiciona um personagem à coleção
   */
  fastify.post('/user/:userId/collections/:collectionId/characters', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Adiciona um personagem do harém à coleção especificada',
      tags: ['Coleções (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'collectionId'],
        properties: {
          userId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['characterId'],
        additionalProperties: false,
        properties: {
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, collectionId } = request.params as { userId: string; collectionId: string };
      const { characterId } = request.body as { characterId: string };
      const result = await collectionService.addCharacterToCollection(userId, collectionId, characterId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Remove um personagem da coleção
   */
  fastify.delete('/user/:userId/collections/:collectionId/characters/:characterId', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Remove um personagem de sua coleção atual',
      tags: ['Coleções (Privado)'],
      params: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          collectionId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.params as { userId: string; characterId: string };
      const result = await collectionService.removeCharacterFromCollection(userId, characterId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Remove um personagem de qualquer coleção de volta ao harém geral
   */
  fastify.delete('/user/:userId/collections/characters/:characterId', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Remove um personagem de qualquer coleção em que esteja',
      tags: ['Coleções (Privado)'],
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
      const result = await collectionService.removeCharacterFromCollection(userId, characterId);
      return reply.send({ success: true, data: result });
    },
  });
};
