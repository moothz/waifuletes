import { FastifyPluginAsync } from 'fastify';
import { DivorceService } from '../../services/DivorceService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { verifyApiKey } from '../../plugins/auth.js';

export const privateDivorceRoutes: FastifyPluginAsync = async (fastify) => {
  const divorceService = new DivorceService(fastify.prisma);
  const characterService = new CharacterService(fastify.prisma);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.post('/divorce', {
    schema: {
      description: 'Divorcia um personagem do harém do usuário, retornando moeda Kakera conforme raridade e keys acumuladas',
      tags: ['Jogo (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.body as { userId: string; characterId: string };

      const result = await divorceService.divorce(userId, characterId);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  fastify.post('/like', {
    schema: {
      description: 'Dá curtida/like em um personagem, aumentando sua popularidade global',
      tags: ['Jogo (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, characterId } = request.body as { userId: string; characterId: string };

      try {
        const updated = await characterService.likeCharacter(userId, characterId);
        return reply.send({
          success: true,
          data: {
            characterId: updated.id,
            name: updated.name,
            likeCount: updated.likeCount,
            message: `Você curtiu ${updated.name}! ❤️`,
          },
        });
      } catch (err: any) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CHARACTER_NOT_FOUND', message: 'Personagem não encontrado.' },
        });
      }
    },
  });
};
