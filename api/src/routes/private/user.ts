import { FastifyPluginAsync } from 'fastify';
import { UserService } from '../../services/UserService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { Platform } from '@prisma/client';

export const privateUserRoutes: FastifyPluginAsync = async (fastify) => {
  const userService = new UserService(fastify.prisma);
  const cooldownService = new CooldownService(fastify.redis);

  // Exige autenticação Bearer em todas as rotas deste plugin
  fastify.addHook('preHandler', verifyApiKey);

  fastify.post('/user/ensure', {
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
      description: 'Obtém o perfil do usuário, contadores de harém, soulmate e favorito',
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
    },
  });

  fastify.patch('/user/:userId/name', {
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
};
