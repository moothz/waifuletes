import { PrismaClient } from '@prisma/client';
import { CharacterService } from './CharacterService.js';
import { DomainError } from '../errors/DomainError.js';
import { config } from '../config.js';

export class CollectionService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService
  ) {}

  /**
   * Resolve a URL de exibição do card respeitando pinnedPhoto (foto fixa ou aleatória)
   */
  private resolveCardImageUrl(characterId: string, imageUrls: string[], pinnedPhoto?: string | null): string {
    if (pinnedPhoto === 'marriage') {
      return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/api/web/marriage-photo/${encodeURIComponent(characterId)}`;
    }
    if (pinnedPhoto && imageUrls.includes(pinnedPhoto)) {
      return this.characterService.formatImageUrl(characterId, pinnedPhoto);
    }
    return this.characterService.getRandomImageUrl(characterId, imageUrls);
  }

  /**
   * Lista todas as coleções do usuário com contagem e detalhes de personagens
   */
  async listUserCollections(userId: string, onlyPublic = false) {
    const where: any = { userId };
    if (onlyPublic) {
      where.isPrivate = false;
    }

    const collections = await this.prisma.userCollection.findMany({
      where,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        haremEntries: {
          include: {
            character: true,
          },
          orderBy: [
            { isFavorite: 'desc' },
            { keys: 'desc' },
            { character: { baseRarity: 'desc' } },
            { character: { name: 'asc' } },
          ],
        },
      },
    });

    return collections.map((col) => ({
      id: col.id,
      name: col.name,
      description: col.description,
      isPrivate: col.isPrivate,
      position: col.position,
      createdAt: col.createdAt,
      updatedAt: col.updatedAt,
      characterCount: col.haremEntries.length,
      characters: col.haremEntries.map((e) => ({
        id: e.character.id,
        name: e.character.name,
        series: e.character.series,
        baseRarity: e.character.baseRarity,
        gender: e.character.gender,
        keys: e.keys,
        isFavorite: e.isFavorite,
        pinnedPhoto: e.pinnedPhoto || null,
        imageUrl: this.resolveCardImageUrl(e.character.id, e.character.imageUrls, e.pinnedPhoto),
        imageUrls: e.character.imageUrls.map((img) => this.characterService.formatImageUrl(e.character.id, img)),
      })),
    }));
  }

  /**
   * Cria uma nova coleção para o usuário (limite máximo de 100)
   */
  async createCollection(userId: string, name: string, description?: string) {
    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length > 50) {
      throw new DomainError('INVALID_COLLECTION_NAME', 'O nome da coleção deve ter entre 1 e 50 caracteres.', 400);
    }

    const currentCount = await this.prisma.userCollection.count({
      where: { userId },
    });

    if (currentCount >= 100) {
      throw new DomainError('COLLECTION_LIMIT_REACHED', 'Você atingiu o limite máximo de 100 coleções.', 400);
    }

    const existing = await this.prisma.userCollection.findUnique({
      where: {
        userId_name: {
          userId,
          name: trimmedName,
        },
      },
    });

    if (existing) {
      throw new DomainError('COLLECTION_NAME_EXISTS', 'Já existe uma coleção com este nome no seu harém.', 409);
    }

    const maxPos = await this.prisma.userCollection.aggregate({
      where: { userId },
      _max: { position: true },
    });
    const nextPosition = (maxPos._max.position ?? 0) + 1;

    const collection = await this.prisma.userCollection.create({
      data: {
        userId,
        name: trimmedName,
        description: description ? description.trim() : null,
        position: nextPosition,
        isPrivate: false,
      },
    });

    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      isPrivate: collection.isPrivate,
      position: collection.position,
      createdAt: collection.createdAt,
      totalCollections: currentCount + 1,
      message: `Coleção "${collection.name}" criada com sucesso! (${currentCount + 1}/100)`,
    };
  }

  /**
   * Atualiza o nome ou descrição de uma coleção
   */
  async updateCollection(userId: string, collectionIdOrName: string, data: { name?: string; description?: string }) {
    const identifier = (collectionIdOrName || '').trim();
    if (!identifier) {
      throw new DomainError('INVALID_IDENTIFIER', 'Informe o ID ou nome da coleção.', 400);
    }

    const collection = await this.prisma.userCollection.findFirst({
      where: {
        userId,
        OR: [
          { id: identifier },
          { name: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });

    if (!collection) {
      throw new DomainError('COLLECTION_NOT_FOUND', 'Coleção não encontrada.', 404);
    }

    const updateData: { name?: string; description?: string | null } = {};

    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName || trimmedName.length > 50) {
        throw new DomainError('INVALID_COLLECTION_NAME', 'O nome da coleção deve ter entre 1 e 50 caracteres.', 400);
      }

      if (trimmedName.toLowerCase() !== collection.name.toLowerCase()) {
        const existing = await this.prisma.userCollection.findUnique({
          where: {
            userId_name: {
              userId,
              name: trimmedName,
            },
          },
        });
        if (existing && existing.id !== collection.id) {
          throw new DomainError('COLLECTION_NAME_EXISTS', 'Já existe uma coleção com este nome no seu harém.', 409);
        }
      }
      updateData.name = trimmedName;
    }

    if (data.description !== undefined) {
      updateData.description = (data.description || '').trim() || null;
    }

    const updated = await this.prisma.userCollection.update({
      where: { id: collection.id },
      data: updateData,
    });

    return {
      success: true,
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isPrivate: updated.isPrivate,
      position: updated.position,
      message: `Coleção renomeada para "${updated.name}" com sucesso!`,
    };
  }

  /**
   * Apaga uma coleção (os personagens permanecem no harém geral)
   */
  async deleteCollection(userId: string, collectionIdOrName: string) {
    const identifier = (collectionIdOrName || '').trim();
    if (!identifier) {
      throw new DomainError('INVALID_IDENTIFIER', 'Informe o ID ou nome da coleção.', 400);
    }

    // Procura por ID ou por nome
    const collection = await this.prisma.userCollection.findFirst({
      where: {
        userId,
        OR: [
          { id: identifier },
          { name: { equals: identifier, mode: 'insensitive' } },
        ],
      },
      include: {
        _count: { select: { haremEntries: true } },
      },
    });

    if (!collection) {
      throw new DomainError('COLLECTION_NOT_FOUND', 'Coleção não encontrada.', 404);
    }

    await this.prisma.userCollection.delete({
      where: { id: collection.id },
    });

    return {
      success: true,
      id: collection.id,
      name: collection.name,
      unlinkedCount: collection._count.haremEntries,
      message: `Coleção "${collection.name}" apagada com sucesso! Os personagens retornaram ao harém geral.`,
    };
  }

  /**
   * Adiciona um personagem à coleção (se estiver em outra, move automaticamente)
   */
  async addCharacterToCollection(userId: string, collectionIdOrName: string, characterId: string) {
    const colIdentifier = (collectionIdOrName || '').trim();
    const charId = (characterId || '').trim();

    if (!colIdentifier || !charId) {
      throw new DomainError('INVALID_PARAMS', 'Informe a coleção e o ID do personagem.', 400);
    }

    const collection = await this.prisma.userCollection.findFirst({
      where: {
        userId,
        OR: [
          { id: colIdentifier },
          { name: { equals: colIdentifier, mode: 'insensitive' } },
        ],
      },
    });

    if (!collection) {
      throw new DomainError('COLLECTION_NOT_FOUND', 'Coleção não encontrada.', 404);
    }

    // Busca o personagem no harém do usuário (suporta busca por id ou nome parcial se necessário)
    let haremEntry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId: charId,
        },
      },
      include: { character: true },
    });

    if (!haremEntry) {
      // Tenta fallback buscando pelo slug/nome do personagem no harém
      haremEntry = await this.prisma.haremEntry.findFirst({
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
      });
    }

    if (!haremEntry) {
      throw new DomainError('NOT_IN_HAREM', 'Você não é casado com este personagem ou ele não está no seu harém.', 400);
    }

    if (haremEntry.character.isMythic) {
      throw new DomainError('MYTHIC_CANNOT_BE_IN_COLLECTION', 'Personagens míticos não podem ser colocados em coleções/pastas.', 400);
    }

    await this.prisma.haremEntry.update({
      where: { id: haremEntry.id },
      data: { collectionId: collection.id },
    });

    return {
      success: true,
      collection: { id: collection.id, name: collection.name },
      character: { id: haremEntry.character.id, name: haremEntry.character.name },
      message: `${haremEntry.character.name} foi adicionada à coleção "${collection.name}"!`,
    };
  }

  /**
   * Remove um personagem de sua coleção atual (volta para o harém geral)
   */
  async removeCharacterFromCollection(userId: string, characterId: string) {
    const charId = (characterId || '').trim();
    if (!charId) {
      throw new DomainError('INVALID_PARAMS', 'Informe o ID do personagem.', 400);
    }

    let haremEntry = await this.prisma.haremEntry.findUnique({
      where: {
        userId_characterId: {
          userId,
          characterId: charId,
        },
      },
      include: { character: true, collection: true },
    });

    if (!haremEntry) {
      haremEntry = await this.prisma.haremEntry.findFirst({
        where: {
          userId,
          character: {
            OR: [
              { id: { equals: charId, mode: 'insensitive' } },
              { name: { equals: charId, mode: 'insensitive' } },
            ],
          },
        },
        include: { character: true, collection: true },
      });
    }

    if (!haremEntry) {
      throw new DomainError('NOT_IN_HAREM', 'Você não é casado com este personagem.', 400);
    }

    if (!haremEntry.collectionId) {
      throw new DomainError('NOT_IN_COLLECTION', `${haremEntry.character.name} já não está em nenhuma coleção.`, 400);
    }

    const previousColName = haremEntry.collection?.name || 'Coleção';

    await this.prisma.haremEntry.update({
      where: { id: haremEntry.id },
      data: { collectionId: null },
    });

    return {
      success: true,
      character: { id: haremEntry.character.id, name: haremEntry.character.name },
      previousCollection: previousColName,
      message: `${haremEntry.character.name} foi removida da coleção "${previousColName}" e retornou ao harém geral.`,
    };
  }

  /**
   * Reordena as coleções do usuário conforme lista de IDs recebida
   */
  async reorderCollections(userId: string, orderedIds: string[]) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new DomainError('INVALID_ORDER', 'Lista de ordenação inválida.', 400);
    }

    const userCols = await this.prisma.userCollection.findMany({
      where: { userId },
      select: { id: true },
    });
    const userColIdSet = new Set(userCols.map((c) => c.id));

    // Valida que todos os IDs informados pertencem ao usuário
    for (const id of orderedIds) {
      if (!userColIdSet.has(id)) {
        throw new DomainError('INVALID_COLLECTION_ID', `Coleção "${id}" não pertence a este usuário.`, 400);
      }
    }

    // Atualiza em transação atômica
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.userCollection.update({
          where: { id },
          data: { position: index + 1 },
        })
      )
    );

    return this.listUserCollections(userId);
  }

  /**
   * Alterna ou define a visibilidade privada de uma coleção
   */
  async setCollectionPrivacy(userId: string, collectionIdOrName: string, isPrivate?: boolean) {
    const identifier = (collectionIdOrName || '').trim();
    if (!identifier) {
      throw new DomainError('INVALID_IDENTIFIER', 'Informe o ID ou nome da coleção.', 400);
    }

    const collection = await this.prisma.userCollection.findFirst({
      where: {
        userId,
        OR: [
          { id: identifier },
          { name: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });

    if (!collection) {
      throw new DomainError('COLLECTION_NOT_FOUND', 'Coleção não encontrada.', 404);
    }

    const nextState = typeof isPrivate === 'boolean' ? isPrivate : !collection.isPrivate;

    const updated = await this.prisma.userCollection.update({
      where: { id: collection.id },
      data: { isPrivate: nextState },
    });

    return {
      success: true,
      id: updated.id,
      name: updated.name,
      isPrivate: updated.isPrivate,
      message: updated.isPrivate
        ? `A coleção "${updated.name}" agora é privada e não será exibida no harém público.`
        : `A coleção "${updated.name}" agora é pública.`,
    };
  }
}
