import { PrismaClient } from '@prisma/client';
import { CharacterService } from './CharacterService.js';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

export const MARRIAGE_PHOTO = 'marriage';

export class HaremService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService
  ) {}

  async getUserHarem(
    userId: string,
    page = 1,
    limit = 20,
    sort: 'keys' | 'date' | 'rarity' = 'keys',
    withoutCollection = false
  ) {
    const skip = limit > 0 ? (page - 1) * limit : undefined;
    const take = limit > 0 ? limit : undefined;

    let orderBy: any = [
      { character: { isMythic: 'desc' } },
      { isFavorite: 'desc' },
      { character: { baseRarity: 'desc' } },
      { keys: 'desc' },
      { character: { claimCount: 'desc' } },
    ];

    if (sort === 'date') {
      orderBy = [{ character: { isMythic: 'desc' } }, { isFavorite: 'desc' }, { claimedAt: 'desc' }];
    } else if (sort === 'rarity') {
      orderBy = [
        { character: { isMythic: 'desc' } },
        { isFavorite: 'desc' },
        { character: { baseRarity: 'desc' } },
        { keys: 'desc' },
      ];
    }

    const where: any = { userId };
    if (withoutCollection) {
      where.collectionId = null;
    }

    const [total, entries, soulmateRecords] = await Promise.all([
      this.prisma.haremEntry.count({ where }),
      this.prisma.haremEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          character: {
            include: {
              _count: { select: { wishlists: true } },
            },
          },
          collection: true,
        },
      }),
      this.prisma.soulmate.findMany({
        where: { userId },
        select: { characterId: true },
      }),
    ]);

    const soulmateSet = new Set(soulmateRecords.map((s) => s.characterId));

    const data = entries.map((e) => {
      const { _count, ...charRest } = e.character;
      return {
        id: e.id,
        claimedAt: e.claimedAt,
        claimedInGroup: e.claimedInGroup,
        keys: e.keys,
        isFavorite: e.isFavorite,
        isLocked: e.isLocked,
        note: e.note,
        collectionId: e.collectionId || null,
        collection: e.collection
          ? { id: e.collection.id, name: e.collection.name, isPrivate: e.collection.isPrivate, isLocked: e.collection.isLocked }
          : null,
        pinnedPhoto: e.pinnedPhoto || null,
        isSoulmate: (e.keys ?? 1) >= 10 || soulmateSet.has(e.characterId),
        character: {
          ...charRest,
          wishlistCount: _count?.wishlists ?? 0,
          imageUrl: this.resolveCardImageUrl(e.character.id, e.character.imageUrls, e.pinnedPhoto),
          imageUrls: e.character.imageUrls.map((img) => this.characterService.formatImageUrl(e.character.id, img)),
        },
      };
    });

    if (limit === 0 && (sort === 'keys' || sort === 'rarity')) {
      const RARITY_WEIGHT: Record<string, number> = { MYTHIC: 6, LEGENDARY: 5, EPIC: 4, RARE: 3, UNCOMMON: 2, COMMON: 1 };
      data.sort((a, b) => {
        const mythicA = Boolean(a.character.isMythic);
        const mythicB = Boolean(b.character.isMythic);
        if (mythicB !== mythicA) return (mythicB ? 1 : 0) - (mythicA ? 1 : 0);

        if (b.isSoulmate !== a.isSoulmate) return (b.isSoulmate ? 1 : 0) - (a.isSoulmate ? 1 : 0);

        if (b.isFavorite !== a.isFavorite) return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);

        const rA = mythicA ? RARITY_WEIGHT.MYTHIC : (RARITY_WEIGHT[a.character.baseRarity] || 0);
        const rB = mythicB ? RARITY_WEIGHT.MYTHIC : (RARITY_WEIGHT[b.character.baseRarity] || 0);
        if (rB !== rA) return rB - rA;

        if ((b.keys || 0) !== (a.keys || 0)) return (b.keys || 0) - (a.keys || 0);

        return (b.character.claimCount || 0) - (a.character.claimCount || 0);
      });
    }

    return {
      total,
      page: limit > 0 ? page : 1,
      limit: limit > 0 ? limit : total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
      data,
    };
  }

  /**
   * URL (absoluta) da foto de casamento servida pelo Waifuletes (proxy da ravena-ai)
   */
  marriagePhotoUrl(characterId: string): string {
    return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/web/marriage-photo/${encodeURIComponent(characterId)}`;
  }

  /**
   * Imagem do card: foto fixa (se válida) ou aleatória
   */
  resolveCardImageUrl(characterId: string, imageUrls: string[], pinnedPhoto?: string | null): string {
    if (pinnedPhoto === MARRIAGE_PHOTO) {
      return this.marriagePhotoUrl(characterId);
    }
    if (pinnedPhoto && imageUrls.includes(pinnedPhoto)) {
      return this.characterService.formatImageUrl(characterId, pinnedPhoto);
    }
    return this.characterService.getRandomImageUrl(characterId, imageUrls);
  }

  /**
   * Consulta na ravena-ai se existe foto de casamento para o personagem
   */
  async hasMarriagePhoto(characterId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${config.RAVENA_API_URL}/api/waifuletes/marriage-photo/${encodeURIComponent(characterId)}`,
        { method: 'HEAD', signal: AbortSignal.timeout(3000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  private async findOwnedEntry(userId: string, characterId: string) {
    const charId = (characterId || '').trim();
    const entry =
      (await this.prisma.haremEntry.findUnique({
        where: { userId_characterId: { userId, characterId: charId } },
        include: { character: true },
      })) ||
      (await this.prisma.haremEntry.findFirst({
        where: {
          userId,
          character: {
            OR: [
              { id: { equals: charId, mode: 'insensitive' } },
              { name: { equals: charId, mode: 'insensitive' } },
            ],
          },
        },
        include: { character: true },
      }));
    if (!entry) {
      throw new DomainError('NOT_IN_HAREM', 'Você não é casado com este personagem.', 404);
    }
    return entry;
  }

  /**
   * Lista as opções de foto: imagens do personagem + foto do casamento
   */
  async getPhotoOptions(userId: string, characterId: string) {
    const entry = await this.findOwnedEntry(userId, characterId);
    const char = entry.character;
    const marriageExists = await this.hasMarriagePhoto(char.id);
    const pinned = entry.pinnedPhoto && (entry.pinnedPhoto === MARRIAGE_PHOTO || char.imageUrls.includes(entry.pinnedPhoto))
      ? entry.pinnedPhoto
      : null;

    return {
      characterId: char.id,
      characterName: char.name,
      pinnedPhoto: pinned,
      photos: char.imageUrls.map((raw, index) => ({
        index: index + 1,
        id: raw,
        url: this.characterService.formatImageUrl(char.id, raw),
        isPinned: pinned === raw,
      })),
      marriage: {
        exists: marriageExists,
        url: marriageExists ? this.marriagePhotoUrl(char.id) : null,
        isPinned: pinned === MARRIAGE_PHOTO,
        hint: marriageExists
          ? `Para gerar uma nova foto: !mu-foto nova ${char.id}`
          : `Sem foto de casamento. Peça às ravenas: !mu-foto ${char.id}`,
        newPhotoCommand: `!mu-foto nova ${char.id}`,
        requestCommand: `!mu-foto ${char.id}`,
      },
    };
  }

  /**
   * Fixa (ou remove, com null) a foto do personagem no harém do usuário.
   * Aceita: null | "random" | "marriage" | índice 1-based (número/string) | id/URL de uma das fotos
   */
  async setPinnedPhoto(userId: string, characterId: string, photo: string | number | null | undefined) {
    const entry = await this.findOwnedEntry(userId, characterId);
    const char = entry.character;

    let value: string | null = null;
    const raw = photo === undefined || photo === null ? '' : String(photo).trim();

    if (raw === '' || /^(random|aleatoria|aleatória|null|none)$/i.test(raw)) {
      value = null;
    } else if (/^(marriage|casamento)$/i.test(raw)) {
      if (!(await this.hasMarriagePhoto(char.id))) {
        throw new DomainError(
          'NO_MARRIAGE_PHOTO',
          `Ainda não existe foto de casamento. Use !mu-foto ${char.id} para gerar.`,
          400
        );
      }
      value = MARRIAGE_PHOTO;
    } else if (/^\d+$/.test(raw)) {
      const idx = Number(raw);
      if (idx < 1 || idx > char.imageUrls.length) {
        throw new DomainError('INVALID_PHOTO', `Foto inválida. Este personagem tem ${char.imageUrls.length} foto(s).`, 400);
      }
      value = char.imageUrls[idx - 1];
    } else {
      const match = char.imageUrls.find(
        (u) => u === raw || this.characterService.formatImageUrl(char.id, u) === raw
      );
      if (!match) {
        throw new DomainError('INVALID_PHOTO', 'Foto não pertence a este personagem.', 400);
      }
      value = match;
    }

    await this.prisma.haremEntry.update({ where: { id: entry.id }, data: { pinnedPhoto: value } });

    return {
      success: true,
      character: { id: char.id, name: char.name },
      pinnedPhoto: value,
      imageUrl: this.resolveCardImageUrl(char.id, char.imageUrls, value),
      message: value
        ? `Foto fixa definida para ${char.name}.`
        : `${char.name} voltou a exibir fotos aleatórias.`,
    };
  }

  async setFavorite(userId: string, characterId: string) {
    const entry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
      include: { character: true },
    });

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_IN_HAREM', message: 'Personagem não encontrado no seu harém.' },
      };
    }

    // Se já é favorita, desmarca (toggle)
    if (entry.isFavorite) {
      await this.prisma.haremEntry.update({
        where: { id: entry.id },
        data: { isFavorite: false },
      });

      this.characterService.updateCharacterScore(entry.characterId).catch(() => {});

      return {
        success: true,
        data: {
          isFavorite: false,
          message: `${entry.character.name} foi removida das suas favoritas em destaque. 💔`,
        },
      };
    }

    // Se não é favorita, verifica o limite de 5 favoritas
    const currentFavoritesCount = await this.prisma.haremEntry.count({
      where: { userId, isFavorite: true },
    });

    if (currentFavoritesCount >= 5) {
      return {
        success: false,
        error: {
          code: 'FAVORITES_LIMIT_REACHED',
          message: 'Você já possui o limite máximo de 5 waifus favoritas em destaque. Remova uma antes para adicionar outra.',
        },
      };
    }

    await this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { isFavorite: true },
    });

    this.characterService.updateCharacterScore(entry.characterId).catch(() => {});

    return {
      success: true,
      data: {
        isFavorite: true,
        favoritesCount: currentFavoritesCount + 1,
        message: `${entry.character.name} agora é sua favorita em destaque! 💖 (${currentFavoritesCount + 1}/5)`,
      },
    };
  }

  async setNote(userId: string, characterId: string, note: string) {
    const entry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
    });

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_IN_HAREM', message: 'Personagem não encontrado no seu harém.' },
      };
    }

    const updated = await this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { note },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async toggleLock(userId: string, characterId: string) {
    const entry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
      include: { character: true },
    });

    if (!entry) {
      return {
        success: false,
        error: { code: 'NOT_IN_HAREM', message: 'Personagem não encontrado no seu harém.' },
      };
    }

    const nextState = !entry.isLocked;

    await this.prisma.haremEntry.update({
      where: { id: entry.id },
      data: { isLocked: nextState },
    });

    return {
      success: true,
      data: {
        isLocked: nextState,
        characterId: entry.characterId,
        message: nextState
          ? `🔒 ${entry.character.name} foi bloqueada com sucesso!`
          : `🔓 ${entry.character.name} foi desbloqueada com sucesso!`,
      },
    };
  }

  async getSoulmates(userId: string) {
    const cleanUserId = userId.includes('@') ? userId.split('@')[0].split(':')[0] : userId;

    const [soulmates, highKeyEntries] = await Promise.all([
      this.prisma.soulmate.findMany({
        where: { userId: cleanUserId },
        include: {
          character: true,
        },
        orderBy: { becameSoulmateAt: 'desc' },
      }),
      this.prisma.haremEntry.findMany({
        where: {
          userId: cleanUserId,
          keys: { gte: 10 },
          character: { isMythic: false },
        },
        include: {
          character: true,
        },
        orderBy: { keys: 'desc' },
      }),
    ]);

    const seenCharIds = new Set(soulmates.map((s) => s.character.id));
    const mergedSoulmates = [...soulmates];

    for (const entry of highKeyEntries) {
      if (!seenCharIds.has(entry.character.id)) {
        seenCharIds.add(entry.character.id);
        mergedSoulmates.push({
          id: entry.id,
          userId: cleanUserId,
          characterId: entry.character.id,
          becameSoulmateAt: entry.claimedAt,
          alias: null,
          note: entry.note,
          customBorder: null,
          pinnedPhoto: entry.pinnedPhoto,
          createdAt: entry.claimedAt,
          updatedAt: entry.claimedAt,
          character: entry.character,
        } as any);
      }
    }

    return mergedSoulmates.map((s) => ({
      id: s.id,
      becameSoulmateAt: s.becameSoulmateAt,
      alias: s.alias,
      note: s.note,
      character: {
        ...s.character,
        imageUrl: this.characterService.getRandomImageUrl(s.character.id, s.character.imageUrls),
        imageUrls: s.character.imageUrls.map((img) => this.characterService.formatImageUrl(s.character.id, img)),
      },
    }));
  }

  async updateSoulmate(userId: string, characterId: string, alias?: string, note?: string) {
    const existing = await this.prisma.soulmate.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId,
        },
      },
    });

    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_SOULMATE', message: 'Este personagem não é seu Soulmate.' },
      };
    }

    const updated = await this.prisma.soulmate.update({
      where: { id: existing.id },
      data: {
        ...(alias !== undefined ? { alias } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
