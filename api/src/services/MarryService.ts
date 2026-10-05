import { Prisma, PrismaClient } from '@prisma/client';
import { CooldownService } from './CooldownService.js';
import { CharacterService } from './CharacterService.js';
import { config } from '../config.js';

export interface MarryParams {
  userId: string;
  groupId: string;
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
    const { userId, groupId, characterId } = params;

    // 1. Reserva atômica de cooldown de claim (3h) via SET ... NX
    const acquiredClaim = await this.cooldownService.acquireClaimLock(userId);
    if (!acquiredClaim) {
      const cooldown = await this.cooldownService.getClaimCooldown(userId);
      const hours = Math.floor(cooldown.remainingSeconds / 3600);
      const mins = Math.ceil((cooldown.remainingSeconds % 3600) / 60);
      return {
        success: false,
        error: {
          code: 'COOLDOWN_ACTIVE',
          message: `Você precisa aguardar ${hours > 0 ? `${hours}h ` : ''}${mins}min para realizar outro casamento.`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter,
        },
      };
    }

    // Helper para estorno do cooldown em caso de desistência/falha antes de casar
    const rollbackClaimCooldown = async () => {
      await this.cooldownService.resetCooldown(userId, 'claim');
    };

    // 2. Localizar personagem de forma flexível (ID, slug ou nome)
    const resolvedChar = await this.characterService.findCharacter(characterId);
    if (!resolvedChar) {
      await rollbackClaimCooldown();
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }
    const targetCharId = resolvedChar.id;

    // 3. Verificar lock no Redis para o grupo (qualquer um do grupo pode casar durante a janela ativa)
    let lock = await this.cooldownService.getClaimLock(groupId, targetCharId);
    if (!lock.locked && characterId !== targetCharId) {
      lock = await this.cooldownService.getClaimLock(groupId, characterId);
    }

    if (!lock.locked) {
      await rollbackClaimCooldown();
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

    // 4. Verificar se já pertence a alguém
    const character = await this.prisma.character.findUnique({
      where: { id: targetCharId },
      include: {
        haremEntries: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    if (!character) {
      await rollbackClaimCooldown();
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_FOUND',
          message: 'Personagem não encontrado.',
        },
      };
    }

    if (character.haremEntries.length > 0) {
      await rollbackClaimCooldown();
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

        return { entry, character: currentCharacter };
      });
    } catch (error) {
      await rollbackClaimCooldown();
      if (
        error instanceof CharacterAlreadyClaimedError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034'))
      ) {
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

    // 6. Liberar lock do grupo
    await this.cooldownService.releaseClaimLock(groupId, targetCharId);
    if (characterId !== targetCharId) {
      await this.cooldownService.releaseClaimLock(groupId, characterId);
    }

    const nextClaimAt = new Date(Date.now() + config.COOLDOWN_CLAIM_SECONDS * 1000);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kakera: true },
    });

    return {
      success: true,
      data: {
        message: `Parabéns! Você se casou com ${claimedCharacter.name}! 💍`,
        character: {
          id: claimedCharacter.id,
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
      },
    };
  }
}
