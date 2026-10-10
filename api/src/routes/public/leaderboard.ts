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
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10 } = request.query as { limit?: number };
      const parsedLimit = Math.min(500, Math.max(1, Number(limit)));
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

  fastify.get('/leaderboard/harem', {
    schema: {
      description: 'Ranking público de jogadores por pontuação de coleção do Harém (raridade e laços)',
      tags: ['Rankings (Público)'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10 } = request.query as { limit?: number };
      const parsedLimit = Math.min(500, Math.max(1, Number(limit)));
      const isTrusted = isTrustedRequest(request);

      const cacheKey = `cache:leaderboard:harem:${parsedLimit}`;
      const cached = await fastify.redis.get(cacheKey);

      let topHarem: any[] | null = null;
      if (cached) {
        try {
          topHarem = JSON.parse(cached);
        } catch (_) {
          topHarem = null;
        }
      }

      if (!topHarem || topHarem.length === 0) {
        topHarem = await fastify.prisma.$queryRaw`
          SELECT 
            u.id,
            u.name,
            u.platform,
            count(h.id)::int as "totalMarriages",
            count(h.id) FILTER (WHERE c."baseRarity" = 'COMMON')::int as "commonCount",
            count(h.id) FILTER (WHERE c."baseRarity" = 'UNCOMMON')::int as "uncommonCount",
            count(h.id) FILTER (WHERE c."baseRarity" = 'RARE')::int as "rareCount",
            count(h.id) FILTER (WHERE c."baseRarity" = 'EPIC')::int as "epicCount",
            count(h.id) FILTER (WHERE c."baseRarity" = 'LEGENDARY')::int as "legendaryCount",
            coalesce(sum(h.keys), 0)::int as "totalKeys",
            (SELECT count(*)::int FROM soulmates s WHERE s."userId" = u.id) as "totalSoulmates",
            (
              count(h.id) FILTER (WHERE c."baseRarity" = 'COMMON') * 2 +
              count(h.id) FILTER (WHERE c."baseRarity" = 'UNCOMMON') * 6 +
              count(h.id) FILTER (WHERE c."baseRarity" = 'RARE') * 20 +
              count(h.id) FILTER (WHERE c."baseRarity" = 'EPIC') * 60 +
              count(h.id) FILTER (WHERE c."baseRarity" = 'LEGENDARY') * 200 +
              coalesce(sum(h.keys), 0) * 1 +
              (SELECT count(*)::int FROM soulmates s WHERE s."userId" = u.id) * 25
            )::int as "collectionPoints"
          FROM users u
          JOIN harem_entries h ON h."userId" = u.id
          JOIN characters c ON c.id = h."characterId"
          GROUP BY u.id, u.name, u.platform
          ORDER BY "collectionPoints" DESC, "totalMarriages" DESC
          LIMIT ${parsedLimit}
        `;

        await fastify.redis.set(cacheKey, JSON.stringify(topHarem), 'EX', 30);
      }

      const sanitizedTopHarem = (topHarem || []).map((u: any) => {
        if (isTrusted) {
          return u;
        }
        const { id, platform, ...rest } = u;
        return rest;
      });

      if (!isTrusted) {
        reply.header('Cache-Control', 'public, max-age=30');
      }

      return reply.send({
        success: true,
        data: {
          topHarem: sanitizedTopHarem,
        },
      });
    },
  });
};
