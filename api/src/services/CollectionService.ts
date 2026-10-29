import { PrismaClient } from '@prisma/client';
import { CharacterService } from './CharacterService.js';
import { DomainError } from '../errors/DomainError.js';

export class CollectionService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService
  ) {}

  /**
   * Lista todas as coleções do usuário com contagem e detalhes de personagens
   */
  async listUserCollections(userId: string) {
    const collections = await this.prisma.userCollection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
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
        imageUrl: this.characterService.getRandomImageUrl(e.character.id, e.character.imageUrls),
        imageUrls: e.character.imageUrls.map((img) => this.characterService.formatImageUrl(e.character.id, img)),
      })),
    }));
  }

  /**
   * Cria uma nova coleção para o usuário (limite máximo de 15)
   */
  async createCollection(userId: string, name: string, description?: string) {
    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length > 50) {
      throw new DomainError('INVALID_COLLECTION_NAME', 'O nome da coleção deve ter entre 1 e 50 caracteres.', 400);
    }

    const currentCount = await this.prisma.userCollection.count({
      where: { userId },
    });

    if (currentCount >= 15) {
      throw new DomainError('COLLECTION_LIMIT_REACHED', 'Você atingiu o limite máximo de 15 coleções.', 400);
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

    const collection = await this.prisma.userCollection.create({
      data: {
        userId,
        name: trimmedName,
        description: description ? description.trim() : null,
      },
    });

    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      createdAt: collection.createdAt,
      totalCollections: currentCount + 1,
      message: `Coleção "${collection.name}" criada com sucesso! (${currentCount + 1}/15)`,
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
}
