import { FastifyPluginAsync } from 'fastify';
import { KakeraService } from '../../services/KakeraService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { UserService } from '../../services/UserService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateKakeraRoutes: FastifyPluginAsync = async (fastify) => {
  const cooldownService = new CooldownService(fastify.redis);
  const kakeraService = new KakeraService(fastify.prisma, cooldownService);
  const userService = new UserService(fastify.prisma);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.get('/kakera/:userId', {
    schema: {
      description: 'Consulta o saldo de moeda Kakera do usuário',
      tags: ['Kakera & Economia (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const balance = await kakeraService.getBalance(userId);

      if (!balance) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      return reply.send({
        success: true,
        data: balance,
      });
    },
  });

  fastify.post('/kakera/daily', {
    schema: {
      description: 'Resgata a recompensa diária de moeda Kakera (cooldown de 20 horas)',
      tags: ['Kakera & Economia (Privado)'],
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
          groupId: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as { userId: string; groupId?: string; name?: string };

      if (body.groupId) {
        await userService.ensureUserAndGroup({
          userId: body.userId,
          groupId: body.groupId,
          name: body.name,
        });
      }

      const result = await kakeraService.claimDaily(body.userId);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  fastify.get('/kakera/:userId/history', {
    schema: {
      description: 'Extrato histórico das movimentações de Kakera do usuário (ganhos e gastos)',
      tags: ['Kakera & Economia (Privado)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const query = request.query as any;

      const result = await kakeraService.getHistory(
        userId,
        query.page ? Number(query.page) : 1,
        query.limit ? Number(query.limit) : 20
      );

      return reply.send({
        success: true,
        data: result,
      });
    },
  });
};
