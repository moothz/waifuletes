import { FastifyPluginAsync } from 'fastify';
import { RollService } from '../../services/RollService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { UserService } from '../../services/UserService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { Gender, Platform } from '@prisma/client';
import { RollBonuses } from '../../utils/rarityCalculator.js';

export const privateRollRoutes: FastifyPluginAsync = async (fastify) => {
  const cooldownService = new CooldownService(fastify.redis);
  const characterService = new CharacterService(fastify.prisma);
  const userService = new UserService(fastify.prisma, fastify.redis);
  const rollService = new RollService(fastify.prisma, cooldownService, characterService);

  // Inicializa o pool em memória em segundo plano no startup
  rollService.loadPool().catch((err) => {
    fastify.log.warn({ err: err.message }, 'Falha ao pré-carregar pool em memória; será carregado sob demanda.');
  });

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
              extraMaxRolls: { type: 'number', minimum: 0, maximum: 50, description: 'Rolls extras concedidos (teto: 50)' },
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
              extraMaxRolls: { type: 'number', minimum: 0, maximum: 50 },
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
      });

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });
};
