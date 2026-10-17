import { FastifyPluginAsync } from 'fastify';
import { MarketService } from '../../services/MarketService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateMarketRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const marketService = new MarketService(fastify.prisma, characterService);

  fastify.addHook('preHandler', verifyApiKey);

  /**
   * POST /market/listing - Anuncia uma waifu nos classificados via comando WhatsApp
   */
  fastify.post('/market/listing', {
    schema: {
      description: 'Anuncia um personagem nos classificados globais via comando bot',
      tags: ['Mercado (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'characterId', 'interest'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
          interest: { type: 'string', maxLength: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId, interest } = request.body as {
        userId: string;
        characterId: string;
        interest: string;
      };

      const listing = await marketService.createListing(userId, characterId, interest);
      return reply.send({ success: true, data: listing });
    },
  });

  /**
   * GET /market/listings - Lista classificados para o comando !mu-classificados
   */
  fastify.get('/market/listings', {
    schema: {
      description: 'Lista classificados globais paginados e ordenados',
      tags: ['Mercado (Privado)'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          sortBy: { type: 'string', enum: ['rarity', 'wishlist', 'popularity', 'recent'], default: 'rarity' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as {
        search?: string;
        sortBy?: 'rarity' | 'wishlist' | 'popularity' | 'recent';
        page?: number;
        limit?: number;
      };

      const result = await marketService.listGlobalListings(query);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * GET /market/offers - Lista ofertas recebidas pendentes para o comando !mu-ofertas
   */
  fastify.get('/market/offers', {
    schema: {
      description: 'Lista ofertas pendentes recebidas pelo usuário',
      tags: ['Mercado (Privado)'],
      querystring: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.query as { userId: string };
      const offers = await marketService.getUserReceivedOffers(userId);
      return reply.send({ success: true, data: offers });
    },
  });

  /**
   * POST /market/offers/:offerId/accept - Aceita oferta via comando !mu-of-aceitar
   */
  fastify.post('/market/offers/:offerId/accept', {
    schema: {
      description: 'Aceita uma proposta de classificados via comando bot',
      tags: ['Mercado (Privado)'],
      params: {
        type: 'object',
        required: ['offerId'],
        properties: {
          offerId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { offerId } = request.params as { offerId: string };
      const { userId } = request.body as { userId: string };

      const result = await marketService.acceptOffer(userId, offerId);
      return reply.send(result);
    },
  });

  /**
   * POST /market/offers/:offerId/reject - Nega oferta via comando !mu-of-negar
   */
  fastify.post('/market/offers/:offerId/reject', {
    schema: {
      description: 'Nega uma proposta de classificados via comando bot',
      tags: ['Mercado (Privado)'],
      params: {
        type: 'object',
        required: ['offerId'],
        properties: {
          offerId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { offerId } = request.params as { offerId: string };
      const { userId } = request.body as { userId: string };

      const offer = await marketService.rejectOffer(userId, offerId);
      return reply.send({ success: true, data: offer });
    },
  });
};
