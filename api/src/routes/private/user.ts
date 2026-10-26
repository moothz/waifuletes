import { FastifyPluginAsync } from 'fastify';
import { UserService } from '../../services/UserService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { Platform } from '@prisma/client';

export const privateUserRoutes: FastifyPluginAsync = async (fastify) => {
  const userService = new UserService(fastify.prisma);
  const cooldownService = new CooldownService(fastify.redis);

  fastify.post('/user/ensure', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Garante o cadastro do usuário e grupo na primeira interação com a API',
      tags: ['Usuários (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'groupId'],
        properties: {
          userId: { type: 'string' },
          groupId: { type: 'string' },
          name: { type: 'string' },
          platform: { type: 'string', enum: ['WHATSAPP', 'TELEGRAM', 'DISCORD'], default: 'WHATSAPP' },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as {
        userId: string;
        groupId: string;
        name?: string;
        platform?: Platform;
      };

      const result = await userService.ensureUserAndGroup(body);

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  fastify.get('/user/:userId', {
    schema: {
      description: 'Obtém o perfil do usuário (ou entrega página HTML user.html se acessado via navegador)',
      tags: ['Usuários (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      // Se for requisição com API Key do bot, autentica e entrega o perfil JSON
      if (request.headers.authorization) {
        await verifyApiKey(request, reply);
        if (reply.sent) return;

        const { userId } = request.params as { userId: string };
        const user = await userService.getUserProfile(userId);

        if (!user) {
          return reply.status(404).send({
            success: false,
            error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
          });
        }

        return reply.send({
          success: true,
          data: user,
        });
      }

      // Caso contrário (acesso do navegador à página pública/privada), serve user.html
      return reply.sendFile('user.html');
    },
  });

  fastify.patch('/user/:userId/name', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Atualiza o nome de exibição do usuário',
      tags: ['Usuários (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { name } = request.body as { name: string };

      try {
        const updated = await userService.updateUserName(userId, name);
        return reply.send({
          success: true,
          data: updated,
        });
      } catch (err) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }
    },
  });

  fastify.get('/user/:userId/cooldowns', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Consulta o status de todos os cooldowns ativos do usuário (roll, claim, daily)',
      tags: ['Usuários (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          extraMaxRolls: { type: 'number', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { extraMaxRolls } = request.query as { extraMaxRolls?: number };
      const cooldowns = await cooldownService.getAllUserCooldowns(userId, extraMaxRolls ? Number(extraMaxRolls) : 0);

      return reply.send({
        success: true,
        data: cooldowns,
      });
    },
  });

  fastify.get('/user/:userId/groups', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Lista todos os grupos dos quais o usuário participa',
      tags: ['Usuários (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const groups = await userService.getUserGroups(userId);

      return reply.send({
        success: true,
        data: groups,
      });
    },
  });

  /**
   * Leaderboard / Ranking específico do grupo (usado no WhatsApp pela Ravena)
   */
  fastify.get('/groups/:groupId/leaderboard', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Ranking de usuários e waifus específico de um grupo',
      tags: ['Usuários (Privado)'],
      params: {
        type: 'object',
        required: ['groupId'],
        properties: { groupId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
        },
      },
    },
    handler: async (request, reply) => {
      const { groupId } = request.params as { groupId: string };
      const { limit = 10 } = (request.query as { limit?: number }) || {};
      const take = Math.min(25, Math.max(1, Number(limit)));

      // Busca membros do grupo
      const members = await fastify.prisma.userGroup.findMany({
        where: { groupId },
        select: { userId: true },
      });

      const memberUserIds = members.map((m) => m.userId);

      if (memberUserIds.length === 0) {
        return reply.send({
          success: true,
          data: {
            groupId,
            totalMembers: 0,
            topKakera: [],
            topHarem: [],
            topCharacters: [],
          },
        });
      }

      const [topKakera, topHaremUsers, topGroupClaims, totalClaimsInGroup] = await Promise.all([
        fastify.prisma.user.findMany({
          where: { id: { in: memberUserIds } },
          orderBy: { kakera: 'desc' },
          take,
          select: { id: true, name: true, kakera: true, publicId: true },
        }),
        fastify.prisma.user.findMany({
          where: { id: { in: memberUserIds } },
          include: {
            _count: { select: { harem: true } },
          },
          orderBy: { harem: { _count: 'desc' } },
          take,
        }),
        fastify.prisma.haremEntry.findMany({
          where: { claimedInGroup: groupId },
          take,
          orderBy: [{ keys: 'desc' }, { character: { popularityScore: 'desc' } }],
          include: {
            character: {
              select: {
                id: true,
                name: true,
                baseRarity: true,
                rank: true,
                waifuRank: true,
                popularityScore: true,
              },
            },
            user: {
              select: { id: true, name: true, publicId: true },
            },
          },
        }),
        fastify.prisma.haremEntry.count({
          where: { claimedInGroup: groupId },
        }),
      ]);

      const topHarem = topHaremUsers.map((u) => ({
        id: u.id,
        name: u.name,
        publicId: u.publicId,
        haremCount: u._count.harem,
      }));

      const topCharacters = topGroupClaims.map((entry) => ({
        character: entry.character,
        owner: entry.user,
        keys: entry.keys,
        claimedAt: entry.claimedAt,
      }));

      return reply.send({
        success: true,
        data: {
          groupId,
          totalMembers: memberUserIds.length,
          totalClaimsInGroup,
          topKakera,
          topHarem,
          topCharacters,
        },
      });
    },
  });
};
