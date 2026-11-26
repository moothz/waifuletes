import { FastifyPluginAsync } from 'fastify';
import { RollService } from '../../services/RollService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { UserService } from '../../services/UserService.js';
import { MarketService } from '../../services/MarketService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { Gender, Platform } from '@prisma/client';
import { RollBonuses } from '../../utils/rarityCalculator.js';
import { withBusinessSpan, userIdAttr } from '../../telemetry.js';

export const privateRollRoutes: FastifyPluginAsync = async (fastify) => {
  const cooldownService = new CooldownService(fastify.redis);
  const characterService = new CharacterService(fastify.prisma);
  const userService = new UserService(fastify.prisma, fastify.redis);
  const marketService = new MarketService(fastify.prisma, characterService);
  const rollService = fastify.rollService ?? new RollService(fastify.prisma, cooldownService, characterService);

  // Inicializa o pool em memória em segundo plano no startup (exceto em testes)
  if (process.env.NODE_ENV !== 'test') {
    rollService.loadPool().catch((err) => {
      fastify.log.warn({ err: err.message }, 'Falha ao pré-carregar pool em memória; será carregado sob demanda.');
    });
  }

  fastify.addHook('preHandler', verifyApiKey);

  fastify.post('/roll', {
    schema: {
      description: 'Realiza o sorteio (roll) ponderado de um personagem para o usuário no grupo, com suporte a bônus de doador/evento',
      tags: ['Jogo (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'groupId'],
        additionalProperties: false,
        properties: {
          userId: { type: 'string', maxLength: 64 },
          groupId: { type: 'string', maxLength: 64 },
          name: { type: 'string', maxLength: 128 },
          platform: { type: 'string', enum: ['WHATSAPP', 'TELEGRAM', 'DISCORD'], default: 'WHATSAPP' },
          gender: { type: 'string', enum: ['FEMALE', 'MALE', 'OTHER'] },
          excludeCharacterIds: {
            type: 'array',
            items: { type: 'string', maxLength: 256 },
            maxItems: 100,
            description: 'IDs de personagens a serem excluídos do sorteio (evita repetições em multi-rolls)',
          },
          bonuses: {
            type: 'object',
            additionalProperties: false,
            description: 'Bônus e modificadores dinâmicos de sorteio (ex: doadores de outros projetos, eventos)',
            properties: {
              donorBadge: { type: 'string', maxLength: 64, description: 'Badge ou título do doador para exibição (ex: VIP_OURO, Apoiador 💎)' },
              wishlistMultiplier: { type: 'number', minimum: 0.1, maximum: 100, description: 'Multiplicador de probabilidade para wishlist (padrão: 1.5, teto: 100)' },
              starWishMultiplier: { type: 'number', minimum: 0.1, maximum: 10, description: 'Multiplicador para starwish (padrão: 2.0, teto: 10)' },
              rarityMultipliers: {
                type: 'object',
                additionalProperties: false,
                description: 'Multiplicadores para pesos base de raridade (teto: 10)',
                properties: {
                  COMMON: { type: 'number', minimum: 0.1, maximum: 10 },
                  UNCOMMON: { type: 'number', minimum: 0.1, maximum: 10 },
                  RARE: { type: 'number', minimum: 0.1, maximum: 10 },
                  EPIC: { type: 'number', minimum: 0.1, maximum: 10 },
                  LEGENDARY: { type: 'number', minimum: 0.1, maximum: 10 },
                },
              },
              extraMaxRolls: { type: 'number', minimum: 0, maximum: 500, description: 'Rolls extras concedidos (teto: 500)' },
              isFreeRoll: { type: 'boolean', description: 'Roll gratuito (não consome cooldown de rolls)' },
            },
          },
          bonus: {
            type: 'object',
            additionalProperties: false,
            description: 'Alias para bonuses',
            properties: {
              donorBadge: { type: 'string', maxLength: 64 },
              wishlistMultiplier: { type: 'number', minimum: 0.1, maximum: 100 },
              starWishMultiplier: { type: 'number', minimum: 0.1, maximum: 10 },
              rarityMultipliers: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  COMMON: { type: 'number', minimum: 0.1, maximum: 10 },
                  UNCOMMON: { type: 'number', minimum: 0.1, maximum: 10 },
                  RARE: { type: 'number', minimum: 0.1, maximum: 10 },
                  EPIC: { type: 'number', minimum: 0.1, maximum: 10 },
                  LEGENDARY: { type: 'number', minimum: 0.1, maximum: 10 },
                },
              },
              extraMaxRolls: { type: 'number', minimum: 0, maximum: 500 },
              isFreeRoll: { type: 'boolean' },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as {
        userId: string;
        groupId: string;
        name?: string;
        platform?: Platform;
        gender?: Gender;
        excludeCharacterIds?: string[];
        bonuses?: RollBonuses;
        bonus?: RollBonuses;
      };

      // Auto-cadastro de usuário e grupo na primeira interação (com cache Redis para evitar overhead)
      await userService.ensureUserAndGroup({
        userId: body.userId,
        groupId: body.groupId,
        name: body.name,
        platform: body.platform,
      });

      const activeBonuses = body.bonuses || body.bonus;

      const result = await rollService.roll({
        userId: body.userId,
        groupId: body.groupId,
        genderFilter: body.gender,
        bonuses: activeBonuses,
        excludeCharacterIds: body.excludeCharacterIds,
      });

      if (!result.success) {
        return reply.status(400).send(result);
      }

      try {
        const marketNotif = await marketService.getPendingRollNotification(body.userId);
        if (marketNotif && (result as any).data) {
          (result as any).data.marketNotification = marketNotif;
        }
      } catch (e) {
        // Ignora erro de notificação para não falhar o roll
      }

      return reply.send(result);
    },
  });

  fastify.post('/roll/refund', {
    schema: {
      description: 'Estorna rolls de um usuário quando o envio falha ou ocorre erro na entrega',
      tags: ['Jogo (Privado)'],
      body: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: {
          userId: { type: 'string', maxLength: 64 },
          amount: { type: 'number', minimum: 1, maximum: 50, default: 1 },
          extraMaxRolls: { type: 'number', minimum: 0, maximum: 500 },
          reason: { type: 'string', maxLength: 256 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, amount = 1, extraMaxRolls = 0, reason } = request.body as {
        userId: string;
        amount?: number;
        extraMaxRolls?: number;
        reason?: string;
      };

      return withBusinessSpan(
        'roll.refund',
        {
          'waifu.user.id': userIdAttr(userId),
          'waifu.refund.amount': amount,
          'waifu.refund.reason': reason || 'media_send_failed',
        },
        async () => {
          for (let i = 0; i < amount; i++) {
            await cooldownService.refundRoll(userId, extraMaxRolls);
          }

          const rollsState = await cooldownService.getUserRolls(userId, extraMaxRolls);

          fastify.log.warn(
            { userId, amount, reason, availableRolls: rollsState.availableRolls },
            'Rolls refunded to user'
          );

          return reply.send({
            success: true,
            data: {
              userId,
              refundedAmount: amount,
              availableRolls: rollsState.availableRolls,
              maxRolls: rollsState.maxRolls,
              reason: reason || 'media_send_failed',
            },
          });
        }
      );
    },
  });
};
