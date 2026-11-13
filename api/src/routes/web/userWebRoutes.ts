import { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSessionService } from '../../services/WebSessionService.js';
import { HaremService } from '../../services/HaremService.js';
import { WishlistService } from '../../services/WishlistService.js';
import { DivorceService } from '../../services/DivorceService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { MarketService } from '../../services/MarketService.js';
import { MarketInvestmentService } from '../../services/MarketInvestmentService.js';
import { CovetService } from '../../services/CovetService.js';
import { NotificationService } from '../../services/NotificationService.js';
import { CatalogService } from '../../services/CatalogService.js';
import { CollectionService } from '../../services/CollectionService.js';
import { UserService } from '../../services/UserService.js';
import { CooldownService } from '../../services/CooldownService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { DomainError } from '../../errors/DomainError.js';
import { optimizeImageUnder1Mb, MAX_IMAGE_UPLOAD_BYTES } from '../../utils/imageOptimizer.js';
import { config, activeHostingRates, inactiveHostingRates, ravenaMarketHeaders } from '../../config.js';
import { toPublicListing, toPublicOffer } from '../../utils/marketPublic.js';
import { Rarity, Gender } from '@prisma/client';

interface RavenaBotHealth {
  id: string;
  phoneNumber: string;
  connected: boolean;
  semPV?: boolean;
  vip?: boolean;
}

let cachedRavenaNumbers: string[] = [];
let lastRavenaHealthFetch = 0;

async function getActiveRavenaNumber(): Promise<string | null> {
  const now = Date.now();
  if (now - lastRavenaHealthFetch > 2 * 60 * 1000) {
    const urlsToTry = [
      process.env.BOT_HEALTH_URL,
      'http://172.22.0.1:5001/health',
      'http://host.docker.internal:5001/health',
      'https://ravena.moothz.com/health',
    ].filter(Boolean) as string[];

    for (const url of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = (await res.json()) as { bots?: RavenaBotHealth[] };
          if (data && Array.isArray(data.bots)) {
            const targetIds = ['ravena2', 'ravena5', 'ravena10'];
            const matched = data.bots.filter(
              (b) => targetIds.includes(b.id) && b.connected && !b.semPV && b.phoneNumber
            );
            if (matched.length > 0) {
              cachedRavenaNumbers = matched.map((b) => b.phoneNumber.replace(/\D/g, ''));
            } else {
              const fallbackBots = data.bots.filter(
                (b) => b.connected && !b.semPV && !b.vip && b.phoneNumber
              );
              if (fallbackBots.length > 0) {
                cachedRavenaNumbers = fallbackBots.map((b) => b.phoneNumber.replace(/\D/g, ''));
              }
            }
            lastRavenaHealthFetch = now;
            break;
          }
        }
      } catch {
        // Falha nesta URL, tenta a próxima
      }
    }
  }

  if (cachedRavenaNumbers.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * cachedRavenaNumbers.length);
  return cachedRavenaNumbers[randomIndex] || null;
}

