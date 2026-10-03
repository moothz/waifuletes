import { FastifyPluginAsync } from 'fastify';
import { MarryService } from '../../services/MarryService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { UserService } from '../../services/UserService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { Platform } from '@prisma/client';

export const privateMarryRoutes: FastifyPluginAsync = async (fastify) => {
  const cooldownService = new CooldownService(fastify.redis);
  const characterService = new CharacterService(fastify.prisma);
  const userService = new UserService(fastify.prisma);
  const marryService = new MarryService(fastify.prisma, cooldownService, characterService);

  fastify.addHook('preHandler', verifyApiKey);

  fastify.post('/marry', {
    schema: {
      description: 'Efetua o casamento/claim de um personagem que acabou de ser rolado no grupo (janela de 30s)',
      tags: ['Jogo (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'groupId', 'characterId'],
        properties: {
          userId: { type: 'string' },
          groupId: { type: 'string' },
          characterId: { type: 'string' },
          name: { type: 'string' },
          platform: { type: 'string', enum: ['WHATSAPP', 'TELEGRAM', 'DISCORD'], default: 'WHATSAPP' },
        },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as {
        userId: string;
        groupId: string;
        characterId: string;
        name?: string;
        platform?: Platform;
      };

      await userService.ensureUserAndGroup({
        userId: body.userId,
        groupId: body.groupId,
        name: body.name,
        platform: body.platform,
      });

      const result = await marryService.marry({
        userId: body.userId,
        groupId: body.groupId,
        characterId: body.characterId,
      });

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });
};
