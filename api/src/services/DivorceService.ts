import { PrismaClient } from '@prisma/client';
import { calculateDivorceRefund } from '../utils/rarityCalculator.js';
import { config } from '../config.js';

export class DivorceService {
  constructor(private prisma: PrismaClient) {}

  async divorce(userId: string, characterId: string) {
    // 1. Localizar o personagem (flexível)
    let haremEntry = await this.prisma.haremEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId },
          { character: { id: characterId.toLowerCase().trim() } },
          { character: { name: { equals: characterId.trim(), mode: 'insensitive' } } },
        ],
      },
      include: {
        character: true,
      },
    });

    if (!haremEntry) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_IN_HAREM',
          message: 'Você não possui este personagem no seu harém.',
        },
      };
    }

    const { character, keys } = haremEntry;

    // 2. Calcular reembolso de Kakera com penalidade de 5%
    const refund = calculateDivorceRefund(character.baseRarity, keys);

    // 3. Executar transação atômica
    const result = await this.prisma.$transaction(async (tx) => {
      // Remove do harém
      await tx.haremEntry.delete({
        where: { id: haremEntry.id },
      });

      // Decrementa claimCount de forma segura evitando valores negativos
      await tx.$executeRaw`
        UPDATE characters
        SET "claimCount" = GREATEST(0, "claimCount" - 1)
        WHERE id = ${character.id}
      `;

      // Credita Kakera ao usuário
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          kakera: { increment: refund.netKakera },
        },
      });

      // Registra no extrato
      await tx.kakeraTransaction.create({
        data: {
          userId,
          amount: refund.netKakera,
          reason: 'DIVORCE',
          metadata: {
            characterId: character.id,
            characterName: character.name,
            rarity: character.baseRarity,
            keysAccumulated: keys,
            rawValue: refund.rawValue,
            penaltyRate: '5%',
          },
        },
      });

      return updatedUser;
    });

    return {
      success: true,
      data: {
        message: `Você se divorciou de ${character.name}. Recebeu ${refund.netKakera} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! 💔`,
        refundedKakera: refund.netKakera,
        keysLost: keys - refund.remainingKeys,
        newKakeraBalance: result.kakera,
        character: {
          id: character.id,
          name: character.name,
          rarity: character.baseRarity,
        },
      },
    };
  }

  async forceDivorce(userId: string, characterId: string) {
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: {
        userId,
        OR: [
          { characterId },
          { character: { id: characterId.toLowerCase().trim() } },
          { character: { name: { equals: characterId.trim(), mode: 'insensitive' } } },
        ],
      },
    });

    if (!haremEntry) {
      return {
        success: false,
        error: {
          code: 'CHARACTER_NOT_IN_HAREM',
          message: `Personagem ${characterId} não está no harém de ${userId}.`,
        },
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.haremEntry.delete({
        where: { id: haremEntry.id },
      });

      await tx.$executeRaw`
        UPDATE characters
        SET "claimCount" = GREATEST(0, "claimCount" - 1)
        WHERE id = ${haremEntry.characterId}
      `;
    });

    return {
      success: true,
      data: {
        message: `Personagem ${haremEntry.characterId} foi removido à força do harém de ${userId}.`,
      },
    };
  }
}
