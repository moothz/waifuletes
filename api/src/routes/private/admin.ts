import { FastifyPluginAsync } from 'fastify';
import { KakeraService } from '../../services/KakeraService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { DivorceService } from '../../services/DivorceService.js';
import { parseManifestString } from '../../utils/manifestLoader.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { KakeraReason } from '@prisma/client';

export const privateAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const cooldownService = new CooldownService(fastify.redis);
  const kakeraService = new KakeraService(fastify.prisma, cooldownService);
  const characterService = new CharacterService(fastify.prisma);
  const divorceService = new DivorceService(fastify.prisma);

  fastify.addHook('preHandler', verifyApiKey);

  // Dar Kakera (Admin/Eventos)
  fastify.post('/admin/kakera/give', {
    schema: {
      description: 'Concede quantidade de moeda Kakera para um usuário (ex: eventos externos, sorteios)',
      tags: ['Administração (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'amount'],
        properties: {
          userId: { type: 'string' },
          amount: { type: 'integer', minimum: 1 },
          reason: {
            type: 'string',
            enum: ['ADMIN_GRANT', 'EVENT_REWARD', 'DAILY_REWARD', 'DIVORCE', 'ROLL_CRYSTAL', 'WISHLIST_BONUS', 'SOULMATE_BONUS'],
            default: 'ADMIN_GRANT',
          },
          metadata: { type: 'object' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, amount, reason = 'ADMIN_GRANT', metadata } = request.body as any;

      try {
        const result = await kakeraService.adminModifyKakera({
          userId,
          amount,
          reason: reason as KakeraReason,
          metadata,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.message, message: err.message },
        });
      }
    },
  });

  // Remover Kakera (Admin)
  fastify.post('/admin/kakera/take', {
    schema: {
      description: 'Remove quantidade de moeda Kakera de um usuário',
      tags: ['Administração (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'amount'],
        properties: {
          userId: { type: 'string' },
          amount: { type: 'integer', minimum: 1 },
          metadata: { type: 'object' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, amount, metadata } = request.body as any;

      try {
        const result = await kakeraService.adminModifyKakera({
          userId,
          amount: -amount,
          reason: 'ADMIN_GRANT',
          metadata,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.message, message: err.message },
        });
      }
    },
  });

  // Importar Manifest JSON (Multipart ou JSON direto)
  fastify.post('/admin/manifest/import', {
    schema: {
      description: 'Importa ou atualiza em lote personagens a partir de um manifest JSON (upsert por ID)',
      tags: ['Administração (Privado)'],
    },
    handler: async (request, reply) => {
      let manifestContent: string = '';

      if (request.isMultipart()) {
        const file = await request.file();
        if (!file) {
          return reply.status(400).send({
            success: false,
            error: { code: 'NO_FILE', message: 'Nenhum arquivo enviado no formulário multipart.' },
          });
        }
        manifestContent = (await file.toBuffer()).toString('utf-8');
      } else {
        manifestContent = JSON.stringify(request.body);
      }

      try {
        const parsed = parseManifestString(manifestContent);
        const CHUNK_SIZE = 500;
        let syncedCount = 0;

        for (let i = 0; i < parsed.characters.length; i += CHUNK_SIZE) {
          const chunk = parsed.characters.slice(i, i + CHUNK_SIZE).map((c) => ({
            id: c.id,
            name: c.name,
            series: c.series,
            description: c.description,
            gender: c.gender,
            baseRarity: c.baseRarity,
            rank: (c as any).rank ?? null,
            tags: c.tags,
            imageUrls: c.images,
          }));

          const res = await fastify.prisma.character.createMany({
            data: chunk,
            skipDuplicates: true,
          });
          syncedCount += res.count;
        }

        return reply.send({
          success: true,
          data: {
            totalInManifest: parsed.characters.length,
            newlyInserted: syncedCount,
          },
        });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_MANIFEST', message: err.message },
        });
      }
    },
  });

  // Ativar / Desativar personagem globalmente
  fastify.patch('/admin/character/:id/toggle', {
    schema: {
      description: 'Ativa ou desativa um personagem globalmente do pool de sorteio',
      tags: ['Administração (Privado)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['isActive'],
        properties: { isActive: { type: 'boolean' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { isActive } = request.body as { isActive: boolean };

      const updated = await characterService.toggleActive(id, isActive);

      return reply.send({
        success: true,
        data: updated,
      });
    },
  });

  // Desabilitar personagem/série em um grupo
  fastify.post('/admin/group/disable', {
    schema: {
      description: 'Desabilita um personagem específico de ser sorteado em um determinado grupo',
      tags: ['Administração (Privado)'],
      body: {
        type: 'object',
        required: ['groupId', 'characterId'],
        properties: {
          groupId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { groupId, characterId } = request.body as { groupId: string; characterId: string };

      const disabled = await fastify.prisma.groupDisabledSeries.upsert({
        where: {
          groupId_characterId: {
            groupId,
            characterId,
          },
        },
        create: { groupId, characterId },
        update: {},
      });

      return reply.send({
        success: true,
        data: {
          message: `Personagem ${characterId} desabilitado para o grupo ${groupId}.`,
          disabled,
        },
      });
    },
  });

  // Reabilitar personagem em um grupo
  fastify.delete('/admin/group/disable', {
    schema: {
      description: 'Reabilita um personagem para voltar a ser sorteado em um determinado grupo',
      tags: ['Administração (Privado)'],
      body: {
        type: 'object',
        required: ['groupId', 'characterId'],
        properties: {
          groupId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { groupId, characterId } = request.body as { groupId: string; characterId: string };

      await fastify.prisma.groupDisabledSeries.deleteMany({
        where: { groupId, characterId },
      });

      return reply.send({
        success: true,
        data: {
          message: `Personagem ${characterId} reabilitado para o grupo ${groupId}.`,
        },
      });
    },
  });

  // Reset de cooldown manual
  fastify.post('/admin/cooldown/reset', {
    schema: {
      description: 'Reseta manualmente os cooldowns de um usuário (roll, claim, daily ou all)',
      tags: ['Administração (Privado)'],
      body: {
        type: 'object',
        required: ['userId', 'type'],
        properties: {
          userId: { type: 'string' },
          type: { type: 'string', enum: ['roll', 'claim', 'daily', 'all'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, type } = request.body as { userId: string; type: 'roll' | 'claim' | 'daily' | 'all' };

      await cooldownService.resetCooldown(userId, type);

      return reply.send({
        success: true,
        data: {
          message: `Cooldown do tipo '${type}' resetado com sucesso para o usuário ${userId}.`,
        },
      });
    },
  });

  // Forçar divórcio administrativo
  fastify.delete('/admin/harem/force-divorce', {
    schema: {
      description: 'Força a remoção de um personagem do harém de um usuário (sem devolver kakera)',
      tags: ['Administração (Privado)'],
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
      const result = await divorceService.forceDivorce(userId, characterId);
      if (!result.success) {
        return reply.status(404).send(result);
      }
      return reply.send(result);
    },
  });

  // Estatísticas globais do servidor
  fastify.get('/admin/stats', {
    schema: {
      description: 'Retorna contadores e estatísticas gerais do servidor',
      tags: ['Administração (Privado)'],
    },
    handler: async (request, reply) => {
      const [totalUsers, totalGroups, totalCharacters, totalClaims, totalSoulmates, totalKakera] = await Promise.all([
        fastify.prisma.user.count(),
        fastify.prisma.group.count(),
        fastify.prisma.character.count(),
        fastify.prisma.haremEntry.count(),
        fastify.prisma.soulmate.count(),
        fastify.prisma.user.aggregate({ _sum: { kakera: true } }),
      ]);

      return reply.send({
        success: true,
        data: {
          totalUsers,
          totalGroups,
          totalCharacters,
          totalClaims,
          totalSoulmates,
          totalKakeraCirculating: totalKakera._sum.kakera ?? 0,
        },
      });
    },
  });
};
