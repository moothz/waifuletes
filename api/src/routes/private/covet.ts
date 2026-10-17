import { FastifyPluginAsync } from 'fastify';
import { CovetService } from '../../services/CovetService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { WishlistService } from '../../services/WishlistService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateCovetRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const wishlistService = new WishlistService(fastify.prisma, characterService);
  const covetService = new CovetService(fastify.prisma, characterService, wishlistService);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.post('/covet', {
    schema: {
      description: 'Cobiça um personagem casado e adiciona à wishlist do usuário',
      tags: ['Cobiçar (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.body as { userId: string; characterId: string };

      try {
        const result = await covetService.covet(userId, characterId);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code || 'COVET_ERROR', message: err.message },
        });
      }
    },
  });
};
