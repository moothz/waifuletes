import { FastifyPluginAsync } from 'fastify';
import { WishlistService } from '../../services/WishlistService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateWishlistRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma);
  const wishlistService = new WishlistService(fastify.prisma, characterService);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.get('/wishlist/:userId', {
    schema: {
      description: 'Consulta a lista de desejos (wishlist) de personagens do usuário',
      tags: ['Wishlist (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const wishlist = await wishlistService.getWishlist(userId);

      return reply.send({
        success: true,
        data: wishlist,
      });
    },
  });

  fastify.post('/wishlist', {
    schema: {
      description: 'Adiciona ou atualiza um personagem na lista de desejos (com suporte a Starwish)',
      tags: ['Wishlist (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
          isStarWish: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId, isStarWish = false } = request.body as {
        userId: string;
        characterId: string;
        isStarWish?: boolean;
      };

      const result = await wishlistService.addToWishlist(userId, characterId, isStarWish);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  fastify.delete('/wishlist/:userId/:characterId', {
    schema: {
      description: 'Remove um personagem da lista de desejos do usuário',
      tags: ['Wishlist (Privado)'],
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
      const { userId, characterId } = request.params as {
        userId: string;
        characterId: string;
      };

      const result = await wishlistService.removeFromWishlist(userId, characterId);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });
};
