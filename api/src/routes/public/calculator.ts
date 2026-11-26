import { FastifyPluginAsync } from 'fastify';
import { config, getLegendaryChanceCap } from '../../config.js';
import { CharacterService } from '../../services/CharacterService.js';
import {
  MarketInvestmentService,
  BASE_DAILY_ZINTHOS,
  BASE_MONEY_SUPPLY,
  INFLATION_ALPHA,
  RARITY_DAYS,
  SCARCITY_BETA,
  COMPETITOR_INVESTMENT_REFUND_RATE,
} from '../../services/MarketInvestmentService.js';
import {
  RARITY_BASE_WEIGHTS,
  RARITY_DIVORCE_VALUES,
  RARITY_KEY_DIVORCE_BONUS,
  SOULMATE_DIVORCE_VALUES,
  MARRIED_KEY_PROGRESSION_WEIGHTS,
  RANK_MULTIPLIER_MAX,
  RANK_MULTIPLIER_EXPONENT,
  DIVORCE_PENALTY_RATE,
} from '../../utils/rarityCalculator.js';

export const publicCalculatorRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const marketService = new MarketInvestmentService(fastify.prisma, characterService, fastify.redis);

  fastify.get('/public/calculator/constants', {
    schema: {
      description: 'Retorna constantes públicas de balanceamento, macroeconomia e contagem do pool para a calculadora de chances',
      tags: ['Público'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    handler: async (_request, reply) => {
      const CACHE_KEY = 'cache:public:calculator:constants:v1';
      try {
        const cached = await fastify.redis.get(CACHE_KEY);
        if (cached) {
          reply.header('Cache-Control', 'public, max-age=60');
          return reply.send({ success: true, data: JSON.parse(cached) });
        }
      } catch {
        // Segue para cálculo direto se o Redis falhar
      }

      const [macro, genderCounts] = await Promise.all([
        marketService.getMacroStats(),
        fastify.prisma.$queryRaw<{ gender: string; count: bigint }[]>`
          SELECT gender::text AS gender, COUNT(*)::bigint AS count
          FROM characters
          WHERE "isActive" = true
          GROUP BY gender
        `,
      ]);

      const genderMap: Record<string, number> = { FEMALE: 0, MALE: 0, OTHER: 0 };
      for (const row of genderCounts) {
        genderMap[row.gender] = Number(row.count);
      }
      const totalActive = genderMap.FEMALE + genderMap.MALE + genderMap.OTHER;

      const payload = {
        pool: {
          totalActive,
          genderCounts: genderMap,
          femaleEligibleRatio: totalActive > 0 ? Number(((genderMap.FEMALE + genderMap.OTHER) / totalActive).toFixed(4)) : 0.5,
          maleEligibleRatio: totalActive > 0 ? Number(((genderMap.MALE + genderMap.OTHER) / totalActive).toFixed(4)) : 0.5,
          byRarity: Object.fromEntries(
            Object.entries(macro.rarityStats).map(([rarity, st]) => [
              rarity,
              {
                total: st.total,
                claimed: st.claimed,
                available: st.available,
                percentageClaimed: st.percentageClaimed,
                scarcityMultiplier: st.scarcityMultiplier,
                days: st.days,
                basePrice: st.basePrice,
                dynamicPrice: st.dynamicPrice,
                cotaPrice: st.cotaPrice,
              },
            ])
          ),
        },
        macro: {
          circulatingKakera: macro.circulatingKakera,
          baseMoneySupply: BASE_MONEY_SUPPLY,
          inflationMultiplier: macro.inflationMultiplier,
          inflationPercent: macro.inflationPercent,
          inflationAlpha: INFLATION_ALPHA,
          scarcityBeta: SCARCITY_BETA,
        },
        constants: {
          rarityBaseWeights: RARITY_BASE_WEIGHTS,
          legendaryChanceCap: getLegendaryChanceCap(),
          weeklyLegendaryHardCap: config.WEEKLY_LEGENDARY_HARD_CAP,
          rollRankMaxDifficulty: config.ROLL_RANK_MAX_DIFFICULTY,
          rollRankRefCutoff: config.ROLL_RANK_REF_CUTOFF,
          rollMaxBase: config.ROLL_MAX_BASE,
          rollRegenSeconds: config.ROLL_REGEN_SECONDS,
          rollRegenAccelFactor: config.ROLL_REGEN_ACCEL_FACTOR,
          rollScrapBonusFactor: config.ROLL_SCRAP_BONUS_FACTOR,
          rollScrapBonusCap: config.ROLL_SCRAP_BONUS_CAP,
          wishlistMaxItems: config.WISHLIST_MAX_ITEMS,
          soulmateKeysRequired: config.SOULMATE_KEYS_REQUIRED,
          soulmateRankingScore: config.SOULMATE_RANKING_SCORE,
          baseDailyZinthos: BASE_DAILY_ZINTHOS,
          rarityDays: RARITY_DAYS,
          marriedKeyProgressionWeights: MARRIED_KEY_PROGRESSION_WEIGHTS,
          rarityDivorceValues: RARITY_DIVORCE_VALUES,
          rarityKeyDivorceBonus: RARITY_KEY_DIVORCE_BONUS,
          soulmateDivorceValues: SOULMATE_DIVORCE_VALUES,
          rankMultiplierMax: RANK_MULTIPLIER_MAX,
          rankMultiplierExponent: RANK_MULTIPLIER_EXPONENT,
          divorcePenaltyRate: DIVORCE_PENALTY_RATE,
          competitorInvestmentRefundRate: COMPETITOR_INVESTMENT_REFUND_RATE,
        },
      };

      try {
        await fastify.redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', 60);
      } catch {
        // Ignora erro de cache
      }

      reply.header('Cache-Control', 'public, max-age=60');
      return reply.send({ success: true, data: payload });
    },
  });
};
