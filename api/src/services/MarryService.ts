import { Prisma, PrismaClient, Rarity } from '@prisma/client';
import { CooldownService } from './CooldownService.js';
import { CharacterService } from './CharacterService.js';
import { UserService } from './UserService.js';
import { config } from '../config.js';
import { COMPETITOR_INVESTMENT_REFUND_RATE } from './MarketInvestmentService.js';
import { withBusinessSpan, chatIdAttr, userIdAttr, addEvent, setAttrs } from '../telemetry.js';

export interface MarryParams {
  userId: string;
  groupId: string;
  lockGroupId?: string;
  characterId: string;
}

class CharacterAlreadyClaimedError extends Error {}

export class MarryService {
  constructor(
    private prisma: PrismaClient,
    private cooldownService: CooldownService,
    private characterService: CharacterService
  ) {}

  async marry(params: MarryParams) {
    return withBusinessSpan(
      'marry',
      { 'waifu.user.id': userIdAttr(params.userId), 'waifu.group.id': chatIdAttr(params.groupId) },
      () => this.marryImpl(params)
    );
  }

  private async marryImpl(params: MarryParams) {
    const { userId, groupId, lockGroupId, characterId } = params;
    const effectiveLockGroupId = lockGroupId || groupId;

    // 1. Localizar personagem de forma flexível (ID, slug ou nome)
    const resolvedChar = await this.characterService.findCharacter(characterId);
    if (!resolvedChar) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }
    const targetCharId = resolvedChar.id;

