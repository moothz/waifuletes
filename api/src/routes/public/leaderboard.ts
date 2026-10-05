import { FastifyPluginAsync } from 'fastify';
import { CharacterService } from '../../services/CharacterService.js';
import { isTrustedRequest } from '../../plugins/auth.js';

export const publicLeaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);

  fastify.get('/leaderboard/characters', {
    schema: {
      description: 'Ranking público de personagens mais populares por casamento e curtidas',
      tags: ['Rankings (Público)'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10 } = request.query as { limit?: number };
      const parsedLimit = Math.min(50, Math.max(1, Number(limit)));
      const isTrusted = isTrustedRequest(request);

      const cacheKey = `cache:leaderboard:characters:${parsedLimit}`;
      const cached = await fastify.redis.get(cacheKey);

      let data;
      if (cached) {
        try {
          data = JSON.parse(cached);
        } catch (_) {}
      }

      if (!data) {
        const [topClaimed, topLiked] = await Promise.all([
          fastify.prisma.character.findMany({
            where: { isActive: true },
            take: parsedLimit,
            orderBy: [{ claimCount: 'desc' }, { likeCount: 'desc' }],
          }),
          fastify.prisma.character.findMany({
            where: { isActive: true },
            take: parsedLimit,
            orderBy: [{ likeCount: 'desc' }, { claimCount: 'desc' }],
          }),
        ]);

        data = {
          topClaimed: topClaimed.map((c) => ({
            ...c,
            imageUrl: characterService.getRandomImageUrl(c.id, c.imageUrls),
            imageUrls: c.imageUrls.map((img) => characterService.formatImageUrl(c.id, img)),
          })),
          topLiked: topLiked.map((c) => ({
            ...c,
            imageUrl: characterService.getRandomImageUrl(c.id, c.imageUrls),
            imageUrls: c.imageUrls.map((img) => characterService.formatImageUrl(c.id, img)),
          })),
        };

        await fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', 30);
      }

      if (!isTrusted) {
        reply.header('Cache-Control', 'public, max-age=30');
      }

      return reply.send({
        success: true,
        data,
      });
    },
  });

  fastify.get('/leaderboard/users', {
    schema: {
      description: 'Ranking público de usuários por saldo de moeda Kakera e tamanho de harém',
      tags: ['Rankings (Público)'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10 } = request.query as { limit?: number };
      const parsedLimit = Math.min(50, Math.max(1, Number(limit)));
      const isTrusted = isTrustedRequest(request);

      const cacheKey = `cache:leaderboard:users:${parsedLimit}`;
      const cached = await fastify.redis.get(cacheKey);

      let topRich: any[] | null = null;
      if (cached) {
        try {
          topRich = JSON.parse(cached);
        } catch (_) {
          topRich = null;
        }
      }

      if (!topRich || topRich.length === 0) {
        topRich = await fastify.prisma.user.findMany({
          take: parsedLimit,
          orderBy: { kakera: 'desc' },
          select: {
            id: true,
            name: true,
            platform: true,
            kakera: true,
            _count: {
              select: {
                harem: true,
                soulmates: true,
              },
            },
          },
        });

        await fastify.redis.set(cacheKey, JSON.stringify(topRich), 'EX', 30);
      }

      // Proteção de PII: Em chamadas anônimas, remove completamente o 'id' (número/telefone do usuário)
      const sanitizedTopRich = topRich.map((u) => {
        if (isTrusted) {
          return u;
        }
        return {
          name: u.name,
          platform: u.platform,
          kakera: u.kakera,
          _count: u._count,
        };
      });

      if (!isTrusted) {
        reply.header('Cache-Control', 'public, max-age=30');
      }

      return reply.send({
        success: true,
        data: {
          topRich: sanitizedTopRich,
        },
      });
    },
  });
};
