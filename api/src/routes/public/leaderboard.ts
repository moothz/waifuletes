import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { CharacterService } from '../../services/CharacterService.js';
import { isTrustedRequest } from '../../plugins/auth.js';
import { config } from '../../config.js';
import { SOULMATE_RANKING_SCORES } from '../../utils/rarityCalculator.js';

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
          search: { type: 'string', maxLength: 100 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10, search } = request.query as { limit?: number; search?: string };
      const parsedLimit = Math.min(500, Math.max(1, Number(limit)));
      const cleanSearch = typeof search === 'string' ? search.trim() : '';
      const isTrusted = isTrustedRequest(request);

      const cacheKey = cleanSearch
        ? `cache:leaderboard:users:${parsedLimit}:${encodeURIComponent(cleanSearch.toLowerCase())}`
        : `cache:leaderboard:users:${parsedLimit}`;
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
        const whereCondition: any = {
          NOT: [
            { id: 'test_web_user_1' },
            { name: { contains: 'Jogador Web Teste', mode: 'insensitive' } },
          ],
        };

        if (cleanSearch) {
          whereCondition.OR = [
            { name: { contains: cleanSearch, mode: 'insensitive' } },
            { haremName: { contains: cleanSearch, mode: 'insensitive' } },
          ];
        }

        topRich = await fastify.prisma.user.findMany({
          where: whereCondition,
          take: parsedLimit,
          orderBy: { kakera: 'desc' },
          select: {
            id: true,
            publicId: true,
            name: true,
            platform: true,
            kakera: true,
            haremName: true,
            haremPrivate: true,
            _count: {
              select: {
                harem: true,
                soulmates: true,
              },
            },
          },
        });

        await fastify.redis.set(cacheKey, JSON.stringify(topRich), 'EX', cleanSearch ? 15 : 30);
      }

      // Proteção de PII: Em chamadas anônimas, remove completamente o 'id' (número/telefone do usuário)
      const sanitizedTopRich = topRich.map((u) => {
        if (isTrusted) {
          return u;
        }
        return {
          name: u.name,
          publicId: u.publicId,
          haremName: u.haremName,
          haremPrivate: Boolean(u.haremPrivate),
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
          search: { type: 'string', maxLength: 100 },
        },
      },
    },
    handler: async (request, reply) => {
      const { limit = 10, search } = request.query as { limit?: number; search?: string };
      const parsedLimit = Math.min(500, Math.max(1, Number(limit)));
      const cleanSearch = typeof search === 'string' ? search.trim() : '';
      const isTrusted = isTrustedRequest(request);

      const cacheKey = cleanSearch
        ? `cache:leaderboard:harem:${parsedLimit}:${encodeURIComponent(cleanSearch.toLowerCase())}`
        : `cache:leaderboard:harem:${parsedLimit}`;
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
        const searchFilter = cleanSearch
          ? Prisma.sql`AND (LOWER(u.name) LIKE ${'%' + cleanSearch.toLowerCase() + '%'} OR LOWER(COALESCE(u.harem_name, '')) LIKE ${'%' + cleanSearch.toLowerCase() + '%'})`
          : Prisma.empty;

        topHarem = await fastify.prisma.$queryRaw`
          WITH user_harem_stats AS (
            SELECT 
              u.id,
              u."publicId",
              u.name,
              u.platform,
              u.harem_name as "haremName",
              u.harem_private as "haremPrivate",
              count(h.id) FILTER (WHERE c.is_mythic IS NOT TRUE)::int as "totalMarriages",
              count(h.id) FILTER (WHERE c."baseRarity" = 'COMMON' AND c.is_mythic IS NOT TRUE)::int as "commonCount",
              count(h.id) FILTER (WHERE c."baseRarity" = 'UNCOMMON' AND c.is_mythic IS NOT TRUE)::int as "uncommonCount",
              count(h.id) FILTER (WHERE c."baseRarity" = 'RARE' AND c.is_mythic IS NOT TRUE)::int as "rareCount",
              count(h.id) FILTER (WHERE c."baseRarity" = 'EPIC' AND c.is_mythic IS NOT TRUE)::int as "epicCount",
              count(h.id) FILTER (WHERE c."baseRarity" = 'LEGENDARY' AND c.is_mythic IS NOT TRUE)::int as "legendaryCount",
              coalesce(sum(h.keys) FILTER (WHERE c.is_mythic IS NOT TRUE), 0)::int as "totalKeys",
              (SELECT count(*)::int FROM soulmates s WHERE s."userId" = u.id) as "totalSoulmates",
              (
                SELECT coalesce(sum(
                  CASE sc."baseRarity"::text
                    WHEN 'LEGENDARY' THEN ${SOULMATE_RANKING_SCORES.LEGENDARY}
                    WHEN 'EPIC' THEN ${SOULMATE_RANKING_SCORES.EPIC}
                    WHEN 'RARE' THEN ${SOULMATE_RANKING_SCORES.RARE}
                    WHEN 'UNCOMMON' THEN ${SOULMATE_RANKING_SCORES.UNCOMMON}
                    WHEN 'COMMON' THEN ${SOULMATE_RANKING_SCORES.COMMON}
                    ELSE 0
                  END
                ), 0)::int
                FROM soulmates s
                JOIN characters sc ON sc.id = s."characterId"
                WHERE s."userId" = u.id AND sc.is_mythic IS NOT TRUE
              ) as "soulmatePoints"
            FROM users u
            JOIN harem_entries h ON h."userId" = u.id
            JOIN characters c ON c.id = h."characterId"
            WHERE u.id != 'test_web_user_1' AND LOWER(u.name) NOT LIKE '%jogador web teste%'
            ${searchFilter}
            GROUP BY u.id, u."publicId", u.name, u.platform, u.harem_name, u.harem_private
          )
          SELECT 
            id,
            "publicId",
            name,
            platform,
            "haremName",
            "haremPrivate",
            "totalMarriages",
            "commonCount",
            "uncommonCount",
            "rareCount",
            "epicCount",
            "legendaryCount",
            "totalKeys",
            "totalSoulmates",
            (
              -- Comum com Diminishing Returns (até 200 @ 2pts, 201-600 @ 1pt, 601+ @ 0.5pt)
              LEAST("commonCount", 200) * 2 +
              GREATEST(0, LEAST("commonCount" - 200, 400)) * 1 +
              FLOOR(GREATEST(0, "commonCount" - 600) * 0.5)::int +

              -- Incomum com Diminishing Returns (até 150 @ 6pts, 151-400 @ 3pts, 401+ @ 1pt)
              LEAST("uncommonCount", 150) * 6 +
              GREATEST(0, LEAST("uncommonCount" - 150, 250)) * 3 +
              GREATEST(0, "uncommonCount" - 400) * 1 +

              -- Raro com Diminishing Returns (até 100 @ 20pts, 101-250 @ 10pts, 251+ @ 5pts)
              LEAST("rareCount", 100) * 20 +
              GREATEST(0, LEAST("rareCount" - 100, 150)) * 10 +
              GREATEST(0, "rareCount" - 250) * 5 +

              -- Épico com Diminishing Returns (até 50 @ 60pts, 51-100 @ 30pts, 101+ @ 15pts)
              LEAST("epicCount", 50) * 60 +
              GREATEST(0, LEAST("epicCount" - 50, 50)) * 30 +
              GREATEST(0, "epicCount" - 100) * 15 +

              -- Lendário SEM Diminishing Returns (200 pts integrais sempre)
              "legendaryCount" * 200 +

              -- Chaves e Soulmates escaladas por raridade
              "totalKeys" * 1 +
              "soulmatePoints"
            )::int as "collectionPoints"
          FROM user_harem_stats
          ORDER BY "collectionPoints" DESC, "totalMarriages" DESC
          LIMIT ${parsedLimit}
        `;

        await fastify.redis.set(cacheKey, JSON.stringify(topHarem), 'EX', cleanSearch ? 15 : 30);
      }

      const sanitizedTopHarem = (topHarem || []).map((u: any) => {
        if (isTrusted) {
          return u;
        }
        const { id, platform, ...rest } = u;
        return {
          ...rest,
          haremPrivate: Boolean(u.haremPrivate),
        };
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
