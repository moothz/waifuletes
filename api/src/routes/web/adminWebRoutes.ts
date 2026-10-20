import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { WebSessionService } from '../../services/WebSessionService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { MarryService } from '../../services/MarryService.js';
import { Prisma, Rarity, Gender, SuggestionStatus, SuggestionType } from '@prisma/client';

export const adminWebRoutes: FastifyPluginAsync = async (fastify) => {
  const webSessionService = new WebSessionService(fastify.redis, fastify.prisma);
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);

  /**
   * Middleware para checar autenticação de administrador
   */
  async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (request.headers['x-admin-token']) {
      token = String(request.headers['x-admin-token']).trim();
    } else if ((request.query as any)?.adminToken) {
      token = String((request.query as any).adminToken).trim();
    }

    const isValid = await webSessionService.validateAdminSession(token);
    if (!isValid) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED_ADMIN', message: 'Acesso negado. Senha de administrador requerida ou sessão expirada.' },
      });
    }
  }

  /**
   * Login do Administrador via senha única do .env
   */
  fastify.post('/api/admin/login', {
    schema: {
      description: 'Login no painel administrativo via senha única',
      tags: ['Admin (Web)'],
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { password } = request.body as { password: string };

      const passBuffer = Buffer.from(password || '');
      const expectedBuffer = Buffer.from(config.ADMIN_PASSWORD || '');

      const isMatch =
        passBuffer.length > 0 &&
        passBuffer.length === expectedBuffer.length &&
        timingSafeEqual(passBuffer, expectedBuffer);

      if (!isMatch) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Senha de administrador incorreta.' },
        });
      }

      const session = await webSessionService.createAdminSession();

      return reply.send({
        success: true,
        data: {
          message: 'Login efetuado com sucesso!',
          token: session.token,
          expiresIn: session.expiresIn,
        },
      });
    },
  });

  /**
   * Logout do Administrador
   */
  fastify.post('/api/admin/logout', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Encerra a sessão de administrador',
      tags: ['Admin (Web)'],
    },
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.replace(/^Bearer\s+/, '') || String(request.headers['x-admin-token'] || '');

      await webSessionService.invalidateAdminSession(token);
      return reply.send({
        success: true,
        data: { message: 'Sessão encerrada com sucesso.' },
      });
    },
  });

  /**
   * Verificação de integridade da sessão do admin
   */
  fastify.get('/api/admin/me', {
    preHandler: requireAdminAuth,
    handler: async () => ({
      success: true,
      data: { authenticated: true },
    }),
  });

  /**
   * Edição completa de personagem pelo Admin (nome, descrição, raridade, foto)
   */
  fastify.put('/api/admin/characters/:id', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Atualiza propriedades do personagem e/ou altera sua foto oficial',
      tags: ['Admin (Web)'],
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      const character = await fastify.prisma.character.findUnique({
        where: { id },
      });

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CHARACTER_NOT_FOUND', message: 'Personagem não encontrado.' },
        });
      }

      let name = character.name;
      let series = character.series;
      let description = character.description;
      let baseRarity = character.baseRarity;
      let gender = character.gender;
      let tags = character.tags;
      let rank = character.rank;
      let isActive = character.isActive;
      let customImageUrls: string[] | null = null;
      let photoAction: 'ADD' | 'REPLACE' = 'ADD';
      let targetPhoto: string | null = null;
      let newImageBuffer: Buffer | null = null;

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'name' && part.value) name = String(part.value).trim();
            if (part.fieldname === 'series' && part.value) series = String(part.value).trim();
            if (part.fieldname === 'description') description = String(part.value).trim();
            if (part.fieldname === 'baseRarity' && part.value) baseRarity = String(part.value) as Rarity;
            if (part.fieldname === 'gender' && ['FEMALE', 'MALE', 'OTHER'].includes(String(part.value))) {
              gender = String(part.value) as Gender;
            }
            if (part.fieldname === 'tags') {
              const val = String(part.value);
              tags = val ? val.split(',').map((t) => t.trim()).filter(Boolean) : [];
            }
            if (part.fieldname === 'rank' && part.value !== undefined) {
              const r = Number(part.value);
              rank = isNaN(r) ? null : r;
            }
            if (part.fieldname === 'isActive' && part.value !== undefined) {
              isActive = String(part.value) === 'true' || String(part.value) === '1';
            }
            if (part.fieldname === 'photoAction') {
              photoAction = String(part.value).toUpperCase() === 'REPLACE' ? 'REPLACE' : 'ADD';
            }
            if (part.fieldname === 'targetPhoto') {
              targetPhoto = String(part.value).trim();
            }
            if (part.fieldname === 'imageUrls') {
              try {
                const parsed = JSON.parse(String(part.value));
                if (Array.isArray(parsed)) customImageUrls = parsed;
              } catch (_) {}
            }
          } else if (part.type === 'file' && (part.fieldname === 'image' || part.fieldname === 'photo')) {
            newImageBuffer = await part.toBuffer();
          }
        }
      } else {
        const body = (request.body as any) || {};
        if (body.name) name = String(body.name).trim();
        if (body.series) series = String(body.series).trim();
        if (body.description !== undefined) description = String(body.description).trim();
        if (body.baseRarity) baseRarity = body.baseRarity as Rarity;
        if (body.gender && ['FEMALE', 'MALE', 'OTHER'].includes(body.gender)) {
          gender = body.gender as Gender;
        }
        if (body.tags !== undefined) {
          if (Array.isArray(body.tags)) {
            tags = body.tags.map((t: any) => String(t).trim()).filter(Boolean);
          } else if (typeof body.tags === 'string') {
            tags = body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
          }
        }
        if (body.rank !== undefined) {
          const r = Number(body.rank);
          rank = isNaN(r) ? null : r;
        }
        if (body.isActive !== undefined) {
          isActive = Boolean(body.isActive);
        }
        if (body.photoAction) {
          photoAction = String(body.photoAction).toUpperCase() === 'REPLACE' ? 'REPLACE' : 'ADD';
        }
        if (body.targetPhoto) {
          targetPhoto = String(body.targetPhoto).trim();
        }
        if (Array.isArray(body.imageUrls)) {
          customImageUrls = body.imageUrls;
        }
        if (body.imageBase64) {
          newImageBuffer = Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
      }

      // Se customImageUrls foi enviado, limpa possíveis URLs absolutas retornando ao formato relativo
      let updatedImageUrls = customImageUrls !== null
        ? customImageUrls.map((img) => {
            if (typeof img !== 'string') return '';
            // Remove prefixo http/https de media se houver
            return img.replace(/^https?:\/\/[^\/]+\/media\//, '');
          }).filter(Boolean)
        : [...character.imageUrls];

      if (newImageBuffer && newImageBuffer.length > 0) {
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', character.id);
        await fs.mkdir(uploadsDir, { recursive: true });

        const fileName = `${Date.now()}_default.png`;
        const filePath = path.join(uploadsDir, fileName);
        await fs.writeFile(filePath, newImageBuffer);

        const relPath = `uploads/characters/${character.id}/${fileName}`;
        if (photoAction === 'REPLACE' && targetPhoto) {
          const cleanTarget = targetPhoto.replace(/^https?:\/\/[^\/]+\/media\//, '');
          const idx = updatedImageUrls.findIndex((img) =>
            img === cleanTarget || img.endsWith(cleanTarget) || cleanTarget.endsWith(img)
          );
          if (idx !== -1) {
            updatedImageUrls[idx] = relPath;
          } else {
            updatedImageUrls.unshift(relPath);
          }
        } else {
          updatedImageUrls = [relPath, ...updatedImageUrls];
        }
      }

      const updated = await fastify.prisma.character.update({
        where: { id: character.id },
        data: {
          name,
          series,
          description,
          baseRarity,
          gender,
          tags,
          rank,
          isActive,
          imageUrls: updatedImageUrls,
        },
      });

      // Invalida cache de personagens no Redis
      try {
        const keys = await fastify.redis.keys('cache:characters:*');
        if (keys.length > 0) {
          await fastify.redis.del(...keys);
        }
      } catch (_) {}

      return reply.send({
        success: true,
        data: {
          message: `Personagem ${updated.name} atualizado com sucesso!`,
          character: {
            ...updated,
            imageUrl: characterService.getRandomImageUrl(updated.id, updated.imageUrls),
          },
        },
      });
    },
  });

  /**
   * Listagem de sugestões para moderação
   */
  fastify.get('/api/admin/suggestions', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista sugestões de raridade e imagem para aprovação/rejeição',
      tags: ['Admin (Web)'],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'all'], default: 'PENDING' },
          type: { type: 'string', enum: ['RARITY', 'IMAGE'] },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as any;
      const suggestions = await suggestionService.listSuggestions({
        status: query.status as SuggestionStatus | 'all',
        type: query.type as SuggestionType,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
      });

      return reply.send({
        success: true,
        data: suggestions,
      });
    },
  });

  /**
   * Aprovar e aplicar sugestão
   */
  fastify.post('/api/admin/suggestions/:id/approve', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Aprova uma sugestão e aplica a modificação automaticamente ao personagem',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await suggestionService.approveSuggestion(id, 'admin');
      return reply.send(result);
    },
  });

  /**
   * Rejeitar sugestão
   */
  fastify.post('/api/admin/suggestions/:id/reject', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Rejeita uma sugestão de usuário',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          rejectionReason: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { rejectionReason } = (request.body as any) || {};

      const result = await suggestionService.rejectSuggestion(id, rejectionReason, 'admin');
      return reply.send(result);
    },
  });

  /**
   * Aprovar todas as sugestões pendentes em lote
   */
  fastify.post('/api/admin/suggestions/approve-all', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Aprova todas as sugestões com status PENDING e aplica as alterações',
      tags: ['Admin (Web)'],
    },
    handler: async (_request, reply) => {
      const result = await suggestionService.approveAllSuggestions('admin');
      return reply.send(result);
    },
  });

  /**
   * Apaga a mensagem do Telegram de uma sugestão
   */
  fastify.delete('/api/admin/suggestions/:id/telegram', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Apaga a notificação enviada ao Telegram sobre a sugestão',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await suggestionService.deleteTelegramNotification(id);
      return reply.send({
        success: true,
        data: {
          deleted,
          message: deleted ? 'Mensagem apagada do Telegram com sucesso.' : 'Nenhuma mensagem encontrada ou erro ao apagar.',
        },
      });
    },
  });

  /**
   * Apaga a mensagem do Telegram de uma denúncia de múltiplos rolls
   */
  fastify.delete('/api/admin/multi-reports/:id/telegram', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Apaga a notificação enviada ao Telegram sobre a denúncia de múltiplos rolls',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await suggestionService.deleteMultiReportTelegramNotification(id);
      return reply.send({
        success: true,
        data: {
          deleted,
          message: deleted ? 'Mensagem apagada do Telegram com sucesso.' : 'Nenhuma mensagem encontrada ou erro ao apagar.',
        },
      });
    },
  });

  /**
   * Deleta uma sugestão e remove a notificação do Telegram
   */
  fastify.delete('/api/admin/suggestions/:id', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Remove uma sugestão do banco de dados e apaga a mensagem do Telegram',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      await suggestionService.deleteSuggestion(id);
      return reply.send({
        success: true,
        data: { message: 'Sugestão removida com sucesso.' },
      });
    },
  });

  /**
   * Listagem de usuários com contagem de harém, wishlist e busca por nome/número
   */
  fastify.get('/api/admin/users', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista todos os usuários com contagem de harém e wishlist, além de busca por nome ou número/ID',
      tags: ['Admin (Web)'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as { search?: string; page?: number; limit?: number };
      const search = query.search ? query.search.trim() : '';
      const page = Math.max(1, query.page ? Number(query.page) : 1);
      const limit = Math.min(100, Math.max(1, query.limit ? Number(query.limit) : 20));
      const skip = (page - 1) * limit;

      let total = 0;
      let users: any[] = [];

      if (search) {
        const searchPattern = `%${search}%`;
        const countResult = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT count(*)::bigint AS count
          FROM users u
          WHERE u.name ILIKE ${searchPattern} OR u.id ILIKE ${searchPattern}
        `;
        total = Number(countResult[0]?.count || 0);

        users = await fastify.prisma.$queryRaw<any[]>`
          SELECT 
            u.id,
            u."publicId",
            u.name,
            u.platform,
            u.kakera,
            u."createdAt",
            COALESCE(h.total_harem, 0)::int AS "totalHarem",
            COALESCE(w.total_wishlist, 0)::int AS "totalWishlist",
            (COALESCE(h.total_harem, 0) + COALESCE(w.total_wishlist, 0))::int AS "totalScore"
          FROM users u
          LEFT JOIN (
            SELECT "userId", count(*)::int AS total_harem
            FROM harem_entries
            GROUP BY "userId"
          ) h ON h."userId" = u.id
          LEFT JOIN (
            SELECT "userId", count(*)::int AS total_wishlist
            FROM wishlist_entries
            GROUP BY "userId"
          ) w ON w."userId" = u.id
          WHERE u.name ILIKE ${searchPattern} OR u.id ILIKE ${searchPattern}
          ORDER BY "totalScore" DESC, "totalHarem" DESC, u."createdAt" DESC
          LIMIT ${limit} OFFSET ${skip}
        `;
      } else {
        const countResult = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT count(*)::bigint AS count
          FROM users
        `;
        total = Number(countResult[0]?.count || 0);

        users = await fastify.prisma.$queryRaw<any[]>`
          SELECT 
            u.id,
            u."publicId",
            u.name,
            u.platform,
            u.kakera,
            u."createdAt",
            COALESCE(h.total_harem, 0)::int AS "totalHarem",
            COALESCE(w.total_wishlist, 0)::int AS "totalWishlist",
            (COALESCE(h.total_harem, 0) + COALESCE(w.total_wishlist, 0))::int AS "totalScore"
          FROM users u
          LEFT JOIN (
            SELECT "userId", count(*)::int AS total_harem
            FROM harem_entries
            GROUP BY "userId"
          ) h ON h."userId" = u.id
          LEFT JOIN (
            SELECT "userId", count(*)::int AS total_wishlist
            FROM wishlist_entries
            GROUP BY "userId"
          ) w ON w."userId" = u.id
          ORDER BY "totalScore" DESC, "totalHarem" DESC, u."createdAt" DESC
          LIMIT ${limit} OFFSET ${skip}
        `;
      }

      return reply.send({
        success: true,
        data: {
          users: users.map((u) => ({
            id: u.id,
            publicId: u.publicId,
            name: u.name,
            platform: u.platform,
            kakera: u.kakera,
            totalHarem: Number(u.totalHarem) || 0,
            totalWishlist: Number(u.totalWishlist) || 0,
            totalScore: Number(u.totalScore) || 0,
            createdAt: u.createdAt,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        },
      });
    },
  });

  /**
   * Gerar sessão de impersonation do usuário (como se tivesse usado !mu-adm)
   */
  fastify.post('/api/admin/users/:userId/session', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Gera link de acesso como se fosse o usuário acessando via !mu-adm',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const user = await fastify.prisma.user.findFirst({
        where: { OR: [{ id: userId }, { publicId: userId }] },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const session = await webSessionService.createUserSession(user.id);
      return reply.send({
        success: true,
        data: session,
      });
    },
  });

  /**
   * Realizar casamento administrativo direto com um usuário
   */
  fastify.post('/api/admin/users/:userId/marry', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Realiza casamento administrativo no banco de dados com usuário especificado',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['characterId'],
        additionalProperties: false,
        properties: {
          characterId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { characterId } = request.body as { characterId: string };

      const user = await fastify.prisma.user.findFirst({
        where: { OR: [{ id: userId }, { publicId: userId }] },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const cooldownService = new CooldownService(fastify.redis);
      const marryService = new MarryService(fastify.prisma, cooldownService, characterService);

      const result = await marryService.adminMarry({
        userId: user.id,
        characterId: characterId.trim(),
        name: user.name,
      });

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });
};
