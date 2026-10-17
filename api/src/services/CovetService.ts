import { PrismaClient, CovetStatus } from '@prisma/client';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService } from './CharacterService.js';
import { WishlistService } from './WishlistService.js';

export class CovetService {
  constructor(
    private prisma: PrismaClient,
    private characterService: CharacterService,
    private wishlistService?: WishlistService
  ) {}

  /**
   * Cobiça um personagem já casado de outro jogador
   * Adiciona automaticamente à Wishlist do usuário e sinaliza para notificação no !mu-roll do dono
   */
  async covet(userId: string, characterIdOrSearch: string) {
    if (!characterIdOrSearch?.trim()) {
      throw new DomainError('INVALID_INPUT', 'Identificador do personagem é obrigatório.');
    }

    const character = await this.characterService.findCharacter(characterIdOrSearch);
    if (!character) {
      throw new DomainError('CHARACTER_NOT_FOUND', 'Personagem não encontrado.');
    }

    // Verifica se o personagem está casado
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: { characterId: character.id },
      include: {
        user: { select: { id: true, name: true, publicId: true } },
      },
    });

    if (!haremEntry) {
      throw new DomainError(
        'NOT_MARRIED',
        `*${character.name}* está solteira(o)! Você pode desejá-la(o) normalmente na Wishlist via !mu-desejar.`
      );
    }

    if (haremEntry.userId === userId) {
      throw new DomainError('OWN_CHARACTER', 'Você já é casado(a) com este personagem!');
    }

    // Adiciona à Wishlist automaticamente (se wishlistService estiver disponível)
    if (this.wishlistService) {
      try {
        await this.wishlistService.addToWishlist(userId, character.id);
      } catch {
        // Se a wishlist falhar (ex: limite), prossegue com o covet mesmo assim
      }
    } else {
      // Fallback direto via prisma
      await this.prisma.wishlistEntry.upsert({
        where: { userId_characterId: { userId, characterId: character.id } },
        create: { userId, characterId: character.id },
        update: {},
      }).catch(() => {});
    }

    // Cria ou atualiza o registro de covet
    const covet = await this.prisma.characterCovet.upsert({
      where: {
        characterId_userId: { characterId: character.id, userId },
      },
      create: {
        characterId: character.id,
        userId,
        ownerId: haremEntry.userId,
        status: CovetStatus.PENDING,
        notifiedOwner: false,
      },
      update: {
        ownerId: haremEntry.userId,
        status: CovetStatus.PENDING,
        notifiedOwner: false,
      },
    });

    return {
      success: true,
      covet,
      character: {
        id: character.id,
        name: character.name,
        series: character.series,
        baseRarity: character.baseRarity,
      },
      owner: haremEntry.user,
    };
  }

  /**
   * Lista os interessados em um personagem pertencente ao harém do usuário
   */
  async getCharacterCovets(ownerId: string, characterId: string) {
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: { userId: ownerId, characterId },
    });

    if (!haremEntry) {
      throw new DomainError('NOT_IN_HAREM', 'Este personagem não pertence ao seu harém.');
    }

    const covets = await this.prisma.characterCovet.findMany({
      where: { characterId, ownerId },
      include: {
        user: { select: { id: true, name: true, publicId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return covets.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.user.name,
      userPublicId: c.user.publicId,
      status: c.status,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Ignora o interesse de um usuário específico
   */
  async ignoreCovet(ownerId: string, covetId: string) {
    const covet = await this.prisma.characterCovet.findFirst({
      where: { id: covetId, ownerId },
    });

    if (!covet) {
      throw new DomainError('COVET_NOT_FOUND', 'Interesse não encontrado ou não pertence a você.');
    }

    await this.prisma.characterCovet.update({
      where: { id: covetId },
      data: { status: CovetStatus.IGNORED },
    });

    return { success: true };
  }

  /**
   * Marca todos os interessados pendentes de um personagem como visto
   */
  async markAllSeen(ownerId: string, characterId: string) {
    await this.prisma.characterCovet.updateMany({
      where: {
        ownerId,
        characterId,
        status: CovetStatus.PENDING,
      },
      data: { status: CovetStatus.SEEN },
    });

    return { success: true };
  }

  /**
   * Retorna um mapa com contagem de interessados (não vistos e totais) por personagem do harém do dono
   */
  async getHaremCovetCounts(ownerId: string): Promise<Record<string, { unseen: number; total: number }>> {
    const covets = await this.prisma.characterCovet.findMany({
      where: { ownerId },
      select: { characterId: true, status: true },
    });

    const map: Record<string, { unseen: number; total: number }> = {};
    for (const c of covets) {
      if (!map[c.characterId]) {
        map[c.characterId] = { unseen: 0, total: 0 };
      }
      map[c.characterId].total++;
      if (c.status === CovetStatus.PENDING) {
        map[c.characterId].unseen++;
      }
    }

    return map;
  }

  /**
   * Retorna a lista de IDs de personagens que o usuário já cobiçou
   */
  async getUserCovetedCharacterIds(userId: string): Promise<string[]> {
    const covets = await this.prisma.characterCovet.findMany({
      where: { userId },
      select: { characterId: true },
    });
    return covets.map((c) => c.characterId);
  }
}