export const userWebRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const haremService = new HaremService(fastify.prisma, characterService);
  const wishlistService = new WishlistService(fastify.prisma, characterService);
  const marketInvestmentService = new MarketInvestmentService(fastify.prisma, characterService, fastify.redis);
  const divorceService = new DivorceService(fastify.prisma, marketInvestmentService, fastify.redis);
  const webSessionService = new WebSessionService(fastify.redis, fastify.prisma);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);
  const cooldownService = new CooldownService(fastify.redis);
  const marketService = new MarketService(fastify.prisma, characterService, cooldownService);
  const covetService = new CovetService(fastify.prisma, characterService, wishlistService);
  const notificationService = new NotificationService(fastify.prisma);
  const catalogService = new CatalogService(fastify.prisma, fastify.redis);
  const collectionService = new CollectionService(fastify.prisma, characterService);
  const userService = new UserService(fastify.prisma, fastify.redis);

  /**
   * Retorna um número de WhatsApp ativo da Ravena para redirecionamento com !mu-adm
   */
  fastify.get('/api/web/ravena-contact', {
    schema: {
      description: 'Retorna um número ativo de Ravena para iniciar o comando !mu-adm via WhatsApp',
      tags: ['Usuário (Web)'],
    },
    handler: async (_request, reply) => {
      const phoneNumber = await getActiveRavenaNumber();
      const text = '!mu-adm';
      const waLink = phoneNumber ? `https://wa.me/${phoneNumber}?text=${encodeURIComponent(text)}` : null;
      return reply.send({
        success: true,
        data: {
          phoneNumber,
          text,
          waLink,
        },
      });
    },
  });

  /**
   * Endpoint chamado pelo Bot Ravena para criar sessão de 30 minutos
   * Requer API_KEY do bot
   */
  fastify.post('/user/session', {
    preHandler: verifyApiKey,
    schema: {
      description: 'Gera link de acesso web temporário (30 minutos) para o usuário',
      tags: ['Usuário (Web)'],
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
          inventory: { type: 'object' },
        },
      },
    },
    handler: async (request, reply) => {
      const { userId, inventory } = request.body as { userId: string; inventory?: any };
      const session = await webSessionService.createUserSession(userId, inventory);
      return reply.send({
        success: true,
        data: session,
      });
    },
  });

  /**
   * Consulta pública/privada do usuário pelo publicId
   */
  fastify.get('/api/web/user/:publicId', {
    schema: {
      description: 'Consulta perfil do usuário e seu harém (público ou administrativo se token fornecido)',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: {
          publicId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token?: string };

      const user = await fastify.prisma.user.findUnique({
        where: { publicId },
        select: {
          id: true,
          publicId: true,
          name: true,
          kakera: true,
          haremName: true,
          haremPrivate: true,
          mythicSlots: true,
          lastActiveAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const session = await webSessionService.validateUserSession(publicId, token);
      const isOwner = session.valid && session.userId === user.id;

      // Busca o harém completo do usuário (sem teto artificial) e coleções
      const [haremResult, userCollections] = await Promise.all([
        haremService.getUserHarem(user.id, 1, 0, 'keys'),
        collectionService.listUserCollections(user.id),
      ]);

      // Cálculo de Custo Diário de Hospedagem
      const now = Date.now();
      const lastActiveTime = user.lastActiveAt
        ? new Date(user.lastActiveAt).getTime()
        : new Date(user.updatedAt).getTime();
      const graceMs = config.HOSTING_GRACE_HOURS * 3600 * 1000;
      const isInactive = (now - lastActiveTime) > graceMs;
      const rates = isInactive ? inactiveHostingRates : activeHostingRates;

      // Míticos não pagam taxa (HostingFeeService); a contagem segue a mesma regra
      const buildHostingCostInfo = (entries: typeof haremResult.data) => {
        const rarityCounts: Record<string, number> = { COMMON: 0, UNCOMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 };
        let counted = 0;
        for (const item of entries) {
          if ((item.character as any)?.isMythic) continue;
          const r = (item.character?.baseRarity || 'COMMON').toUpperCase();
          if (rarityCounts[r] !== undefined) {
            rarityCounts[r]++;
            counted++;
          }
        }
        const rarityCosts: Record<string, number> = {
          COMMON: rarityCounts.COMMON * rates.COMMON,
          UNCOMMON: rarityCounts.UNCOMMON * rates.UNCOMMON,
          RARE: rarityCounts.RARE * rates.RARE,
          EPIC: rarityCounts.EPIC * rates.EPIC,
          LEGENDARY: rarityCounts.LEGENDARY * rates.LEGENDARY,
        };
        return {
          isInactive,
          totalCost: Object.values(rarityCosts).reduce((acc, c) => acc + c, 0),
          rates,
          counts: rarityCounts,
          costs: rarityCosts,
          totalWaifus: counted,
        };
      };

      // Dono vê o harém inteiro; visitantes só o que está fora de coleções privadas
      const hostingCostInfo = buildHostingCostInfo(haremResult.data);

      if (isOwner) {
        const wishlistResult = await wishlistService.getWishlist(user.id);
        const covetCountsMap = await covetService.getHaremCovetCounts(user.id);
        const covetedCharacterIds = await covetService.getUserCovetedCharacterIds(user.id);
        const unreadNotificationsCount = await fastify.prisma.userNotification.count({
          where: { userId: user.id, isRead: false },
        });

        const enrichedHarem = haremResult.data.map((item) => ({
          ...item,
          unseenCovetsCount: covetCountsMap[item.character.id]?.unseen || 0,
          totalCovetsCount: covetCountsMap[item.character.id]?.total || 0,
          activeCovetsCount: covetCountsMap[item.character.id]?.active || 0,
        }));

        let currentInventory = session.inventory || null;
        if (currentInventory) {
          try {
            const cleanId = user.id.replace(/\D/g, '');
            const jardimRes = await fetch(`${process.env.JARDIM_API_URL || 'http://172.22.0.1:3040'}/inventory/${cleanId}`, {
              signal: AbortSignal.timeout(1500),
            });
            if (jardimRes.ok) {
              const jData = (await jardimRes.json()) as any;
              if (jData && Array.isArray(jData.items)) {
                currentInventory = {
                  ...currentInventory,
                  farmItems: jData.items.map((it: any) => ({
                    itemId: it.itemId,
                    name: it.name,
                    quantity: it.quantity,
                    type: it.type,
                  })),
                };
              }
            }
          } catch {
            // fallback para snapshot em session.inventory
          }
        }

        return reply.send({
          success: true,
          data: {
            isAdmin: true,
            publicId: user.publicId,
            name: user.name,
            haremName: user.haremName || null,
            haremPrivate: Boolean(user.haremPrivate),
            kakera: user.kakera,
            mythicSlots: user.mythicSlots || 0,
            expiresIn: session.expiresIn,
            isPersistent: session.isPersistent,
            unreadNotificationsCount,
            harem: enrichedHarem,
            totalHarem: haremResult.total,
            collections: userCollections,
            wishlist: wishlistResult,
            covetedCharacterIds,
            inventory: currentInventory,
            hostingCost: hostingCostInfo,
          },
        });
      }

      // Se o usuário optou por privar seu harém, não exibe informações públicas
      if (user.haremPrivate) {
        return reply.send({
          success: true,
          data: {
            isAdmin: false,
            isPrivate: true,
            publicId: user.publicId,
            name: user.name,
            message: `O usuário ${user.name} decidiu privar seu harém.`,
          },
        });
      }

      // Visualização pública: filtra coleções privadas e waifus contidas nelas
      const publicCollections = userCollections.filter((c) => !c.isPrivate);
      const visibleEntries = haremResult.data.filter((item) => !item.collection?.isPrivate);

      // Visualização pública: proteção estrita de PII (omite claimedInGroup, notas privadas e IDs internos)
      const publicHarem = visibleEntries.map((item) => ({
        id: item.id,
        character: {
          id: item.character.id,
          name: item.character.name,
          series: item.character.series,
          baseRarity: item.character.baseRarity,
          imageUrl: item.character.imageUrl,
          imageUrls: item.character.imageUrls,
          isMythic: Boolean(item.character.isMythic),
          mythicCustomization: item.character.mythicCustomization || null,
        },
        keys: item.keys,
        isFavorite: item.isFavorite,
        claimedAt: item.claimedAt,
        collectionId: item.collectionId,
        collection: item.collection,
        pinnedPhoto: item.pinnedPhoto || null,
      }));

      // Busca os classificados ativos deste usuário para a aba pública de classificados
      const userListings = await fastify.prisma.marketListing.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          character: {
            include: {
              _count: {
                select: { wishlists: true },
              },
            },
          },
        },
      });

      const publicListings = userListings.map((l) => ({
        id: l.id,
        interest: l.interest,
        createdAt: l.createdAt,
        character: marketService.formatCharacter(l.character),
      }));

      return reply.send({
        success: true,
        data: {
          isAdmin: false,
          isPrivate: false,
          publicId: user.publicId,
          name: user.name,
          haremName: user.haremName || null,
          kakera: user.kakera,
          harem: publicHarem,
          collections: publicCollections,
          totalHarem: visibleEntries.length,
          listings: publicListings,
          hostingCost: buildHostingCostInfo(visibleEntries),
        },
      });
    },
  });

  /**
   * Altera o nome de exibição do harém do usuário (limite 20 caracteres)
   */
  fastify.patch('/api/web/user/:publicId/harem-name', {
    schema: {
      description: 'Altera o nome do harém do usuário via painel web administrativo',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          haremName: { type: ['string', 'null'], maxLength: 20 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, haremName } = request.body as { token: string; haremName?: string | null };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const updatedUser = await userService.updateHaremName(session.userId, haremName || null);

      return reply.send({
        success: true,
        data: {
          haremName: updatedUser.haremName,
        },
      });
    },
  });

  /**
   * Altera a visibilidade pública/privada do harém do usuário
   */
  fastify.patch('/api/web/user/:publicId/harem-privacy', {
    schema: {
      description: 'Define se o harém do usuário é privado ou público',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'isPrivate'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
          isPrivate: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, isPrivate } = request.body as { token: string; isPrivate: boolean };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const updatedUser = await userService.updateHaremPrivacy(session.userId, isPrivate);

      return reply.send({
        success: true,
        data: {
          haremPrivate: updatedUser.haremPrivate,
          message: updatedUser.haremPrivate
            ? 'Seu harém agora é privado. Visitantes não poderão visualizar seus personagens.'
            : 'Seu harém agora é público.',
        },
      });
    },
  });

  /**
   * Reordena as coleções do usuário via drag-and-drop
   */
  fastify.put('/api/web/user/:publicId/collections/order', {
    schema: {
      description: 'Reordena as coleções do usuário via lista ordenada de IDs',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'order'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
          order: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, order } = request.body as { token: string; order: string[] };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const updatedCollections = await collectionService.reorderCollections(session.userId, order);

      return reply.send({
        success: true,
        data: {
          collections: updatedCollections,
        },
      });
    },
  });

  /**
   * Alterna ou define a visibilidade privada de uma coleção
   */
  fastify.patch('/api/web/user/:publicId/collections/:collectionId/privacy', {
    schema: {
      description: 'Alterna a privacidade de uma coleção (privada ou pública)',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'collectionId'],
        properties: {
          publicId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
          isPrivate: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, collectionId } = request.params as { publicId: string; collectionId: string };
      const { token, isPrivate } = request.body as { token: string; isPrivate?: boolean };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.setCollectionPrivacy(session.userId, collectionId, isPrivate);

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Retorna as fotos disponíveis para escolha (fotos oficiais + foto de casamento)
   */
  fastify.get('/api/web/user/:publicId/harem/:characterId/photos', {
    schema: {
      description: 'Retorna todas as opções de fotos de um personagem no harém',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const data = await haremService.getPhotoOptions(session.userId, characterId);

      return reply.send({
        success: true,
        data,
      });
    },
  });

  /**
   * Fixa a foto escolhida do personagem no harém ou volta para aleatória
   */
  fastify.put('/api/web/user/:publicId/harem/:characterId/photo', {
    schema: {
      description: 'Define a foto fixa do personagem no harém ou restaura para aleatória',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
          photo: { type: ['string', 'number', 'null'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token, photo } = request.body as { token: string; photo: string | number | null };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await haremService.setPinnedPhoto(session.userId, characterId, photo);

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Proxy de streaming da foto oficial de casamento (provida pela Ravena)
   */
  fastify.get('/api/web/marriage-photo/:characterId', {
    schema: {
      description: 'Proxy de streaming da foto de casamento',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['characterId'],
        properties: { characterId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { characterId } = request.params as { characterId: string };
      const targetUrl = `${config.RAVENA_API_URL}/api/waifuletes/marriage-photo/${encodeURIComponent(characterId)}`;

      try {
        const response = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok || !response.body) {
          return reply.status(response.status === 404 ? 404 : 502).send({
            success: false,
            error: { code: 'PHOTO_NOT_FOUND', message: 'Foto de casamento não encontrada.' },
          });
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

        const arrayBuffer = await response.arrayBuffer();
        return reply.send(Buffer.from(arrayBuffer));
      } catch {
        return reply.status(502).send({
          success: false,
          error: { code: 'UPSTREAM_ERROR', message: 'Erro ao consultar foto de casamento na Ravena.' },
        });
      }
    },
  });

  /**
   * Torna a sessão do usuário persistente por 3 dias
   */
  fastify.post('/api/web/user/:publicId/persist-session', {
    schema: {
      description: 'Ativa o modo manter login (sessão persistente por 3 dias)',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.body as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await webSessionService.persistUserSession(publicId, token);
      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Encerra a sessão do usuário (Logout)
   */
  fastify.post('/api/web/user/:publicId/logout', {
    schema: {
      description: 'Encerra a sessão ativa do usuário no navegador',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { token } = (request.body as { token?: string }) || {};
      if (token) {
        await webSessionService.invalidateUserSession(token);
      }
      return reply.send({
        success: true,
        data: { message: 'Sessão encerrada com sucesso.' },
      });
    },
  });

  /**
   * Dá curtida/like em um personagem via painel web
   */
  fastify.post('/api/web/user/:publicId/characters/:characterId/like', {
    schema: {
      description: 'Dá curtida/like em um personagem respeitando o reset diário das 04:00',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.body as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Você precisa estar logado para curtir personagens.' },
        });
      }

      const updated = await characterService.likeCharacter(session.userId, characterId);
      return reply.send({
        success: true,
        data: {
          message: `Você curtiu ${updated.name}! ❤️`,
          likeCount: updated.likeCount,
          characterId: updated.id,
        },
      });
    },
  });

  /**
   * Obtém lote de cards para o catálogo estilo Tinder (Waifinder)
   */
  fastify.get('/api/web/catalog/deck', {
    schema: {
      description: 'Obtém deck de 15 personagens balanceados por raridade e não casados para o Waifinder',
      tags: ['Usuário (Web)'],
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          publicId: { type: 'string' },
          excludeIds: { type: 'string' },
          gender: { type: 'string', enum: ['ALL', 'FEMALE', 'MALE'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { token, publicId, excludeIds, gender } = request.query as {
        token?: string;
        publicId?: string;
        excludeIds?: string;
        gender?: 'ALL' | 'FEMALE' | 'MALE';
      };

      let sessionUserId: string | null = null;
      let sessionPublicId: string | null = null;
      let userKakera = 0;
      let userName = '';

      if (token) {
        const session = publicId
          ? await webSessionService.validateUserSession(publicId, token)
          : await webSessionService.validateTokenOnly(token);

        if (session.valid && session.userId) {
          sessionUserId = session.userId;
          sessionPublicId = session.publicId;

          const user = await fastify.prisma.user.findUnique({
            where: { id: sessionUserId },
            select: { name: true, kakera: true, publicId: true },
          });

          if (user) {
            userName = user.name;
            userKakera = user.kakera;
            sessionPublicId = user.publicId;
          }
        }
      }

      const parsedExclude = excludeIds
        ? excludeIds
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [];

      const result = await catalogService.getDeck({
        userId: sessionUserId,
        excludeIds: parsedExclude,
        gender,
      });

      return reply.send({
        success: true,
        data: {
          characters: result.characters,
          authenticated: Boolean(sessionUserId),
          user: sessionUserId
            ? {
                name: userName,
                publicId: sessionPublicId,
                kakera: userKakera,
              }
            : null,
        },
      });
    },
  });

  /**
   * Consulta histórico de notificações do usuário
   */
  fastify.get('/api/web/user/:publicId/notifications', {
    schema: {
      description: 'Consulta lista paginada de notificações do usuário com contagem de não lidas',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          unreadOnly: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, page, limit, unreadOnly } = request.query as {
        token: string;
        page?: number;
        limit?: number;
        unreadOnly?: boolean;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await notificationService.getUserNotifications(session.userId, {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        unreadOnly: Boolean(unreadOnly),
      });

      return reply.send({
        success: true,
        data: result,
      });
    },
  });

  /**
   * Marca notificações como lidas
   */
  fastify.post('/api/web/user/:publicId/notifications/read', {
    schema: {
      description: 'Marca notificações específicas ou todas as pendentes como lidas',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { token: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          notificationIds: {
            type: 'array',
            items: { type: 'string' },
          },
          all: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const body = (request.body as any) || {};
      const query = (request.query as any) || {};
      const token = body.token || query.token;
      const notificationIds = body.notificationIds as string[] | undefined;
      const all = Boolean(body.all);

      if (!token) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Token de sessão obrigatório.' },
        });
      }

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      if (all) {
        await notificationService.markAllAsRead(session.userId);
      } else {
        await notificationService.markAsRead(session.userId, notificationIds);
      }

      return reply.send({
        success: true,
        data: { message: 'Notificações marcadas como lidas.' },
      });
    },
  });

  /**
   * Consulta a estimativa de reembolso de divórcio (preview) para exibição no popup de confirmação
   */
  fastify.get('/api/web/user/:publicId/divorce/preview/:characterId', {
    schema: {
      description: 'Retorna o valor estimado de reembolso em Zinthos para divórcio antes da confirmação',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const preview = await divorceService.previewDivorce(session.userId, characterId);
      return reply.send({ success: true, data: preview });
    },
  });

  /**
   * Divórcio via sessão web do usuário
   */
  fastify.post('/api/web/user/:publicId/divorce', {
    schema: {
      description: 'Executa divórcio de um personagem pertencente ao harém do usuário autenticado por token',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId } = request.body as { token: string; characterId: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida. Gere um novo link no WhatsApp.' },
        });
      }

      const result = await divorceService.divorce(session.userId, characterId);
      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  /**
   * Alterna favorita em destaque via sessão web do usuário
   */
  fastify.post('/api/web/user/:publicId/favorite', {
    schema: {
      description: 'Alterna status de favorita (máximo 5) para um personagem pertencente ao harém',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId } = request.body as { token: string; characterId: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida. Gere um novo link no WhatsApp.' },
        });
      }

      const result = await haremService.setFavorite(session.userId, characterId);
      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  /**
   * Cria uma nova coleção via painel web do usuário
   */
  fastify.post('/api/web/user/:publicId/collections', {
    schema: {
      description: 'Cria uma nova coleção de personagens (limite de 15) no harém',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'name'],
        properties: {
          token: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string', maxLength: 200 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, name, description } = request.body as { token: string; name: string; description?: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.createCollection(session.userId, name, description);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Atualiza o nome ou descrição de uma coleção via painel web
   */
  fastify.patch('/api/web/user/:publicId/collections/:collectionId', {
    schema: {
      description: 'Atualiza o nome ou descrição de uma coleção do usuário',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'collectionId'],
        properties: {
          publicId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          name: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string', maxLength: 200 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, collectionId } = request.params as { publicId: string; collectionId: string };
      const { token, name, description } = request.body as { token: string; name?: string; description?: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.updateCollection(session.userId, collectionId, { name, description });
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Remove uma coleção via painel web
   */
  fastify.delete('/api/web/user/:publicId/collections/:collectionId', {
    schema: {
      description: 'Apaga uma coleção do usuário, retornando os personagens ao harém geral',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'collectionId'],
        properties: {
          publicId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, collectionId } = request.params as { publicId: string; collectionId: string };
      const { token } = (request.query as { token?: string }) || {};
      const bodyToken = (request.body as { token?: string })?.token;
      const actualToken = token || bodyToken;

      const session = await webSessionService.validateUserSession(publicId, actualToken);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.deleteCollection(session.userId, collectionId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Adiciona waifu a uma coleção via painel web
   */
  fastify.post('/api/web/user/:publicId/collections/:collectionId/characters', {
    schema: {
      description: 'Adiciona ou move uma waifu do harém para a coleção especificada',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'collectionId'],
        properties: {
          publicId: { type: 'string' },
          collectionId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, collectionId } = request.params as { publicId: string; collectionId: string };
      const { token, characterId } = request.body as { token: string; characterId: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.addCharacterToCollection(session.userId, collectionId, characterId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Remove waifu de sua coleção via painel web
   */
  fastify.delete('/api/web/user/:publicId/collections/characters/:characterId', {
    schema: {
      description: 'Remove uma waifu de qualquer coleção, voltando ao harém geral',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = (request.query as { token?: string }) || {};
      const bodyToken = (request.body as { token?: string })?.token;
      const actualToken = token || bodyToken;

      const session = await webSessionService.validateUserSession(publicId, actualToken);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await collectionService.removeCharacterFromCollection(session.userId, characterId);
      return reply.send({ success: true, data: result });
    },
  });

  /**
   * Adiciona personagem à wishlist via sessão web
   */
  fastify.post('/api/web/user/:publicId/wishlist', {
    schema: {
      description: 'Adiciona um personagem à lista de desejos do usuário autenticado por token',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
          isStarWish: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId, isStarWish = false } = request.body as {
        token: string;
        characterId: string;
        isStarWish?: boolean;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await wishlistService.addToWishlist(session.userId, characterId, isStarWish);
      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  /**
   * Remove personagem da wishlist via sessão web
   */
  fastify.delete('/api/web/user/:publicId/wishlist/:characterId', {
    schema: {
      description: 'Remove um personagem da lista de desejos do usuário autenticado por token',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await wishlistService.removeFromWishlist(session.userId, characterId);
      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    },
  });

  /**
   * Remove todas as personagens casadas (ou apenas as casadas com o próprio usuário) da wishlist via sessão web
   */
  fastify.delete('/api/web/user/:publicId/wishlist/married', {
    schema: {
      description: 'Remove personagens que já estão casadas da lista de desejos do usuário',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          onlySelf: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, onlySelf } = request.query as { token: string; onlySelf?: string | boolean };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const isOnlySelf = onlySelf === 'true' || onlySelf === true || onlySelf === '1';
      const result = await wishlistService.clearMarried(session.userId, isOnlySelf);
      return reply.send(result);
    },
  });

  /**
   * Lista as sugestões enviadas pelo usuário
   */
  fastify.get('/api/web/user/:publicId/suggestions', {
    schema: {
      description: 'Lista histórico de sugestões enviadas pelo usuário autenticado',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const suggestions = await suggestionService.listUserSuggestions(session.userId);
      const blockInfo = await suggestionService.getUserSuggestionBlock(session.userId);
      return reply.send({
        success: true,
        data: {
          suggestions,
          isBlocked: Boolean(blockInfo),
          blockInfo: blockInfo ? { duration: blockInfo.duration, expiresAt: blockInfo.expiresAt, reason: blockInfo.reason } : null,
        },
      });
    },
  });

  /**
   * Envia sugestão de raridade, nova foto ou novo personagem
   */
  fastify.post('/api/web/user/:publicId/suggestions', {
    schema: {
      description: 'Envia sugestão de nova raridade, nova imagem ou cadastro de novo personagem',
      tags: ['Usuário (Web)'],
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };

      if (request.isMultipart()) {
        const parts = request.parts();
        let token = '';
        let characterId = '';
        let characterName = '';
        let series = '';
        let description = '';
        let type = '';
        let suggestedName = '';
        let suggestedSeries = '';
        let suggestedGender: any = null;
        let suggestedDescription = '';
        let suggestedTags: string[] = [];
        let suggestedRarity = '';
        let action: 'ADD' | 'DELETE' | 'REPLACE' = 'ADD';
        let targetPhoto = '';
        let reason = '';
        let confirmationPhrase = '';
        let imageBuffer: Buffer | null = null;

        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'token') token = String(part.value);
            if (part.fieldname === 'characterId') characterId = String(part.value);
            if (part.fieldname === 'characterName' || part.fieldname === 'name') characterName = String(part.value);
            if (part.fieldname === 'series') series = String(part.value);
            if (part.fieldname === 'description') description = String(part.value);
            if (part.fieldname === 'type') type = String(part.value);
            if (part.fieldname === 'suggestedName') suggestedName = String(part.value);
            if (part.fieldname === 'suggestedSeries') suggestedSeries = String(part.value);
            if ((part.fieldname === 'suggestedGender' || part.fieldname === 'gender') && ['FEMALE', 'MALE', 'OTHER'].includes(String(part.value).toUpperCase())) {
              suggestedGender = String(part.value).toUpperCase() as any;
            }
            if (part.fieldname === 'suggestedDescription') suggestedDescription = String(part.value);
            if (part.fieldname === 'suggestedTags') {
              suggestedTags = String(part.value).split(',').map((t) => t.trim()).filter(Boolean);
            }
            if (part.fieldname === 'suggestedRarity' || part.fieldname === 'rarity') suggestedRarity = String(part.value);
            if (part.fieldname === 'action' || part.fieldname === 'photoAction') {
              const act = String(part.value).toUpperCase();
              if (act === 'DELETE' || act === 'DELETE_PHOTO') action = 'DELETE';
              else if (act === 'REPLACE' || act === 'REPLACE_PHOTO') action = 'REPLACE';
              else action = 'ADD';
            }
            if (part.fieldname === 'targetPhoto') targetPhoto = String(part.value);
            if (part.fieldname === 'reason') reason = String(part.value);
            if (part.fieldname === 'confirmationPhrase') confirmationPhrase = String(part.value);
          } else if (part.type === 'file' && (part.fieldname === 'image' || part.fieldname === 'photo')) {
            imageBuffer = await part.toBuffer();
          }
        }

        const session = publicId === 'token-session'
          ? await webSessionService.validateTokenOnly(token)
          : await webSessionService.validateUserSession(publicId, token);
        if (!session.valid || !session.userId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
          });
        }

        await suggestionService.assertUserNotBlocked(session.userId);

        const checkConfirmationPhrase = (phrase: string) => {
          const norm = (phrase || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return norm === 'personagem casado criar versao lendaria';
        };

        if (type === 'NEW_CHARACTER') {
          // Personagem de origem já Lendário => não existe upgrade, as travas de casado não se aplicam
          const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
          const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
            ? await suggestionService.wasCharacterEverMarried(characterId)
            : false;
          if (wasMarried && suggestedRarity === 'LEGENDARY') {
            if (!imageBuffer || imageBuffer.length === 0) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
                },
              });
            }
            if (!checkConfirmationPhrase(confirmationPhrase)) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'CONFIRMATION_PHRASE_REQUIRED',
                  message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
                },
              });
            }
          }

          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: characterName,
            series,
            rarity: (suggestedRarity || 'COMMON') as Rarity,
            gender: suggestedGender || undefined,
            description,
            reason,
            imageBuffer: imageBuffer || undefined,
            originCharacterId: characterId || undefined,
          });
          return reply.send({
            success: true,
            data: {
              message: 'Sugestão de novo personagem enviada com sucesso! A equipe irá avaliar.',
              suggestion,
            },
          });
        } else if (type === 'EDIT') {
          const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
          const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
            ? await suggestionService.wasCharacterEverMarried(characterId)
            : false;
          if (wasMarried) {
            const normalizedReason = (reason || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase();
            const attemptsLegendaryInReason = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(
              normalizedReason
            );
            if (attemptsLegendaryInReason && suggestedRarity !== 'LEGENDARY') {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'MARRIED_CHARACTER_MAX_EPIC',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Pedidos de alteração para Lendário não podem ser feitos via justificativa ou edição de dados.',
                },
              });
            }
          }

          if (wasMarried && suggestedRarity === 'LEGENDARY') {
            if (!imageBuffer || imageBuffer.length === 0) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
                },
              });
            }
            if (!checkConfirmationPhrase(confirmationPhrase)) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'CONFIRMATION_PHRASE_REQUIRED',
                  message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
                },
              });
            }
            const char = originCharacter;
            const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
              name: (suggestedName || characterName || char?.name || '').trim(),
              series: (suggestedSeries || series || char?.series || '').trim(),
              rarity: 'LEGENDARY',
              gender: suggestedGender || char?.gender || undefined,
              description: suggestedDescription || description || char?.description || undefined,
              reason: reason ? `[Versão Lendária] ${reason.trim()}` : '[Versão Lendária]',
              imageBuffer,
              originCharacterId: characterId,
            });
            return reply.send({
              success: true,
              data: {
                message: 'Como o personagem já foi casado, sua sugestão foi registrada para a criação de um NOVO personagem na versão Lendária! A moderação irá analisar.',
                suggestion,
              },
            });
          }

          const suggestion = await suggestionService.submitEditSuggestion(session.userId, characterId, {
            suggestedName: suggestedName || (characterName ? characterName : undefined),
            suggestedSeries: suggestedSeries || (series ? series : undefined),
            suggestedGender: suggestedGender || undefined,
            suggestedDescription: suggestedDescription || (description ? description : undefined),
            suggestedRarity: (suggestedRarity as Rarity) || undefined,
            suggestedTags: suggestedTags.length > 0 ? suggestedTags : undefined,
            reason,
          });
          return reply.send({
            success: true,
            data: {
              message: 'Sugestão de alteração de dados enviada com sucesso! A moderação irá analisar.',
              suggestion,
            },
          });
        } else if (type === 'IMAGE') {
          const suggestion = await suggestionService.submitImageSuggestion(
            session.userId,
            characterId,
            imageBuffer,
            reason,
            action,
            targetPhoto
          );
          return reply.send({
            success: true,
            data: {
              message: action === 'DELETE'
                ? 'Sugestão de exclusão de foto enviada para moderação!'
                : (action === 'REPLACE' ? 'Sugestão de substituição de foto enviada para moderação!' : 'Sugestão de foto enviada com sucesso!'),
              suggestion,
            },
          });
        } else if (type === 'RARITY') {
          const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
          const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
            ? await suggestionService.wasCharacterEverMarried(characterId)
            : false;
          if (wasMarried) {
            const normalizedReason = (reason || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase();
            const attemptsLegendaryInReason = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(
              normalizedReason
            );
            if (attemptsLegendaryInReason && suggestedRarity !== 'LEGENDARY') {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'MARRIED_CHARACTER_MAX_EPIC',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Pedidos de alteração para Lendário não podem ser feitos via justificativa.',
                },
              });
            }
          }

          if (wasMarried && suggestedRarity === 'LEGENDARY') {
            if (!imageBuffer || imageBuffer.length === 0) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
                },
              });
            }
            if (!checkConfirmationPhrase(confirmationPhrase)) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'CONFIRMATION_PHRASE_REQUIRED',
                  message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
                },
              });
            }
            const char = originCharacter;
            const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
              name: (characterName || char?.name || characterId).trim(),
              series: (series || char?.series || 'Indefinida').trim(),
              rarity: 'LEGENDARY',
              gender: char?.gender || undefined,
              description: char?.description || undefined,
              reason: reason ? `[Versão Lendária] ${reason.trim()}` : '[Versão Lendária]',
              imageBuffer,
              originCharacterId: characterId,
            });
            return reply.send({
              success: true,
              data: {
                message: 'Como o personagem já foi casado, sua sugestão foi registrada para a criação de um NOVO personagem na versão Lendária! A moderação irá analisar.',
                suggestion,
              },
            });
          }

          const suggestion = await suggestionService.submitRaritySuggestion(
            session.userId,
            characterId,
            suggestedRarity as Rarity,
            reason
          );
          return reply.send({
            success: true,
            data: {
              message: 'Sugestão de raridade enviada com sucesso! A moderação irá analisar.',
              suggestion,
            },
          });
        }

        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_SUGGESTION_TYPE', message: 'Tipo de sugestão inválido.' },
        });
      }

      // JSON direto
      const {
        token,
        type,
        characterId,
        characterName,
        series,
        description,
        gender,
        suggestedName,
        suggestedSeries,
        suggestedGender,
        suggestedDescription,
        suggestedTags,
        suggestedRarity,
        action: bodyAction,
        photoAction,
        targetPhoto,
        reason,
        confirmationPhrase,
        imageBase64,
      } = (request.body as any) || {};

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      await suggestionService.assertUserNotBlocked(session.userId);

      const checkConfirmationPhrase = (phrase: string) => {
        const norm = (phrase || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return norm === 'personagem casado criar versao lendaria';
      };

      if (type === 'NEW_CHARACTER') {
        // Personagem de origem já Lendário => não existe upgrade, as travas de casado não se aplicam
        const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
        const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
          ? await suggestionService.wasCharacterEverMarried(characterId)
          : false;
        let buffer: Buffer | undefined;
        if (imageBase64) {
          buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }

        if (wasMarried && suggestedRarity === 'LEGENDARY') {
          if (!buffer || buffer.length === 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
              },
            });
          }
          if (!checkConfirmationPhrase(confirmationPhrase)) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'CONFIRMATION_PHRASE_REQUIRED',
                message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
              },
            });
          }
        }

        const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
          name: characterName,
          series,
          rarity: (suggestedRarity || 'COMMON') as Rarity,
          gender: ((suggestedGender || gender) as Gender) || undefined,
          description,
          reason,
          imageBuffer: buffer,
          originCharacterId: characterId || undefined,
        });
        return reply.send({
          success: true,
          data: {
            message: 'Sugestão de novo personagem enviada com sucesso! A moderação irá analisar.',
            suggestion,
          },
        });
      } else if (type === 'EDIT') {
        const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
        const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
          ? await suggestionService.wasCharacterEverMarried(characterId)
          : false;
        if (wasMarried) {
          const normalizedReason = (reason || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          const attemptsLegendaryInReason = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(
            normalizedReason
          );
          if (attemptsLegendaryInReason && suggestedRarity !== 'LEGENDARY') {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'MARRIED_CHARACTER_MAX_EPIC',
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Pedidos de alteração para Lendário não podem ser feitos via justificativa ou edição de dados.',
              },
            });
          }
        }

        if (wasMarried && suggestedRarity === 'LEGENDARY') {
          let buffer: Buffer | undefined;
          if (imageBase64) {
            buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          }
          if (!buffer || buffer.length === 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
              },
            });
          }
          if (!checkConfirmationPhrase(confirmationPhrase)) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'CONFIRMATION_PHRASE_REQUIRED',
                message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
              },
            });
          }
          const char = originCharacter;
          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: (suggestedName || characterName || char?.name || '').trim(),
            series: (suggestedSeries || series || char?.series || '').trim(),
            rarity: 'LEGENDARY',
            gender: ((suggestedGender || gender || char?.gender) as Gender) || undefined,
            description: suggestedDescription || description || char?.description || undefined,
            reason: reason ? `[Versão Lendária] ${reason.trim()}` : '[Versão Lendária]',
            imageBuffer: buffer,
            originCharacterId: characterId,
          });
          return reply.send({
            success: true,
            data: {
              message: 'Como o personagem já foi casado, sua sugestão foi registrada para a criação de um NOVO personagem na versão Lendária! A moderação irá analisar.',
              suggestion,
            },
          });
        }

        const suggestion = await suggestionService.submitEditSuggestion(session.userId, characterId, {
          suggestedName: suggestedName || characterName,
          suggestedSeries: suggestedSeries || series,
          suggestedGender: ((suggestedGender || gender) as Gender) || undefined,
          suggestedDescription: suggestedDescription || description,
          suggestedRarity: suggestedRarity as Rarity,
          suggestedTags: Array.isArray(suggestedTags)
            ? suggestedTags
            : (typeof suggestedTags === 'string' ? suggestedTags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined),
          reason,
        });
        return reply.send({
          success: true,
          data: {
            message: 'Sugestão de alteração de dados enviada com sucesso! A moderação irá analisar.',
            suggestion,
          },
        });
      } else if (type === 'RARITY') {
        const originCharacter = characterId ? await characterService.findCharacter(characterId) : null;
        const wasMarried = (characterId && originCharacter?.baseRarity !== 'LEGENDARY')
          ? await suggestionService.wasCharacterEverMarried(characterId)
          : false;
        if (wasMarried) {
          const normalizedReason = (reason || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          const attemptsLegendaryInReason = /\b(lenda\w*|legend\w*|upgrade\w*|subir raridade|aumentar raridade|mudar raridade|virar lenda\w*|passar pra lenda\w*|bota.*lenda\w*|coloca.*lenda\w*|p[oõ]e.*lenda\w*)/i.test(
            normalizedReason
          );
          if (attemptsLegendaryInReason && suggestedRarity !== 'LEGENDARY') {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'MARRIED_CHARACTER_MAX_EPIC',
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Pedidos de alteração para Lendário não podem ser feitos via justificativa.',
              },
            });
          }
        }

        if (wasMarried && suggestedRarity === 'LEGENDARY') {
          let buffer: Buffer | undefined;
          if (imageBase64) {
            buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          }
          if (!buffer || buffer.length === 0) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Você deveria ter feito a sugestão antes de se casar com o personagem, esta ação é mal vista pela administração, pois parece abuso do sistema para tentar fazer upgrade nos seus personagens. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
              },
            });
          }
          if (!checkConfirmationPhrase(confirmationPhrase)) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'CONFIRMATION_PHRASE_REQUIRED',
                message: 'É obrigatório escrever a frase "Personagem casado, criar versão lendária" para prosseguir.',
              },
            });
          }
          const char = originCharacter;
          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: (characterName || char?.name || characterId).trim(),
            series: (series || char?.series || 'Indefinida').trim(),
            rarity: 'LEGENDARY',
            gender: char?.gender || undefined,
            description: char?.description || undefined,
            reason: reason ? `[Versão Lendária] ${reason.trim()}` : '[Versão Lendária]',
            imageBuffer: buffer,
            originCharacterId: characterId,
          });
          return reply.send({
            success: true,
            data: {
              message: 'Como o personagem já foi casado, sua sugestão foi registrada para a criação de um NOVO personagem na versão Lendária! A moderação irá analisar.',
              suggestion,
            },
          });
        }

        const suggestion = await suggestionService.submitRaritySuggestion(
          session.userId,
          characterId,
          suggestedRarity as Rarity,
          reason
        );
        return reply.send({
          success: true,
          data: {
            message: 'Sugestão de raridade enviada com sucesso! A moderação irá analisar.',
            suggestion,
          },
        });
      } else if (type === 'IMAGE') {
        let buffer: Buffer | null = null;
        if (imageBase64) {
          buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
        let act: 'ADD' | 'DELETE' | 'REPLACE' = 'ADD';
        const rawAct = String(bodyAction || photoAction || '').toUpperCase();
        if (rawAct === 'DELETE' || rawAct === 'DELETE_PHOTO') act = 'DELETE';
        else if (rawAct === 'REPLACE' || rawAct === 'REPLACE_PHOTO') act = 'REPLACE';

        const suggestion = await suggestionService.submitImageSuggestion(
          session.userId,
          characterId,
          buffer,
          reason,
          act,
          targetPhoto
        );
        return reply.send({
          success: true,
          data: {
            message: act === 'DELETE'
              ? 'Sugestão de exclusão de foto enviada para moderação!'
              : (act === 'REPLACE' ? 'Sugestão de substituição de foto enviada para moderação!' : 'Sugestão de foto enviada com sucesso!'),
            suggestion,
          },
        });
      } else if (type === 'DELETE_CHARACTER' || type === 'REPORT') {
        const suggestion = await suggestionService.submitDeleteSuggestion(
          characterId,
          session.userId,
          reason
        );
        return reply.send({
          success: true,
          data: {
            message: 'Denúncia enviada com sucesso para a moderação!',
            suggestion,
          },
        });
      }

      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Formato ou parâmetros de sugestão inválidos.' },
      });
    },
  });

  /* ────────────────────────────────────────────────────────────────────────── */
  /* ROTAS DO MERCADO E CLASSIFICADOS (PAINEL WEB)                              */
  /* ────────────────────────────────────────────────────────────────────────── */

  /**
   * Listagem global paginada de classificados com busca e filtros
   */
  fastify.get('/api/web/user/:publicId/market/listings', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          sortBy: { type: 'string', enum: ['rarity', 'wishlist', 'popularity', 'recent'], default: 'rarity' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 12 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as any;
      const result = await marketService.listGlobalListings(query);
      // Rota pública: sem JIDs de vendedores/donos (CLAUDE.md §3.2)
      return reply.send({
        success: true,
        data: { ...result, listings: (result.listings || []).map((l: any) => toPublicListing(l)) },
      });
    },
  });

  /**
   * Lista os anúncios criados pelo usuário logado
   */
  fastify.get('/api/web/user/:publicId/market/my-listings', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const listings = await marketService.getUserListings(session.userId);
      return reply.send({ success: true, data: listings });
    },
  });

  /**
   * Lista anúncios ativos de waifus que estão na wishlist do usuário logado
   */
  fastify.get('/api/web/user/:publicId/market/wishlist-listings', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const listings = await marketService.getWishlistListings(session.userId);
      return reply.send({ success: true, data: listings });
    },
  });

  /**
   * Lista pública dos anúncios ativos de um usuário específico (sem token)
   */
  fastify.get('/api/web/user/:publicId/market/user-listings', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const user = await fastify.prisma.user.findUnique({
        where: { publicId },
        select: { id: true },
      });
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const listings = await fastify.prisma.marketListing.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        include: {
          character: {
            include: {
              _count: { select: { wishlists: true } },
              haremEntries: {
                where: { userId: user.id },
                select: { keys: true, isFavorite: true },
              },
            },
          },
        },
      });

      const formatted = listings.map((l) => {
        const keys = (l.character as any).haremEntries?.[0]?.keys || 1;
        const isSoulmate = keys >= 10;
        return {
          id: l.id,
          interest: l.interest,
          createdAt: l.createdAt,
          keys,
          isSoulmate,
          character: {
            ...marketService.formatCharacter(l.character),
            keys,
            isSoulmate,
          },
        };
      });

      return reply.send({ success: true, data: formatted });
    },
  });

  /**
   * Lista as ofertas enviadas pelo usuário logado nos últimos 15 dias
   */
  fastify.get('/api/web/user/:publicId/market/my-offers', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offers = await marketService.getUserSentOffers(session.userId);
      // O comprador não recebe o JID/telefone do vendedor
      return reply.send({ success: true, data: offers.map((o: any) => toPublicOffer(o)) });
    },
  });

  /**
   * Cria um novo anúncio de waifu nos classificados
   */
  fastify.post('/api/web/user/:publicId/market/listings', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId', 'interest'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
          interest: { type: 'string', maxLength: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId, interest } = request.body as {
        token: string;
        characterId: string;
        interest: string;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const listing = await marketService.createListing(session.userId, characterId, interest);
      return reply.send({ success: true, data: listing });
    },
  });

  /**
   * Cancela um anúncio do usuário
   */
  fastify.delete('/api/web/user/:publicId/market/listings/:listingId', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'listingId'],
        properties: {
          publicId: { type: 'string' },
          listingId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, listingId } = request.params as { publicId: string; listingId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      await marketService.cancelListing(session.userId, listingId);
      return reply.send({ success: true, message: 'Anúncio cancelado com sucesso.' });
    },
  });

  /**
   * Visualiza as ofertas de um anúncio específico
   */
  fastify.get('/api/web/user/:publicId/market/listings/:listingId/offers', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'listingId'],
        properties: {
          publicId: { type: 'string' },
          listingId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, listingId } = request.params as { publicId: string; listingId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offers = await marketService.getListingOffers(session.userId, listingId);
      // O vendedor não recebe o JID/telefone do comprador
      return reply.send({ success: true, data: offers.map((o: any) => toPublicOffer(o)) });
    },
  });

  /**
   * Consulta o inventário ao vivo do comprador para o modal de ofertas de mercado
   */
  fastify.get('/api/web/user/:publicId/market/my-inventory', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
        additionalProperties: false,
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
        additionalProperties: false,
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      try {
        const invRes = await fetch(`${config.RAVENA_API_URL}/api/market/user-inventory/${encodeURIComponent(session.userId)}`, {
          headers: ravenaMarketHeaders(),
          signal: AbortSignal.timeout(6000),
        });
        if (!invRes.ok) {
          return reply.status(503).send({
            success: false,
            error: { code: 'INVENTORY_UNAVAILABLE', message: 'Não foi possível carregar o inventário ao vivo no momento.' },
          });
        }
        const invData = (await invRes.json()) as any;
        return reply.send({ success: true, data: invData });
      } catch (err: any) {
        return reply.status(503).send({
          success: false,
          error: { code: 'INVENTORY_FETCH_ERROR', message: `Erro ao buscar inventário: ${err?.message || 'Serviço externo inacessível'}` },
        });
      }
    },
  });

  /**
   * Envia uma proposta / oferta para um anúncio
   */
  fastify.post('/api/web/user/:publicId/market/offers', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'listingId', 'offeredItems'],
        properties: {
          token: { type: 'string' },
          listingId: { type: 'string' },
          message: { type: 'string', maxLength: 500 },
          offeredItems: {
            type: 'object',
            additionalProperties: false,
            properties: {
              isFree: { type: 'boolean' },
              zinthos: { type: 'integer', minimum: 0 },
              runas: { type: 'integer', minimum: 0 },
              petalitas: { type: 'integer', minimum: 0 },
              waifuIds: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
              fishes: { type: 'array', maxItems: 50, items: { type: 'object' } },
              fishingBuffs: {
                type: 'array',
                maxItems: 50,
                items: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
              },
              fishingBuffIds: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1 } },
              farmItems: {
                type: 'array',
                maxItems: 50,
                items: {
                  type: 'object',
                  required: ['itemId', 'amount'],
                  properties: {
                    itemId: { type: 'string', maxLength: 100 },
                    name: { type: 'string', maxLength: 120 },
                    amount: { type: 'integer', minimum: 1 },
                  },
                },
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, listingId, message, offeredItems } = request.body as {
        token: string;
        listingId: string;
        message?: string;
        offeredItems: any;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offer = await marketService.createOffer(session.userId, listingId, {
        message,
        offeredItems,
      });

      return reply.send({ success: true, data: offer });
    },
  });

  /**
   * Aceita uma oferta recebida
   */
  fastify.post('/api/web/user/:publicId/market/offers/:offerId/accept', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'offerId'],
        properties: {
          publicId: { type: 'string' },
          offerId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, offerId } = request.params as { publicId: string; offerId: string };
      const { token } = request.body as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await marketService.acceptOffer(session.userId, offerId);
      return reply.send(result);
    },
  });

  /**
   * Rejeita uma oferta recebida
   */
  fastify.post('/api/web/user/:publicId/market/offers/:offerId/reject', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'offerId'],
        properties: {
          publicId: { type: 'string' },
          offerId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: {
          token: { type: 'string' },
          reason: { type: 'string', maxLength: 1000 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, offerId } = request.params as { publicId: string; offerId: string };
      const { token, reason } = request.body as { token: string; reason?: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offer = await marketService.rejectOffer(session.userId, offerId, reason);
      return reply.send({ success: true, data: offer });
    },
  });

  /**
   * Cancela uma proposta enviada pelo comprador
   */
  fastify.post('/api/web/user/:publicId/market/offers/:offerId/cancel', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'offerId'],
        properties: {
          publicId: { type: 'string' },
          offerId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, offerId } = request.params as { publicId: string; offerId: string };
      const { token } = request.body as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offer = await marketService.cancelOffer(session.userId, offerId);
      return reply.send({ success: true, data: offer });
    },
  });

  /**
   * Consulta cotação de investimento para o modal da Wishlist
   */
  fastify.get('/api/web/user/:publicId/market/quote/:characterId', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const quote = await marketInvestmentService.getCharacterQuote(characterId, session.userId);
      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, kakera: true },
      });

      const existingInvestment = await fastify.prisma.characterInvestment.findUnique({
        where: {
          characterId_userId: {
            characterId: quote.character.id,
            userId: session.userId,
          },
        },
      });

      return reply.send({
        success: true,
        data: {
          ...quote,
          userShares: existingInvestment?.shares ?? 0,
          userKakera: user?.kakera ?? 0,
        },
      });
    },
  });

  /**
   * Realiza investimento/compra de cotas via modal da Wishlist
   */
  fastify.post('/api/web/user/:publicId/market/invest', {
    schema: {
      tags: ['Mercado (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: {
          publicId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
          shares: { type: 'number', minimum: 1, maximum: 4, default: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId, shares = 1 } = request.body as {
        token: string;
        characterId: string;
        shares?: number;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await marketInvestmentService.invest({
        userId: session.userId,
        characterIdOrSlug: characterId,
        shares,
      });

      // Atualiza o saldo do usuário para resposta
      const updatedUser = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { kakera: true },
      });

      return reply.send({
        success: true,
        data: {
          ...result,
          remainingKakera: updatedUser?.kakera ?? 0,
        },
      });
    },
  });

  /**
   * Cobiçar um personagem já casado de outro jogador
   */
  fastify.post('/api/web/user/:publicId/covet', {
    schema: {
      description: 'Cobiça um personagem casado e adiciona à wishlist',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['token', 'characterId'],
        properties: {
          token: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token, characterId } = request.body as { token: string; characterId: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      try {
        const result = await covetService.covet(session.userId, characterId);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code || 'COVET_ERROR', message: err.message },
        });
      }
    },
  });

  /**
   * Lista os interessados em uma waifu do harém
   */
  fastify.get('/api/web/user/:publicId/harem/:characterId/covets', {
    schema: {
      description: 'Lista jogadores interessados em uma waifu do harém',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      try {
        const covets = await covetService.getCharacterCovets(session.userId, characterId);
        return reply.send({ success: true, data: covets });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code || 'COVET_ERROR', message: err.message },
        });
      }
    },
  });

  /**
   * Ignora um interesse específico
   */
  fastify.post('/api/web/user/:publicId/harem/:characterId/covets/ignore', {
    schema: {
      description: 'Ignora um interesse de um jogador',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token', 'covetId'],
        properties: {
          token: { type: 'string' },
          covetId: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token, covetId } = request.body as { token: string; covetId: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      try {
        const result = await covetService.ignoreCovet(session.userId, covetId);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code || 'COVET_ERROR', message: err.message },
        });
      }
    },
  });

  /**
   * Marca todos os interessados como vistos
   */
  fastify.post('/api/web/user/:publicId/harem/:characterId/covets/seen-all', {
    schema: {
      description: 'Marca todos os interessados de um personagem como vistos',
      tags: ['Usuário (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const { token } = request.body as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      try {
        const result = await covetService.markAllSeen(session.userId, characterId);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code || 'COVET_ERROR', message: err.message },
        });
      }
    },
  });

  // ========================================================
  // ROTAS DE PERSONAGENS MÍTICOS (CRIAÇÃO, EDIÇÃO, SLOTS)
  // ========================================================

  async function processMythicPhotos(charId: string, photos: string[]): Promise<string[]> {
    const result: string[] = [];
    const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', charId);

    for (let i = 0; i < Math.min(photos.length, 5); i++) {
      const p = photos[i];
      if (!p || typeof p !== 'string') continue;
      const trimmed = p.trim();
      if (trimmed.startsWith('data:image/')) {
        const match = trimmed.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          const rawBuffer = Buffer.from(match[2], 'base64');
          if (rawBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
            throw new DomainError('PAYLOAD_TOO_LARGE', 'A imagem enviada é muito grande! Compacte ela antes', 413);
          }
          const optimized = await optimizeImageUnder1Mb(rawBuffer);
          await fs.mkdir(uploadsDir, { recursive: true });
          const fileName = `${Date.now()}_${i}.${optimized.ext}`;
          const filePath = path.join(uploadsDir, fileName);
          await fs.writeFile(filePath, optimized.buffer);
          result.push(`uploads/characters/${charId}/${fileName}`);
          continue;
        }
      }
      result.push(trimmed);
    }
    return result;
  }

  /**
   * Consulta os slots e os personagens míticos do usuário
   */
  fastify.get('/api/web/user/:publicId/mythics', {
    schema: {
      description: 'Consulta os personagens míticos criados pelo usuário e seu saldo de slots',
      tags: ['Míticos (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const { token } = request.query as { token: string };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, name: true, mythicSlots: true },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const mythicCharacters = await fastify.prisma.character.findMany({
        where: { creatorUserId: user.id, isMythic: true },
        include: {
          haremEntries: {
            where: { userId: user.id },
            select: { keys: true, pinnedPhoto: true, claimedAt: true },
          },
        },
        orderBy: { addedAt: 'desc' },
      });

      const formatted = mythicCharacters.map((c) => {
        const entry = c.haremEntries[0];
        const pinned = entry?.pinnedPhoto || null;
        return {
          id: c.id,
          name: c.name,
          series: c.series,
          description: c.description,
          gender: c.gender,
          baseRarity: c.baseRarity,
          isMythic: true,
          claimCount: c.claimCount,
          pinnedPhoto: pinned,
          keys: entry?.keys || 1,
          claimedAt: entry?.claimedAt || c.addedAt,
          imageUrl: characterService.getRandomImageUrl(c.id, c.imageUrls),
          imageUrls: c.imageUrls.map((img) => characterService.formatImageUrl(c.id, img)),
          rawImageUrls: c.imageUrls,
          mythicCustomization: c.mythicCustomization || null,
        };
      });

      const totalSlots = user.mythicSlots;
      const usedSlots = formatted.length;
      const availableSlots = Math.max(0, totalSlots - usedSlots);

      return reply.send({
        success: true,
        data: {
          totalSlots,
          usedSlots,
          availableSlots,
          mythics: formatted,
        },
      });
    },
  });

  /**
   * Criação de um novo personagem mítico
   */
  fastify.post('/api/web/user/:publicId/mythics', {
    schema: {
      description: 'Cria um novo personagem mítico consumindo 1 slot do usuário',
      tags: ['Míticos (Web)'],
      params: {
        type: 'object',
        required: ['publicId'],
        properties: { publicId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['name', 'token'],
        properties: {
          token: { type: 'string' },
          name: { type: 'string', minLength: 2, maxLength: 80 },
          series: { type: 'string', maxLength: 80 },
          description: { type: 'string', maxLength: 1000 },
          gender: { type: 'string', enum: ['FEMALE', 'MALE', 'OTHER'], default: 'FEMALE' },
          photos: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          customization: {
            type: 'object',
            properties: {
              borderColor: { type: 'string' },
              animationType: { type: 'string', enum: ['spin', 'pulse', 'shimmer', 'flame', 'none'] },
              glowColor: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId } = request.params as { publicId: string };
      const body = request.body as {
        token: string;
        name: string;
        series?: string;
        description?: string;
        gender?: Gender;
        photos?: string[];
        customization?: any;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(body.token)
        : await webSessionService.validateUserSession(publicId, body.token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, name: true, mythicSlots: true },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const currentMythicsCount = await fastify.prisma.character.count({
        where: { creatorUserId: user.id, isMythic: true },
      });

      if (currentMythicsCount >= user.mythicSlots) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'NO_MYTHIC_SLOTS',
            message: `Você já atingiu o limite de ${user.mythicSlots} personagem(ns) mítico(s). Apoie a Ravena (R$ 50 = 1 slot) para desbloquear mais slots!`,
          },
        });
      }

      const charId = `myt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const rawPhotos = Array.isArray(body.photos) ? body.photos.filter(Boolean) : [];
      const savedPhotos = await processMythicPhotos(charId, rawPhotos);
      const finalImageUrls = savedPhotos.length > 0 ? savedPhotos : ['/media/characters/default.jpg'];

      const customization = {
        borderColor: body.customization?.borderColor || '#eab308',
        animationType: body.customization?.animationType || 'spin',
        glowColor: body.customization?.glowColor || '#ffd700',
      };

      // Cria Character e HaremEntry atomicamente
      const created = await fastify.prisma.$transaction(async (tx) => {
        const character = await tx.character.create({
          data: {
            id: charId,
            name: body.name.trim(),
            series: (body.series && body.series.trim()) || `Lenda de ${user.name}`,
            description: body.description?.trim() || null,
            gender: body.gender || 'FEMALE',
            baseRarity: 'RARE',
            isMythic: true,
            creatorUserId: user.id,
            claimCount: 1,
            imageUrls: finalImageUrls,
            mythicCustomization: customization,
            isActive: true,
          },
        });

        await tx.haremEntry.create({
          data: {
            userId: user.id,
            characterId: charId,
            claimedInGroup: 'MYTHIC_CREATION',
            keys: 1,
            pinnedPhoto: finalImageUrls[0],
          },
        });

        return character;
      });

      return reply.send({
        success: true,
        data: {
          id: created.id,
          name: created.name,
          series: created.series,
          description: created.description,
          gender: created.gender,
          isMythic: true,
          imageUrl: characterService.getRandomImageUrl(created.id, created.imageUrls),
          imageUrls: created.imageUrls.map((img) => characterService.formatImageUrl(created.id, img)),
          mythicCustomization: created.mythicCustomization,
          message: '🔮 Seu personagem mítico foi forjado com sucesso e já habita o seu harém!',
        },
      });
    },
  });

  /**
   * Atualização de dados e customização do personagem mítico
   */
  fastify.put('/api/web/user/:publicId/mythics/:characterId', {
    schema: {
      description: 'Edita um personagem mítico pertencente ao usuário',
      tags: ['Míticos (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          name: { type: 'string', minLength: 2, maxLength: 80 },
          series: { type: 'string', maxLength: 80 },
          description: { type: 'string', maxLength: 1000 },
          gender: { type: 'string', enum: ['FEMALE', 'MALE', 'OTHER'] },
          photos: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          pinnedPhoto: { type: 'string' },
          customization: {
            type: 'object',
            properties: {
              borderColor: { type: 'string' },
              animationType: { type: 'string', enum: ['spin', 'pulse', 'shimmer', 'flame', 'none'] },
              glowColor: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const body = request.body as {
        token: string;
        name?: string;
        series?: string;
        description?: string;
        gender?: Gender;
        photos?: string[];
        pinnedPhoto?: string;
        customization?: any;
      };

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(body.token)
        : await webSessionService.validateUserSession(publicId, body.token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      const character = await fastify.prisma.character.findUnique({
        where: { id: characterId },
      });

      if (!character || !character.isMythic || character.creatorUserId !== session.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'MYTHIC_NOT_FOUND', message: 'Personagem mítico não encontrado ou você não é o criador.' },
        });
      }

      let updatedPhotos = character.imageUrls;
      if (Array.isArray(body.photos)) {
        const rawPhotos = body.photos.filter(Boolean);
        updatedPhotos = await processMythicPhotos(characterId, rawPhotos);
      }

      const dataToUpdate: any = {};
      if (body.name?.trim()) dataToUpdate.name = body.name.trim();
      if (body.series !== undefined) dataToUpdate.series = body.series.trim() || character.series;
      if (body.description !== undefined) dataToUpdate.description = body.description.trim() || null;
      if (body.gender) dataToUpdate.gender = body.gender;
      if (updatedPhotos.length > 0) dataToUpdate.imageUrls = updatedPhotos;
      if (body.customization) {
        dataToUpdate.mythicCustomization = {
          borderColor: body.customization.borderColor || (character.mythicCustomization as any)?.borderColor || '#eab308',
          animationType: body.customization.animationType || (character.mythicCustomization as any)?.animationType || 'spin',
          glowColor: body.customization.glowColor || (character.mythicCustomization as any)?.glowColor || '#ffd700',
        };
      }

      const updated = await fastify.prisma.character.update({
        where: { id: characterId },
        data: dataToUpdate,
      });

      if (body.pinnedPhoto) {
        await fastify.prisma.haremEntry.updateMany({
          where: { userId: session.userId, characterId },
          data: { pinnedPhoto: body.pinnedPhoto },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          series: updated.series,
          description: updated.description,
          gender: updated.gender,
          isMythic: true,
          imageUrl: characterService.getRandomImageUrl(updated.id, updated.imageUrls),
          imageUrls: updated.imageUrls.map((img) => characterService.formatImageUrl(updated.id, img)),
          mythicCustomization: updated.mythicCustomization,
          message: '🔮 Personagem mítico atualizado com sucesso!',
        },
      });
    },
  });

  /**
   * Exclui o personagem mítico e devolve o slot livre ao criador
   */
  fastify.delete('/api/web/user/:publicId/mythics/:characterId', {
    schema: {
      description: 'Exclui um personagem mítico liberando o slot para o criador',
      tags: ['Míticos (Web)'],
      params: {
        type: 'object',
        required: ['publicId', 'characterId'],
        properties: {
          publicId: { type: 'string' },
          characterId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { publicId, characterId } = request.params as { publicId: string; characterId: string };
      const queryToken = (request.query as { token?: string } | undefined)?.token;
      const bodyToken = (request.body as { token?: string } | undefined)?.token;
      const headerAuth = request.headers['authorization'];
      const headerCustomToken = request.headers['token'];
      const headerBearer = typeof headerAuth === 'string' ? headerAuth.replace(/^Bearer\s+/i, '') : undefined;
      const token = queryToken || bodyToken || (typeof headerCustomToken === 'string' ? headerCustomToken : undefined) || headerBearer;

      if (!token) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Token de autenticação não informado.' },
        });
      }

      const session = publicId === 'token-session'
        ? await webSessionService.validateTokenOnly(token)
        : await webSessionService.validateUserSession(publicId, token);

      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' },
        });
      }

      const character = await fastify.prisma.character.findUnique({
        where: { id: characterId },
      });

      if (!character || !character.isMythic || character.creatorUserId !== session.userId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'MYTHIC_NOT_FOUND', message: 'Personagem mítico não encontrado ou você não é o criador.' },
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.soulmate.deleteMany({ where: { characterId } });
        await tx.haremEntry.deleteMany({ where: { characterId } });
        await tx.character.delete({ where: { id: characterId } });
      });

      const uploadsDir = path.resolve(config.MEDIA_DIR, 'uploads', 'characters', characterId);
      await fs.rm(uploadsDir, { recursive: true, force: true }).catch(() => {});

      const remainingMythics = await fastify.prisma.character.count({
        where: { creatorUserId: session.userId, isMythic: true },
      });

      const user = await fastify.prisma.user.findUnique({
        where: { id: session.userId },
        select: { mythicSlots: true },
      });

      const totalSlots = user?.mythicSlots || 0;
      const availableSlots = Math.max(0, totalSlots - remainingMythics);

      return reply.send({
        success: true,
        data: {
          characterId,
          totalSlots,
          usedSlots: remainingMythics,
          availableSlots,
          message: '🔮 Personagem mítico excluído com sucesso! Seu slot foi liberado para uma nova lenda.',
        },
      });
    },
  });

  fastify.get('/sobre', async (_request, reply) => {
    return reply.sendFile('sobre.html');
  });
};