    // 2. Verificar se já pertence a alguém
    const character = await this.prisma.character.findUnique({
      where: { id: targetCharId },
      include: {
        haremEntries: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    if (!character) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }

    if (character.haremEntries.length > 0) {
      const owner = character.haremEntries[0].user;
      return {
        success: false,
        error: {
          code: 'CHARACTER_ALREADY_CLAIMED',
          message: `Este personagem já pertence a ${owner.name}!`,
          owner,
        },
      };
    }

    // 3. Verificar lock no Redis para o grupo (qualquer um do grupo pode casar durante a janela ativa)
    let lock = await this.cooldownService.getClaimLock(effectiveLockGroupId, targetCharId);
    if (!lock.locked && characterId !== targetCharId) {
      lock = await this.cooldownService.getClaimLock(effectiveLockGroupId, characterId);
    }

    if (!lock.locked) {
      const windowStr = config.CLAIM_LOCK_SECONDS >= 60
        ? `${Math.floor(config.CLAIM_LOCK_SECONDS / 60)} minuto(s)`
        : `${config.CLAIM_LOCK_SECONDS} segundos`;
      return {
        success: false,
        error: {
          code: 'LOCK_EXPIRED',
          message: `A janela de ${windowStr} para casar expirou ou o personagem não foi rolado neste grupo.`,
        },
      };
    }

    // 4. Validação de Limite Diário de Casamento por Raridade
    const rarity = character.baseRarity || Rarity.COMMON;
    setAttrs({ 'waifu.character.rarity': rarity });
    const dailyCheck = await this.cooldownService.canMarryDaily(userId, rarity, false);
    if (!dailyCheck.allowed) {
      return {
        success: false,
        error: {
          code: 'DAILY_MARRY_LIMIT_REACHED',
          message:
            dailyCheck.reason ||
            `Você já atingiu seu limite diário de casamentos para a raridade ${rarity}.`,
          rarity,
          limit: dailyCheck.limit,
        },
      };
    }

    // 5. Reserva atômica de cooldown de claim para a raridade deste personagem via SET ... NX
    const cooldownSecs = this.cooldownService.getClaimCooldownSecondsForRarity(rarity);
    const acquiredClaim = await this.cooldownService.acquireClaimLock(userId, rarity, cooldownSecs);
    setAttrs({ 'waifu.claim.lock_acquired': acquiredClaim });
    if (acquiredClaim) addEvent('claim.lock_acquired');
    if (!acquiredClaim) {
      const cooldown = await this.cooldownService.getClaimCooldown(userId, rarity);
      const hours = Math.floor(cooldown.remainingSeconds / 3600);
      const mins = Math.ceil((cooldown.remainingSeconds % 3600) / 60);
      const waitStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
      return {
        success: false,
        error: {
          code: 'CLAIM_COOLDOWN_ACTIVE',
          message: `Você precisa aguardar ${waitStr} para realizar outro casamento com waifus de raridade ${rarity}.`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter,
          rarity,
        },
      };
    }

    // Helper para estorno do cooldown em caso de desistência/falha antes de casar
    const rollbackClaimCooldown = async () => {
      // Só libera a trava de claim; os contadores diários de casamento/troca não podem ser zerados aqui
      await this.cooldownService.releaseClaimCooldown(userId, rarity);
    };

    // 5. Efetuar casamento atômico no banco
    let transactionResult: {
      entry: { keys: number };
      character: typeof character;
    };

    try {
      transactionResult = await this.prisma.$transaction(async (tx) => {
        const currentCharacter = await tx.character.findUnique({
          where: { id: targetCharId },
          include: {
            haremEntries: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
        });

        if (!currentCharacter || currentCharacter.haremEntries.length > 0) {
          throw new CharacterAlreadyClaimedError();
        }

        const entry = await tx.haremEntry.create({
          data: {
            userId,
            characterId: targetCharId,
            claimedInGroup: groupId,
            keys: 1,
          },
        });

        await tx.character.update({
          where: { id: targetCharId },
          data: {
            claimCount: { increment: 1 },
          },
        });

        // Limpar investimentos e reembolsar competidores caso alguém tenha investido nesta waifu
        const competitors = await tx.characterInvestment.findMany({
          where: { characterId: targetCharId, userId: { not: userId } },
          include: { user: true },
        });

        for (const comp of competitors) {
          const refundAmount = Math.floor(comp.totalZinthos * COMPETITOR_INVESTMENT_REFUND_RATE);

          await tx.user.update({
            where: { id: comp.userId },
            data: { kakera: { increment: refundAmount } },
          });

          await tx.kakeraTransaction.create({
            data: {
              userId: comp.userId,
              amount: refundAmount,
              reason: 'MARKET_REFUND',
              metadata: {
                type: 'INVESTMENT_MARRIED_REFUND',
                characterId: targetCharId,
                characterName: currentCharacter.name,
                sharesLost: comp.shares,
                totalInvested: comp.totalZinthos,
                refundRate: 0.5,
                marriedUserId: userId,
              },
            },
          });
        }

        await tx.characterInvestment.deleteMany({
          where: { characterId: targetCharId },
        });

        return { entry, character: currentCharacter };
      });
    } catch (error) {
      await rollbackClaimCooldown();
      addEvent('cooldown.rollback');
      if (
        error instanceof CharacterAlreadyClaimedError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034'))
      ) {
        addEvent('claim.conflict', {
          'waifu.claim.conflict_code': error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'already_claimed',
        });
        // Busca o dono atualizado
        const currentOwnerEntry = await this.prisma.haremEntry.findFirst({
          where: { characterId: targetCharId },
          include: { user: { select: { id: true, name: true } } },
        });

        return {
          success: false,
          error: {
            code: 'CHARACTER_ALREADY_CLAIMED',
            message: `Este personagem já pertence a ${currentOwnerEntry?.user.name ?? 'outro usuário'}!`,
            owner: currentOwnerEntry?.user,
          },
        };
      }
      throw error;
    }

    const { entry: haremEntry, character: claimedCharacter } = transactionResult;
    addEvent('tx.commit');

    // 6. Liberar lock do grupo
    await this.cooldownService.releaseClaimLock(effectiveLockGroupId, targetCharId);
    if (characterId !== targetCharId) {
      await this.cooldownService.releaseClaimLock(effectiveLockGroupId, characterId);
    }

    // 7. Incrementa o contador de casamento diário para esta raridade
    await this.cooldownService.incrementDailyMarry(userId, rarity, 1.0);
    if (rarity === Rarity.LEGENDARY) {
      await this.cooldownService.incrementWeeklyLegendary(userId, 1);
    }

    const nextClaimAt = new Date(Date.now() + cooldownSecs * 1000);

    const [user, dailyMarryState] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { kakera: true },
      }),
      this.cooldownService.getDailyMarryStatus(userId),
    ]);

    return {
      success: true,
      data: {
        message: `Parabéns! Você se casou com ${claimedCharacter.name}! 💍`,
        character: {
          id: claimedCharacter.id,
          numericId: (claimedCharacter as any).numericId ?? null,
          name: claimedCharacter.name,
          series: claimedCharacter.series,
          rarity: claimedCharacter.baseRarity,
          imageUrl: this.characterService.getRandomImageUrl(claimedCharacter.id, claimedCharacter.imageUrls),
          imageUrls: claimedCharacter.imageUrls.map((img) => this.characterService.formatImageUrl(claimedCharacter.id, img)),
        },
        keys: haremEntry.keys,
        isSoulmate: false,
        kakeraBalance: user?.kakera ?? 0,
        nextClaimAt,
        rarityCooldown: {
          rarity,
          cooldownSeconds: cooldownSecs,
          nextClaimAt,
        },
        dailyMarry: dailyMarryState.byRarity[rarity] || null,
        dailyMarryResetAt: dailyMarryState.nextReset,
      },
    };
  }

  async adminMarry(params: { userId: string; characterId: string; groupId?: string; name?: string }) {
    const { userId, characterId } = params;
    const groupId = params.groupId || 'admin';

    // 1. Localizar personagem (ID, slug ou nome)
    const resolvedChar = await this.characterService.findCharacter(characterId);
    if (!resolvedChar) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }
    const targetCharId = resolvedChar.id;

    // 2. Garantir que usuário e grupo existam
    const userService = new UserService(this.prisma);
    await userService.ensureUserAndGroup({
      userId,
      groupId,
      name: params.name || userId,
      platform: 'WHATSAPP',
    });

    // 3. Verificar se já pertence a alguém
    const character = await this.prisma.character.findUnique({
      where: { id: targetCharId },
      include: {
        haremEntries: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    if (!character) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }

    if (character.haremEntries.length > 0) {
      const existingEntry = character.haremEntries[0];
      const owner = existingEntry.user;
      if (owner.id === userId) {
        const maxKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;
        if ((existingEntry.keys ?? 1) >= maxKeys) {
          return {
            success: false,
            error: {
              code: 'ALREADY_SOULMATE',
              message: `${resolvedChar.name} já atingiu o limite máximo de ${maxKeys} chaves (Soulmate).`,
            },
          };
        }

        const updated = await this.prisma.haremEntry.updateMany({
          where: {
            characterId: targetCharId,
            userId,
            keys: { lt: maxKeys },
          },
          data: {
            keys: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          return {
            success: false,
            error: {
              code: 'ALREADY_SOULMATE',
              message: `${resolvedChar.name} já atingiu o limite máximo de ${maxKeys} chaves (Soulmate).`,
            },
          };
        }

        const updatedEntry = await this.prisma.haremEntry.findUnique({
          where: { characterId: targetCharId },
        });

        if (updatedEntry && updatedEntry.keys >= maxKeys) {
          await this.prisma.soulmate.upsert({
            where: {
              userId_characterId: {
                userId,
                characterId: targetCharId,
              },
            },
            create: {
              userId,
              characterId: targetCharId,
            },
            update: {},
          });
        }

        return {
          success: true,
          action: 'KEY_GRANTED',
          data: {
            message: `O usuário já era casado com ${resolvedChar.name}. Foi concedida +1 chave do personagem (total: ${updatedEntry?.keys ?? maxKeys} chaves)!`,
            character: {
              id: resolvedChar.id,
              name: resolvedChar.name,
              series: resolvedChar.series,
              rarity: resolvedChar.baseRarity,
              imageUrl: this.characterService.getRandomImageUrl(resolvedChar.id, resolvedChar.imageUrls),
            },
            entry: updatedEntry,
          },
        };
      }
      return {
        success: false,
        error: {
          code: 'CHARACTER_ALREADY_CLAIMED',
          message: `Este personagem já pertence a ${owner.name || owner.id}!`,
          owner,
        },
      };
    }

    // 4. Inserir casamento no banco
    const transactionResult = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.haremEntry.create({
        data: {
          userId,
          characterId: targetCharId,
          claimedInGroup: groupId,
          keys: 1,
        },
      });

      await tx.character.update({
        where: { id: targetCharId },
        data: {
          claimCount: { increment: 1 },
        },
      });

      return { entry, character };
    });

    // 5. Liberar qualquer lock existente para o grupo/personagem
    await this.cooldownService.releaseClaimLock(groupId, targetCharId);
    if (characterId !== targetCharId) {
      await this.cooldownService.releaseClaimLock(groupId, characterId);
    }

    const { entry: haremEntry, character: claimedCharacter } = transactionResult;
    if (claimedCharacter.baseRarity === Rarity.LEGENDARY) {
      await this.cooldownService.incrementWeeklyLegendary(userId, 1);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kakera: true, name: true },
    });

    return {
      success: true,
      data: {
        message: `Casamento administrativo realizado com sucesso com ${claimedCharacter.name}! 💍`,
        character: {
          id: claimedCharacter.id,
          name: claimedCharacter.name,
          series: claimedCharacter.series,
          rarity: claimedCharacter.baseRarity,
          imageUrl: this.characterService.getRandomImageUrl(claimedCharacter.id, claimedCharacter.imageUrls),
          imageUrls: claimedCharacter.imageUrls.map((img) => this.characterService.formatImageUrl(claimedCharacter.id, img)),
        },
        keys: haremEntry.keys,
        user: { id: userId, name: user?.name || params.name || userId },
      },
    };
  }
}
