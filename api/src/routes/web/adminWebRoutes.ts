import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { optimizeImageUnder1Mb, MAX_IMAGE_UPLOAD_BYTES } from '../../utils/imageOptimizer.js';
import { WebSessionService } from '../../services/WebSessionService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { MarryService } from '../../services/MarryService.js';
import { UserService } from '../../services/UserService.js';
import { MarketService } from '../../services/MarketService.js';
import { DivorceService } from '../../services/DivorceService.js';
import { simulateInactiveLoss, haremValueWithDiscount, DEFAULT_MAX_SIMULATION_DAYS } from '../../services/InactiveProjectionService.js';
import { withBusinessSpan, setAttrs } from '../../telemetry.js';
import { Prisma, Rarity, Gender, SuggestionStatus, SuggestionType } from '@prisma/client';

export const adminWebRoutes: FastifyPluginAsync = async (fastify) => {
  const webSessionService = new WebSessionService(fastify.redis, fastify.prisma);
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);
  const userService = new UserService(fastify.prisma, fastify.redis);
  const marketService = new MarketService(fastify.prisma, characterService);

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
   * Listagem de personagens para o catálogo do Admin (com suporte a filtros de status, sem cache de navegador)
   */
  fastify.get('/api/admin/characters', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Consulta administrativa de personagens com filtro por status ativo/inativo e sem cache',
      tags: ['Admin (Web)'],
      querystring: {
        type: 'object',
        properties: {
          series: { type: 'string' },
          rarity: { type: 'string', enum: ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] },
          gender: { type: 'string', enum: ['FEMALE', 'MALE', 'OTHER'] },
          tag: { type: 'string' },
          search: { type: 'string' },
          maritalStatus: { type: 'string', enum: ['all', 'single', 'married'] },
          status: { type: 'string', enum: ['all', 'active', 'inactive'], default: 'all' },
          sort: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 18 },
        },
      },
    },
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      const query = request.query as any;

      const result = await characterService.listCharacters(
        {
          series: query.series,
          rarity: query.rarity as Rarity,
          gender: query.gender as Gender,
          tag: query.tag,
          search: query.search,
          maritalStatus: query.maritalStatus,
          status: query.status || 'all',
          sort: query.sort || 'ranking',
          page: query.page ? Math.max(1, Number(query.page)) : 1,
          limit: query.limit ? Math.min(100, Math.max(1, Number(query.limit))) : 18,
        },
        true
      );

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Obter detalhes de personagem para o modal de edição do Admin (sem cache)
   */
  fastify.get('/api/admin/characters/:id', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Obtém dados completos de um personagem para edição administrativa (inclui ativos e desabilitados)',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      const { id } = request.params as { id: string };

      const character = await characterService.getCharacterById(id, true);

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CHARACTER_NOT_FOUND', message: 'Personagem não encontrado.' },
        });
      }

      return reply.send({
        success: true,
        data: character,
      });
    },
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
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
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

      const validRarities = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'name' && part.value) name = String(part.value).trim();
            if (part.fieldname === 'series' && part.value) series = String(part.value).trim();
            if (part.fieldname === 'description') description = String(part.value).trim();
            if (part.fieldname === 'baseRarity' && part.value && validRarities.includes(String(part.value).trim().toUpperCase())) {
              baseRarity = String(part.value).trim().toUpperCase() as Rarity;
            }
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
        if (body.baseRarity && validRarities.includes(String(body.baseRarity).trim().toUpperCase())) {
          baseRarity = String(body.baseRarity).trim().toUpperCase() as Rarity;
        }
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
            // Remove prefixo http/https de media ou api upstream se houver
            return img.replace(/^https?:\/\/[^\/]+(?:\/api\/v1\/external)?\/media\//, '').replace(/\?.*$/, '');
          }).filter(Boolean)
        : [...character.imageUrls];

      if (newImageBuffer && newImageBuffer.length > 0) {
        if (newImageBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
          return reply.status(413).send({
            success: false,
            error: { code: 'PAYLOAD_TOO_LARGE', message: 'A imagem enviada é muito grande! Compacte ela antes' },
          });
        }
        const optimized = await optimizeImageUnder1Mb(newImageBuffer);
        const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', character.id);
        await fs.mkdir(uploadsDir, { recursive: true });

        const fileName = `${Date.now()}_default.${optimized.ext}`;
        const filePath = path.join(uploadsDir, fileName);
        await fs.writeFile(filePath, optimized.buffer);

        const relPath = `uploads/characters/${character.id}/${fileName}`;
        if (photoAction === 'REPLACE' && targetPhoto) {
          const cleanTarget = targetPhoto.replace(/^https?:\/\/[^\/]+(?:\/api\/v1\/external)?\/media\//, '').replace(/\?.*$/, '');
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
        await fastify.redis.del('cache:character_stats');
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
          type: {
            type: 'string',
            enum: [
              'all',
              'RARITY',
              'IMAGE',
              'IMAGE_REPLACE',
              'IMAGE_ADD',
              'IMAGE_DELETE',
              'REPORT_REMOVE',
              'EDIT',
              'NEW_CHARACTER',
              'DELETE_CHARACTER',
            ],
          },
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
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        nullable: true,
        additionalProperties: false,
        properties: {
          overrideRarity: { type: 'string' },
          overridePhotoAction: { type: 'string', enum: ['ADD', 'REPLACE'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { overrideRarity?: string; overridePhotoAction?: 'ADD' | 'REPLACE' };
      const result = await suggestionService.approveSuggestion(id, 'admin', body.overrideRarity, body.overridePhotoAction);
      return reply.send(result);
    },
  });

  /**
   * Consulta parecer da IA e exibe o prompt completo de avaliação
   */
  fastify.get('/api/admin/suggestions/:id/ai-advisor', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Obtém ou gera o parecer da IA e o prompt completo utilizado para a sugestão',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          refresh: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { refresh?: string };
      const advisor = await suggestionService.getOrEvaluateAiAdvisor(id, query.refresh === 'true');
      return reply.send({
        success: true,
        data: advisor,
      });
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
        nullable: true,
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
   * Aprovar sugestões pendentes exibidas/filtradas em lote
   */
  fastify.post('/api/admin/suggestions/approve-batch', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Aprova uma lista específica de sugestões pendentes (ex: página filtrada atual)',
      tags: ['Admin (Web)'],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 100,
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      const result = await suggestionService.approveSuggestionsBatch(ids, 'admin');
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
   * Bloqueia um usuário para não enviar sugestões (24h, 7d, 30d ou pra sempre)
   */
  fastify.post('/api/admin/users/:userId/block-suggestions', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Bloqueia um usuário de enviar sugestões por 24h, 7d, 30d ou permanentemente',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['duration'],
        additionalProperties: false,
        properties: {
          duration: { type: 'string', enum: ['24h', '7d', '30d', 'forever'] },
          reason: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const { duration, reason } = request.body as { duration: any; reason?: string };
      const blockInfo = await suggestionService.blockUserFromSuggestions(userId, duration, reason);
      return reply.send({
        success: true,
        data: {
          message: `Usuário bloqueado de enviar sugestões com sucesso (${duration === 'forever' ? 'permanente' : duration}).`,
          blockInfo,
        },
      });
    },
  });

  /**
   * Desbloqueia um usuário para permitir envio de sugestões
   */
  fastify.post('/api/admin/users/:userId/unblock-suggestions', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Remove o bloqueio de envio de sugestões de um usuário',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      await suggestionService.unblockUserFromSuggestions(userId);
      return reply.send({
        success: true,
        data: {
          message: 'Usuário desbloqueado com sucesso.',
        },
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
            COALESCE(u.mythic_slots, 0)::int AS "mythicSlots",
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
            COALESCE(u.mythic_slots, 0)::int AS "mythicSlots",
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

      const userIds = users.map((u) => u.id);
      const blockKeys = userIds.map((id) => `suggestion:block:${id}`);
      let blockResults: (string | null)[] = [];
      if (blockKeys.length > 0) {
        blockResults = await fastify.redis.mget(...blockKeys);
      }

      return reply.send({
        success: true,
        data: {
          users: users.map((u, i) => {
            const rawBlock = blockResults[i];
            let isBlockedFromSuggestions = Boolean(rawBlock);
            let blockInfo: any = null;
            if (rawBlock) {
              try {
                blockInfo = JSON.parse(rawBlock);
              } catch (_) {}
            }
            return {
              id: u.id,
              publicId: u.publicId,
              name: u.name,
              platform: u.platform,
              kakera: u.kakera,
              mythicSlots: Number(u.mythicSlots) || 0,
              totalHarem: Number(u.totalHarem) || 0,
              totalWishlist: Number(u.totalWishlist) || 0,
              totalScore: Number(u.totalScore) || 0,
              createdAt: u.createdAt,
              isBlockedFromSuggestions,
              blockInfo,
            };
          }),
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
   * Auditoria completa de atividades do usuário (casamentos, anúncios, ofertas, vendas, movimentações financeiras)
   */
  fastify.get('/api/admin/users/:userId/audit', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Retorna a auditoria cronológica detalhada de atividades de um usuário (casamentos, anúncios, ofertas, vendas, transações)',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: {
          userId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
          type: {
            type: 'string',
            enum: ['ALL', 'MARRIAGES', 'LISTINGS', 'OFFERS_SENT', 'SALES', 'TRANSACTIONS'],
            default: 'ALL',
          },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          includeRollCrystals: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const query = request.query as {
        days?: number;
        type?: 'ALL' | 'MARRIAGES' | 'LISTINGS' | 'OFFERS_SENT' | 'SALES' | 'TRANSACTIONS';
        page?: number;
        limit?: number;
        includeRollCrystals?: boolean;
      };

      const days = Number(query.days) || 30;
      const type = query.type || 'ALL';
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
      const skip = (page - 1) * limit;
      const includeRollCrystals = Boolean(query.includeRollCrystals);

      const user = await fastify.prisma.user.findFirst({
        where: {
          OR: [{ id: userId }, { publicId: userId }],
        },
        select: {
          id: true,
          publicId: true,
          name: true,
          platform: true,
          kakera: true,
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Resumo de métricas no período
      const [
        marriagesCount,
        marriagesByRarityRaw,
        listingsCount,
        offersSentCount,
        salesCount,
        offersReceivedCount,
      ] = await Promise.all([
        fastify.prisma.haremEntry.count({
          where: { userId: user.id, claimedAt: { gte: startDate } },
        }),
        fastify.prisma.haremEntry.findMany({
          where: { userId: user.id, claimedAt: { gte: startDate } },
          select: { character: { select: { baseRarity: true } } },
        }),
        fastify.prisma.marketListing.count({
          where: { userId: user.id, createdAt: { gte: startDate } },
        }),
        fastify.prisma.marketOffer.count({
          where: { buyerId: user.id, createdAt: { gte: startDate } },
        }),
        fastify.prisma.marketOffer.count({
          where: { sellerId: user.id, status: 'ACCEPTED', createdAt: { gte: startDate } },
        }),
        fastify.prisma.marketOffer.count({
          where: { sellerId: user.id, createdAt: { gte: startDate } },
        }),
      ]);

      const rarityBreakdown: Record<string, number> = {
        COMMON: 0,
        UNCOMMON: 0,
        RARE: 0,
        EPIC: 0,
        LEGENDARY: 0,
      };
      for (const m of marriagesByRarityRaw) {
        const r = m.character?.baseRarity || 'COMMON';
        rarityBreakdown[r] = (rarityBreakdown[r] || 0) + 1;
      }

      // Helper para formatar contrapartida de ofertas
      const formatOfferedItems = (items: any) => {
        if (!items) return 'Sem itens';
        if (items.isFree) return '🎁 Gratuito / Doação';
        const parts: string[] = [];
        if (items.zinthos && items.zinthos > 0) {
          parts.push(`🪙 ${Number(items.zinthos).toLocaleString('pt-BR')} Zinthos`);
        }
        if (items.runas && items.runas > 0) {
          parts.push(`🔮 ${Number(items.runas).toLocaleString('pt-BR')} Runas`);
        }
        if (items.petalitas && items.petalitas > 0) {
          parts.push(`🌸 ${Number(items.petalitas).toLocaleString('pt-BR')} Petalitas`);
        }
        if (Array.isArray(items.waifuIds) && items.waifuIds.length > 0) {
          parts.push(`💍 ${items.waifuIds.length} Waifu(s)`);
        }
        if (Array.isArray(items.fishes) && items.fishes.length > 0) {
          parts.push(`🐟 ${items.fishes.length} Peixe(s)`);
        }
        if (Array.isArray(items.farmItems) && items.farmItems.length > 0) {
          parts.push(`🌾 ${items.farmItems.length} Fazenda`);
        }
        if (Array.isArray(items.fishingBuffs) && items.fishingBuffs.length > 0) {
          parts.push(`🎣 ${items.fishingBuffs.length} Isca(s)`);
        }
        return parts.length > 0 ? parts.join(' + ') : 'Sem itens';
      };

      // Montagem dos eventos unificados ou filtrados por categoria
      let allItems: any[] = [];
      let totalCount = 0;

      if (type === 'ALL' || type === 'MARRIAGES') {
        const marriageOptions: any = {
          where: { userId: user.id, claimedAt: { gte: startDate } },
          include: {
            character: {
              select: { id: true, name: true, baseRarity: true, series: true },
            },
          },
          orderBy: { claimedAt: 'desc' },
        };
        if (type === 'MARRIAGES') {
          marriageOptions.skip = skip;
          marriageOptions.take = limit;
        }
        const marriages = await fastify.prisma.haremEntry.findMany(marriageOptions);

        const mapped = marriages.map((m: any) => ({
          id: `marriage_${m.id}`,
          timestamp: m.claimedAt.toISOString(),
          category: 'MARRIAGE',
          badge: { label: 'Casamento', color: '#ec4899', icon: 'fas fa-ring' },
          character: {
            id: m.character?.id,
            name: m.character?.name || 'Desconhecido',
            rarity: m.character?.baseRarity || 'COMMON',
            series: m.character?.series,
          },
          currency: {
            formatted: `${m.keys} chave(s)`,
            amount: m.keys,
          },
          details: `Casou com ${m.character?.name || 'Desconhecido'} no grupo/origem ${m.claimedInGroup}`,
          counterpart: { group: m.claimedInGroup },
          status: 'COMPLETED',
        }));

        if (type === 'MARRIAGES') {
          allItems = mapped;
          totalCount = marriagesCount;
        } else {
          allItems.push(...mapped);
        }
      }

      if (type === 'ALL' || type === 'LISTINGS') {
        const listingOptions: any = {
          where: { userId: user.id, createdAt: { gte: startDate } },
          include: {
            character: {
              select: { id: true, name: true, baseRarity: true, series: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        };
        if (type === 'LISTINGS') {
          listingOptions.skip = skip;
          listingOptions.take = limit;
        }
        const listings = await fastify.prisma.marketListing.findMany(listingOptions);

        const mapped = listings.map((l: any) => ({
          id: `listing_${l.id}`,
          timestamp: l.createdAt.toISOString(),
          category: 'LISTING',
          badge: { label: 'Anúncio', color: '#f59e0b', icon: 'fas fa-bullhorn' },
          character: {
            id: l.character?.id,
            name: l.character?.name || 'Desconhecido',
            rarity: l.character?.baseRarity || 'COMMON',
            series: l.character?.series,
          },
          currency: {
            formatted: `Buscando: ${l.interest}`,
          },
          details: `Criou anúncio nos classificados buscando "${l.interest}"`,
          status: l.status,
        }));

        if (type === 'LISTINGS') {
          allItems = mapped;
          totalCount = listingsCount;
        } else {
          allItems.push(...mapped);
        }
      }

      if (type === 'ALL' || type === 'OFFERS_SENT') {
        const offerSentOptions: any = {
          where: { buyerId: user.id, createdAt: { gte: startDate } },
          include: {
            seller: { select: { id: true, name: true } },
            listing: {
              include: {
                character: { select: { id: true, name: true, baseRarity: true, series: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        };
        if (type === 'OFFERS_SENT') {
          offerSentOptions.skip = skip;
          offerSentOptions.take = limit;
        }
        const offersSent = await fastify.prisma.marketOffer.findMany(offerSentOptions);

        const mapped = offersSent.map((o: any) => ({
          id: `offer_sent_${o.id}`,
          timestamp: o.createdAt.toISOString(),
          category: 'OFFER_SENT',
          badge: { label: 'Oferta Enviada', color: '#3b82f6', icon: 'fas fa-paper-plane' },
          character: {
            id: o.listing?.character?.id,
            name: o.listing?.character?.name || 'Desconhecido',
            rarity: o.listing?.character?.baseRarity || 'COMMON',
            series: o.listing?.character?.series,
          },
          currency: {
            formatted: formatOfferedItems(o.offeredItems),
            rawItems: o.offeredItems,
          },
          details: `Enviou proposta para ${o.seller?.name || 'Vendedor'}: ${formatOfferedItems(o.offeredItems)}`,
          counterpart: { name: o.seller?.name, role: 'Vendedor' },
          status: o.status,
        }));

        if (type === 'OFFERS_SENT') {
          allItems = mapped;
          totalCount = offersSentCount;
        } else {
          allItems.push(...mapped);
        }
      }

      if (type === 'ALL' || type === 'SALES') {
        const offerReceivedOptions: any = {
          where: {
            sellerId: user.id,
            createdAt: { gte: startDate },
            ...(type === 'SALES' ? { status: 'ACCEPTED' } : {}),
          },
          include: {
            buyer: { select: { id: true, name: true } },
            listing: {
              include: {
                character: { select: { id: true, name: true, baseRarity: true, series: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        };
        if (type === 'SALES') {
          offerReceivedOptions.skip = skip;
          offerReceivedOptions.take = limit;
        }
        const offersReceived = await fastify.prisma.marketOffer.findMany(offerReceivedOptions);

        const mapped = offersReceived.map((o: any) => {
          const isSale = o.status === 'ACCEPTED';
          return {
            id: `offer_rec_${o.id}`,
            timestamp: o.createdAt.toISOString(),
            category: isSale ? 'SALE' : 'OFFER_RECEIVED',
            badge: isSale
              ? { label: 'Venda Concluída', color: '#10b981', icon: 'fas fa-coins' }
              : { label: 'Oferta Recebida', color: '#6366f1', icon: 'fas fa-inbox' },
            character: {
              id: o.listing?.character?.id,
              name: o.listing?.character?.name || 'Desconhecido',
              rarity: o.listing?.character?.baseRarity || 'COMMON',
              series: o.listing?.character?.series,
            },
            currency: {
              formatted: formatOfferedItems(o.offeredItems),
              rawItems: o.offeredItems,
            },
            details: isSale
              ? `Venda concluída para ${o.buyer?.name || 'Comprador'}: recebeu ${formatOfferedItems(o.offeredItems)}`
              : `Recebeu oferta de ${o.buyer?.name || 'Comprador'}: ${formatOfferedItems(o.offeredItems)}`,
            counterpart: { name: o.buyer?.name, role: 'Comprador' },
            status: o.status,
          };
        });

        if (type === 'SALES') {
          allItems = mapped;
          totalCount = salesCount;
        } else {
          allItems.push(...mapped);
        }
      }

      if (type === 'ALL' || type === 'TRANSACTIONS') {
        const txWhere: any = {
          userId: user.id,
          createdAt: { gte: startDate },
        };
        if (!includeRollCrystals && type === 'ALL') {
          txWhere.reason = { not: 'ROLL_CRYSTAL' };
        }

        const txCount = await fastify.prisma.kakeraTransaction.count({ where: txWhere });
        const txFindOptions: any = {
          where: txWhere,
          orderBy: { createdAt: 'desc' },
        };
        if (type === 'TRANSACTIONS') {
          txFindOptions.skip = skip;
          txFindOptions.take = limit;
        } else {
          txFindOptions.take = 100;
        }
        const transactions = await fastify.prisma.kakeraTransaction.findMany(txFindOptions);

        const mapped = transactions.map((t) => {
          const meta = t.metadata as any;
          const charName = meta?.characterName || meta?.characterId;
          const sign = t.amount >= 0 ? '+' : '';
          return {
            id: `tx_${t.id}`,
            timestamp: t.createdAt.toISOString(),
            category: 'TRANSACTION',
            badge: {
              label: t.reason,
              color: t.amount >= 0 ? '#10b981' : '#ef4444',
              icon: 'fas fa-receipt',
            },
            character: charName ? { name: charName, rarity: meta?.rarity || 'UNKNOWN' } : undefined,
            currency: {
              formatted: `${sign}${Number(t.amount).toLocaleString('pt-BR')} 🪙 Zinthos`,
              amount: t.amount,
            },
            details: `Transação: ${t.reason} (${sign}${Number(t.amount).toLocaleString('pt-BR')} Zinthos)${meta?.shares ? ` - Cotas: ${meta.shares}` : ''}${meta?.type ? ` [${meta.type}]` : ''}`,
            status: 'COMPLETED',
          };
        });

        if (type === 'TRANSACTIONS') {
          allItems = mapped;
          totalCount = txCount;
        } else {
          allItems.push(...mapped);
        }
      }

      // Ordenar e paginar quando type === 'ALL'
      let paginatedItems = allItems;
      if (type === 'ALL') {
        allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        totalCount = allItems.length;
        paginatedItems = allItems.slice(skip, skip + limit);
      }

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            publicId: user.publicId,
            name: user.name,
            platform: user.platform,
            kakera: user.kakera,
          },
          summary: {
            days,
            marriagesCount,
            marriagesByRarity: rarityBreakdown,
            listingsCount,
            offersSentCount,
            salesCount,
            offersReceivedCount,
          },
          items: paginatedItems,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit) || 1,
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

  /**
   * Atualizar quantidade de Zinthos de um usuário diretamente
   */
  const updateZinthosHandler = async (request: any, reply: any) => {
    const { userId } = request.params as { userId: string };
    const body = (request.body || {}) as { zinthos?: number; kakera?: number };
    const newZinthos = typeof body.zinthos === 'number' ? body.zinthos : (typeof body.kakera === 'number' ? body.kakera : null);

    if (newZinthos === null || !Number.isInteger(newZinthos) || newZinthos < 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_AMOUNT', message: 'Quantidade de Zinthos inválida. Deve ser um número inteiro maior ou igual a zero.' },
      });
    }

    const user = await fastify.prisma.user.findFirst({
      where: { OR: [{ id: userId }, { publicId: userId }] },
    });

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
      });
    }

    const prevZinthos = user.kakera;
    const diff = newZinthos - prevZinthos;

    if (diff !== 0) {
      await fastify.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { kakera: newZinthos },
        });

        await tx.kakeraTransaction.create({
          data: {
            userId: user.id,
            amount: diff,
            reason: 'ADMIN_GRANT',
            metadata: {
              previousBalance: prevZinthos,
              newBalance: newZinthos,
              source: 'admin_panel_edit',
            },
          },
        });
      });
    }

    return reply.send({
      success: true,
      data: {
        userId: user.id,
        zinthos: newZinthos,
        kakera: newZinthos,
        previousZinthos: prevZinthos,
        difference: diff,
      },
    });
  };

  const updateZinthosSchema = {
    description: 'Atualiza diretamente o saldo de Zinthos (kakera) de um usuário',
    tags: ['Admin (Web)'],
    params: {
      type: 'object',
      required: ['userId'],
      additionalProperties: false,
      properties: { userId: { type: 'string' } },
    },
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        zinthos: { type: 'integer', minimum: 0 },
        kakera: { type: 'integer', minimum: 0 },
      },
    },
  };

  fastify.patch('/api/admin/users/:userId/zinthos', {
    preHandler: requireAdminAuth,
    schema: updateZinthosSchema,
    handler: updateZinthosHandler,
  });

  fastify.put('/api/admin/users/:userId/zinthos', {
    preHandler: requireAdminAuth,
    schema: updateZinthosSchema,
    handler: updateZinthosHandler,
  });

  /**
   * Reseta os rolls do usuário para o valor máximo
   */
  fastify.post('/api/admin/users/:userId/reset-rolls', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Reseta os rolls do usuário para o valor máximo',
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

      const cooldownService = new CooldownService(fastify.redis);
      await cooldownService.resetCooldown(user.id, 'roll');
      const rollsState = await cooldownService.getUserRolls(user.id);

      return reply.send({
        success: true,
        data: {
          userId: user.id,
          message: `Rolls de ${user.name} resetados com sucesso para o máximo (${rollsState.maxRolls} rolls).`,
          rolls: rollsState,
        },
      });
    },
  });

  /**
   * Reseta todos os cooldowns de casamento (claim) do usuário
   */
  const resetClaimCooldownsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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

    const cooldownService = new CooldownService(fastify.redis);
    await cooldownService.resetClaimCooldowns(user.id);

    return reply.send({
      success: true,
      data: {
        userId: user.id,
        message: `Todos os cooldowns de casamento de ${user.name} foram resetados com sucesso!`,
      },
    });
  };

  fastify.post('/api/admin/users/:userId/reset-claim-cooldowns', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Reseta todos os cooldowns de casamento do usuário (liberando-o para casar)',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string' } },
      },
    },
    handler: resetClaimCooldownsHandler,
  });

  fastify.post('/api/admin/users/:userId/reset-cds', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Alias para reset-claim-cooldowns',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string' } },
      },
    },
    handler: resetClaimCooldownsHandler,
  });

  /**
   * Concede ou altera slots de personagens míticos para um usuário
   */
  fastify.post('/api/admin/users/:userId/mythic-slots', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Concede slots de criação de personagens míticos para um usuário',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: { userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount: { type: 'integer', minimum: 1 },
          slots: { type: 'integer', minimum: 1 },
          reason: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as { amount?: number; slots?: number; reason?: string };
      const amount = body.amount ?? body.slots ?? 1;
      const reason = body.reason || 'Concessão Administrativa';

      try {
        const result = await userService.addMythicSlots(userId, amount, reason);
        return reply.send({
          success: true,
          data: {
            ...result,
            message: `+${amount} slot(s) mítico(s) concedido(s) com sucesso para o usuário!`,
          },
        });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ADMIN_GRANT_FAILED', message: err.message || 'Falha ao conceder slots míticos.' },
        });
      }
    },
  });

  /**
   * Listagem administrativa de negociações/transações dos Classificados
   */
  fastify.get('/api/admin/market/trades', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista todas as transações feitas nos classificados com paginação e busca',
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
      const result = await marketService.listAdminTrades(query);
      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Reverte manualmente uma negociação realizada nos Classificados
   */
  fastify.post('/api/admin/market/trades/:offerId/revert', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Reverte uma transação aceita nos Classificados, devolvendo os personagens e itens para os donos originais',
      tags: ['Admin (Web)'],
      params: {
        type: 'object',
        required: ['offerId'],
        additionalProperties: false,
        properties: { offerId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { offerId } = request.params as { offerId: string };
      const result = await marketService.revertOffer(offerId);
      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Listagem administrativa de personagens confiscados por inatividade e métricas de operação
   */
  fastify.get('/api/admin/inactivity', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista personagens confiscados por taxa de hospedagem/inatividade e métricas de status operacional do sistema',
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
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;
      const search = query.search?.trim() || '';

      const whereClause: any = {
        reason: 'HOSTING_FEE_WAIFU',
      };

      if (search) {
        whereClause.OR = [
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { id: { contains: search, mode: 'insensitive' } } },
          { user: { publicId: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [total, transactions, sumResult, usersCountResult, latestTx] = await Promise.all([
        fastify.prisma.kakeraTransaction.count({ where: whereClause }),
        fastify.prisma.kakeraTransaction.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                publicId: true,
                platform: true,
                lastActiveAt: true,
                kakera: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        fastify.prisma.kakeraTransaction.aggregate({
          where: { reason: 'HOSTING_FEE_WAIFU' },
          _sum: { amount: true },
          _count: { id: true },
        }),
        fastify.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT "userId") as count
          FROM kakera_transactions
          WHERE "reason" = 'HOSTING_FEE_WAIFU'::"KakeraReason"
        `,
        fastify.prisma.kakeraTransaction.findFirst({
          where: { reason: 'HOSTING_FEE_WAIFU' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      const items = transactions.map((tx) => {
        const meta = (tx.metadata as any) || {};
        return {
          id: tx.id,
          createdAt: tx.createdAt,
          user: tx.user,
          character: {
            id: meta.characterId || 'desconhecido',
            name: meta.characterName || meta.characterId || 'Personagem',
            rarity: meta.rarity || 'COMMON',
            isSoulmate: Boolean(meta.isSoulmate),
          },
          recoveredValue: tx.amount,
          feeDate: meta.feeDate || null,
          debtBefore: meta.debtBefore ?? null,
          debtAfter: meta.debtAfter ?? null,
          confiscoRatio: meta.confiscoRatio ?? 0.3,
        };
      });

      const totalZinthosRecovered = sumResult._sum.amount || 0;
      const totalConfiscated = sumResult._count.id || 0;
      const totalUsersAffected = Number(usersCountResult[0]?.count || 0);
      const lastExecution = latestTx?.createdAt || null;

      const hoursSinceLastExecution = lastExecution
        ? (Date.now() - new Date(lastExecution).getTime()) / (1000 * 60 * 60)
        : null;
      const isSystemOperational = Boolean(
        lastExecution !== null ? (hoursSinceLastExecution !== null && hoursSinceLastExecution < 48) : true
      );

      return reply.send({
        success: true,
        data: {
          items,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
          metrics: {
            totalConfiscated,
            totalZinthosRecovered,
            totalUsersAffected,
            lastExecution,
            hoursSinceLastExecution: hoursSinceLastExecution ? Math.round(hoursSinceLastExecution) : null,
            isSystemOperational,
          },
        },
      });
    },
  });

  /**
   * Lista de jogadores inativos agora + simulação de perda total
   */
  fastify.get('/api/admin/inactivity/current', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Lista jogadores inativos agora (além da carência) com saldo, cobrado desde inativo, valor restante e estimativa de dias para perder tudo',
      tags: ['Admin (Web)'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as { page?: number; limit?: number };
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

      const now = new Date();
      const graceMs = config.HOSTING_GRACE_HOURS * 3600 * 1000;
      const graceDate = new Date(now.getTime() - graceMs);
      const divorceService = new DivorceService(fastify.prisma, undefined, fastify.redis);
      const inflationMultiplier = await divorceService.getInflationMultiplier().catch(() => 1.0);
      const soulmateKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;

      const candidates = await fastify.prisma.user.findMany({
        where: {
          harem: { some: { character: { isMythic: false } } },
          OR: [
            { lastActiveAt: { lt: graceDate } },
            { lastActiveAt: null, updatedAt: { lt: graceDate } },
          ],
        },
        select: { id: true, name: true, publicId: true, platform: true, kakera: true, lastActiveAt: true, updatedAt: true },
      });

      const enriched = await withBusinessSpan(
        'inactivity projection',
        { 'waifu.inactivity.users_evaluated': candidates.length },
        async () => {
          const results = await Promise.all(candidates.map(async (user) => {
            const lastActive = user.lastActiveAt ?? user.updatedAt;
            const offlineMs = Math.max(0, now.getTime() - new Date(lastActive).getTime());
            const offlineDays = Math.floor(offlineMs / 86400000);
            const becomeInactiveDate = new Date(new Date(lastActive).getTime() + graceMs);

            const [haremRows, soulmateRows, chargedResult, confiscatedResult] = await Promise.all([
              fastify.prisma.haremEntry.findMany({
                where: { userId: user.id, character: { isMythic: false } },
                select: {
                  characterId: true,
                  keys: true,
                  claimedAt: true,
                  character: { select: { baseRarity: true } },
                },
              }),
              fastify.prisma.soulmate.findMany({
                where: { userId: user.id },
                select: { characterId: true },
              }),
              fastify.prisma.kakeraTransaction.aggregate({
                where: { userId: user.id, reason: 'HOSTING_FEE', createdAt: { gte: becomeInactiveDate } },
                _sum: { amount: true },
              }),
              fastify.prisma.kakeraTransaction.aggregate({
                where: { userId: user.id, reason: 'HOSTING_FEE_WAIFU' },
                _sum: { amount: true },
                _count: { id: true },
              }),
            ]);

            const soulmateIds = new Set(soulmateRows.map((sm) => sm.characterId));
            const entries = haremRows.map((h) => ({
              characterId: h.characterId,
              rarity: h.character.baseRarity as Rarity,
              keys: h.keys,
              claimedAt: h.claimedAt,
              isSoulmate: h.keys >= soulmateKeys || soulmateIds.has(h.characterId),
            }));

            const simulation = simulateInactiveLoss({
              balance: user.kakera,
              harem: entries,
              offlineMs,
              graceMs,
              inflationMultiplier,
            });

            return {
              userId: user.id,
              name: user.name,
              publicId: user.publicId,
              platform: user.platform,
              lastActiveAt: lastActive,
              offlineDays,
              offlineHours: Math.round(offlineMs / 3600000),
              balance: user.kakera,
              waifus: entries.length,
              valueRemainingWithDiscount: haremValueWithDiscount(entries, inflationMultiplier),
              chargedSinceInactive: Math.abs(chargedResult._sum.amount ?? 0),
              totalConfiscatedValue: confiscatedResult._sum.amount ?? 0,
              totalConfiscatedCount: confiscatedResult._count.id ?? 0,
              dailyFee: simulation.todayFee,
              multiplier: simulation.todayMultiplier,
              estimatedDays: simulation.estimatedDays,
            };
          }));

          setAttrs({ 'waifu.inactivity.users_projected': results.length });
          return results;
        }
      );

      // Mais críticos primeiro (estimativa menor sobe); indeterminados por último
      enriched.sort((a, b) => {
        if (a.estimatedDays === null && b.estimatedDays === null) return 0;
        if (a.estimatedDays === null) return 1;
        if (b.estimatedDays === null) return -1;
        return a.estimatedDays - b.estimatedDays;
      });

      const total = enriched.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const items = enriched.slice((page - 1) * limit, page * limit);

      return reply.send({
        success: true,
        data: {
          items,
          pagination: { page, limit, total, totalPages },
          config: {
            graceHours: config.HOSTING_GRACE_HOURS,
            confiscoPermille: config.HOSTING_CONFISCO_PERMILLE ?? 3000,
            maxSimulationDays: DEFAULT_MAX_SIMULATION_DAYS,
          },
        },
      });
    },
  });

  /**
   * Deletar usuário e liberar casamentos associados (Painel Admin)
   */
  fastify.delete('/api/admin/users/:userId', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Remove um usuário e todas as suas dependências (casamentos, sugestões, etc), liberando os personagens casados',
      tags: ['Admin (Web)'],
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

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        include: {
          harem: { select: { characterId: true } },
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: `Usuário '${userId}' não encontrado.` },
        });
      }

      const characterIds = user.harem.map((h) => h.characterId);

      await fastify.prisma.$transaction(async (tx) => {
        if (characterIds.length > 0) {
          await tx.$executeRaw`
            UPDATE characters
            SET "claimCount" = GREATEST(0, "claimCount" - 1)
            WHERE id = ANY(${characterIds})
          `;
        }

        await tx.haremEntry.deleteMany({ where: { userId } });
        await tx.soulmate.deleteMany({ where: { userId } });
        await tx.wishlistEntry.deleteMany({ where: { userId } });
        await tx.characterSuggestion.deleteMany({ where: { userId } });
        await tx.userNotification.deleteMany({ where: { userId } });
        await tx.userCollection.deleteMany({ where: { userId } });
        await tx.characterInvestment.deleteMany({ where: { userId } });
        await tx.kakeraTransaction.deleteMany({ where: { userId } });
        await tx.userGroup.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      });

      return reply.send({
        success: true,
        data: {
          userId,
          freedCharactersCount: characterIds.length,
          message: `Usuário '${userId}' removido com sucesso e ${characterIds.length} casamento(s) desfeito(s).`,
        },
      });
    },
  });

  /**
   * Limpeza geral de dados de teste (Painel Admin)
   */
  fastify.post('/api/admin/cleanup-test-data', {
    preHandler: requireAdminAuth,
    schema: {
      description: 'Remove em lote todos os dados de testes automatizados (usuários teste, sugestões teste, grupos teste) e desfaz casamentos de teste',
      tags: ['Admin (Web)'],
    },
    handler: async (_request, reply) => {
      const testUsers = await fastify.prisma.user.findMany({
        where: {
          AND: [
            { id: { not: 'test-user-1' } },
            {
              OR: [
                {
                  name: {
                    in: [
                      'Test User',
                      'Roll Tester',
                      'Outro Jogador Teste',
                      'Daily Tester',
                      'Tester',
                      'Concurrent Tester',
                      'Jogador Harem Teste',
                      'RollTester',
                      'test_validation_user',
                      'Seed Init User',
                      'Jogador Web Teste',
                      'Jogador Teste Já Lendário',
                      'Jogador Novas Features',
                      'Jogador Teste',
                      'Jogador Teste Casamentos',
                    ],
                  },
                },
                { id: { startsWith: 'test_' } },
                { id: { startsWith: 'another_user_' } },
                { id: { startsWith: 'seed_' } },
                { id: { startsWith: 'roll_tester_' } },
              ],
            },
          ],
        },
        select: {
          id: true,
          harem: { select: { characterId: true } },
        },
      });

      const testUserIds = testUsers.map((u) => u.id);
      const characterIds = Array.from(new Set(testUsers.flatMap((u) => u.harem.map((h) => h.characterId))));

      let freedMarriages = 0;
      let deletedUsers = 0;
      let deletedSuggestions = 0;
      let deletedGroups = 0;

      await fastify.prisma.$transaction(async (tx) => {
        if (characterIds.length > 0) {
          await tx.$executeRaw`
            UPDATE characters
            SET "claimCount" = GREATEST(0, "claimCount" - 1)
            WHERE id = ANY(${characterIds})
          `;
        }

        if (testUserIds.length > 0) {
          const haremRes = await tx.haremEntry.deleteMany({ where: { userId: { in: testUserIds } } });
          freedMarriages = haremRes.count;

          await tx.soulmate.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.wishlistEntry.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.userNotification.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.userCollection.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.characterInvestment.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.kakeraTransaction.deleteMany({ where: { userId: { in: testUserIds } } });
          await tx.userGroup.deleteMany({ where: { userId: { in: testUserIds } } });
          const userRes = await tx.user.deleteMany({ where: { id: { in: testUserIds } } });
          deletedUsers = userRes.count;
        }

        const suggRes = await tx.characterSuggestion.deleteMany({
          where: {
            OR: [
              ...(testUserIds.length > 0 ? [{ userId: { in: testUserIds } }] : []),
              { reason: { contains: 'debounce', mode: 'insensitive' } },
              { suggestedName: { contains: 'debounce', mode: 'insensitive' } },
              { reason: { contains: 'Sugestão para validar', mode: 'insensitive' } },
              { reason: { contains: 'Sugestão de teste', mode: 'insensitive' } },
            ],
          },
        });
        deletedSuggestions = suggRes.count;

        const grpRes = await tx.group.deleteMany({
          where: {
            OR: [
              { id: { startsWith: 'test_' } },
              { id: { startsWith: 'group_roll_tester_' } },
              { id: 'test-group-1' },
            ],
          },
        });
        deletedGroups = grpRes.count;
      });

      return reply.send({
        success: true,
        data: {
          deletedUsers,
          freedMarriages,
          deletedSuggestions,
          deletedGroups,
          message: `Limpeza concluída: ${deletedUsers} usuários removidos, ${freedMarriages} casamentos desfeitos, ${deletedSuggestions} sugestões e ${deletedGroups} grupos de teste apagados.`,
        },
      });
    },
  });
};
