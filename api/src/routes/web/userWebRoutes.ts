import { FastifyPluginAsync } from 'fastify';
import { WebSessionService } from '../../services/WebSessionService.js';
import { HaremService } from '../../services/HaremService.js';
import { WishlistService } from '../../services/WishlistService.js';
import { DivorceService } from '../../services/DivorceService.js';
import { CharacterService } from '../../services/CharacterService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { MarketService } from '../../services/MarketService.js';
import { MarketInvestmentService } from '../../services/MarketInvestmentService.js';
import { CovetService } from '../../services/CovetService.js';
import { verifyApiKey } from '../../plugins/auth.js';
import { DomainError } from '../../errors/DomainError.js';
import { Rarity } from '@prisma/client';

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
      'https://ravena.moothz.win/health',
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
  const divorceService = new DivorceService(fastify.prisma);
  const webSessionService = new WebSessionService(fastify.redis, fastify.prisma);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);
  const marketService = new MarketService(fastify.prisma, characterService);
  const marketInvestmentService = new MarketInvestmentService(fastify.prisma, characterService, fastify.redis);
  const covetService = new CovetService(fastify.prisma, characterService, wishlistService);

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
        select: { id: true, publicId: true, name: true, kakera: true },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' },
        });
      }

      const session = await webSessionService.validateUserSession(publicId, token);
      const isOwner = session.valid && session.userId === user.id;

      // Busca o harém completo do usuário (sem teto artificial)
      const haremResult = await haremService.getUserHarem(user.id, 1, 0, 'keys');

      if (isOwner) {
        const wishlistResult = await wishlistService.getWishlist(user.id);
        const covetCountsMap = await covetService.getHaremCovetCounts(user.id);
        const covetedCharacterIds = await covetService.getUserCovetedCharacterIds(user.id);

        const enrichedHarem = haremResult.data.map((item) => ({
          ...item,
          unseenCovetsCount: covetCountsMap[item.character.id]?.unseen || 0,
          totalCovetsCount: covetCountsMap[item.character.id]?.total || 0,
        }));

        return reply.send({
          success: true,
          data: {
            isAdmin: true,
            publicId: user.publicId,
            name: user.name,
            kakera: user.kakera,
            expiresIn: session.expiresIn,
            harem: enrichedHarem,
            totalHarem: haremResult.total,
            wishlist: wishlistResult,
            covetedCharacterIds,
            inventory: session.inventory || null,
          },
        });
      }

      // Visualização pública: proteção estrita de PII (omite claimedInGroup, notas privadas e IDs internos)
      const publicHarem = haremResult.data.map((item) => ({
        id: item.id,
        character: {
          id: item.character.id,
          name: item.character.name,
          series: item.character.series,
          baseRarity: item.character.baseRarity,
          imageUrl: item.character.imageUrl,
          imageUrls: item.character.imageUrls,
        },
        keys: item.keys,
        isFavorite: item.isFavorite,
        claimedAt: item.claimedAt,
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
          publicId: user.publicId,
          name: user.name,
          kakera: user.kakera,
          harem: publicHarem,
          totalHarem: haremResult.total,
          listings: publicListings,
        },
      });
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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
   * Remove todas as personagens casadas da wishlist do usuário via sessão web
   */
  fastify.delete('/api/web/user/:publicId/wishlist/married', {
    schema: {
      description: 'Remove todas as personagens que já estão casadas da lista de desejos do usuário',
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

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const result = await wishlistService.clearMarried(session.userId);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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
            if (part.fieldname === 'suggestedGender' && ['FEMALE', 'MALE', 'OTHER'].includes(String(part.value))) {
              suggestedGender = String(part.value) as any;
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
          } else if (part.type === 'file' && (part.fieldname === 'image' || part.fieldname === 'photo')) {
            imageBuffer = await part.toBuffer();
          }
        }

        const session = await webSessionService.validateUserSession(publicId, token);
        if (!session.valid || !session.userId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
          });
        }

        await suggestionService.assertUserNotBlocked(session.userId);

        if (type === 'NEW_CHARACTER') {
          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: characterName,
            series,
            rarity: (suggestedRarity || 'COMMON') as Rarity,
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
          const wasMarried = characterId ? await suggestionService.wasCharacterEverMarried(characterId) : false;
          if (wasMarried && suggestedRarity === 'LEGENDARY') {
            if (!imageBuffer || imageBuffer.length === 0) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
                },
              });
            }
            const char = await characterService.findCharacter(characterId);
            const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
              name: (suggestedName || characterName || char?.name || '').trim(),
              series: (suggestedSeries || series || char?.series || '').trim(),
              rarity: 'LEGENDARY',
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
          const wasMarried = characterId ? await suggestionService.wasCharacterEverMarried(characterId) : false;
          if (wasMarried && suggestedRarity === 'LEGENDARY') {
            if (!imageBuffer || imageBuffer.length === 0) {
              return reply.status(400).send({
                success: false,
                error: {
                  code: 'PHOTO_REQUIRED_FOR_LEGENDARY',
                  message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
                },
              });
            }
            const char = await characterService.findCharacter(characterId);
            const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
              name: (characterName || char?.name || characterId).trim(),
              series: (series || char?.series || 'Indefinida').trim(),
              rarity: 'LEGENDARY',
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
        imageBase64,
      } = (request.body as any) || {};

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      await suggestionService.assertUserNotBlocked(session.userId);

      if (type === 'NEW_CHARACTER') {
        let buffer: Buffer | undefined;
        if (imageBase64) {
          buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
        const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
          name: characterName,
          series,
          rarity: (suggestedRarity || 'COMMON') as Rarity,
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
        const wasMarried = characterId ? await suggestionService.wasCharacterEverMarried(characterId) : false;
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
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
              },
            });
          }
          const char = await characterService.findCharacter(characterId);
          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: (suggestedName || characterName || char?.name || '').trim(),
            series: (suggestedSeries || series || char?.series || '').trim(),
            rarity: 'LEGENDARY',
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
          suggestedGender,
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
        const wasMarried = characterId ? await suggestionService.wasCharacterEverMarried(characterId) : false;
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
                message: 'Este personagem já foi casado. A raridade máxima permitida para o mesmo é ÉPICO. Para sugerir a versão Lendária, será criado um NOVO personagem e o envio de uma nova foto é obrigatório.',
              },
            });
          }
          const char = await characterService.findCharacter(characterId);
          const suggestion = await suggestionService.submitNewCharacterSuggestion(session.userId, {
            name: (characterName || char?.name || characterId).trim(),
            series: (series || char?.series || 'Indefinida').trim(),
            rarity: 'LEGENDARY',
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
      return reply.send({ success: true, data: result });
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

      const session = await webSessionService.validateUserSession(publicId, token);
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
            },
          },
        },
      });

      const formatted = listings.map((l) => ({
        id: l.id,
        interest: l.interest,
        createdAt: l.createdAt,
        character: marketService.formatCharacter(l.character),
      }));

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

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offers = await marketService.getUserSentOffers(session.userId);
      return reply.send({ success: true, data: offers });
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offers = await marketService.getListingOffers(session.userId, listingId);
      return reply.send({ success: true, data: offers });
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
          offeredItems: { type: 'object' },
        },
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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
        properties: { token: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { publicId, offerId } = request.params as { publicId: string; offerId: string };
      const { token } = request.body as { token: string };

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const offer = await marketService.rejectOffer(session.userId, offerId);
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

      const session = await webSessionService.validateUserSession(publicId, token);
      if (!session.valid || !session.userId) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Sessão web expirada ou inválida.' },
        });
      }

      const quote = await marketInvestmentService.getCharacterQuote(characterId);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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

      const session = await webSessionService.validateUserSession(publicId, token);
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
};
