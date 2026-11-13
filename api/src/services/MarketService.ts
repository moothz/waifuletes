import { PrismaClient, ListingStatus, OfferStatus, KakeraReason, Rarity } from '@prisma/client';
import { config, ravenaMarketHeaders } from '../config.js';
import { DomainError } from '../errors/DomainError.js';
import { CharacterService } from './CharacterService.js';
import { CooldownService } from './CooldownService.js';
import { NotificationService } from './NotificationService.js';

export interface CreateOfferData {
  message?: string;
  offeredItems: {
    zinthos?: number;
    runas?: number;
    petalitas?: number;
    waifuIds?: string[];
    fishes?: Array<{ id: number; name?: string; weight?: number; isRare?: boolean }>;
    fishingBuffs?: Array<{ id: number; originalName?: string; type?: string; description?: string }>;
    fishingBuffIds?: number[];
    farmItems?: Array<{ itemId: string; name?: string; amount: number }>;
    isFree?: boolean;
  };
}

export class MarketService {
  private notificationService: NotificationService;

  constructor(
    private prisma: PrismaClient,
    private characterService?: CharacterService,
    private cooldownService?: CooldownService
  ) {
    this.notificationService = new NotificationService(this.prisma);
  }

  public formatCharacter(character: any) {
    if (!character) return character;
    let imageUrl = '/media/characters/default.jpg';
    let imageUrls: string[] = [];
    if (this.characterService) {
      imageUrl = this.characterService.getRandomImageUrl(character.id, character.imageUrls);
      imageUrls = (character.imageUrls || []).map((img: string) =>
        this.characterService!.formatImageUrl(character.id, img)
      );
    } else {
      if (Array.isArray(character.imageUrls) && character.imageUrls.length > 0) {
        const first = character.imageUrls[0];
        imageUrl = first.startsWith('http') || first.startsWith('/media/') ? first : `${config.PUBLIC_BASE_URL}/media/${first}`;
        imageUrls = character.imageUrls.map((img: string) =>
          img.startsWith('http') || img.startsWith('/media/') ? img : `${config.PUBLIC_BASE_URL}/media/${img}`
        );
      }
    }
    return {
      ...character,
      imageUrl,
      imageUrls,
    };
  }

  /**
   * Cria um novo anúncio de venda nos classificados
   */
  async createListing(userId: string, characterId: string, interest: string) {
    if (!characterId || !interest?.trim()) {
      throw new DomainError('INVALID_INPUT', 'Personagem e interesse de troca são obrigatórios.');
    }

    // 1. Checa se o usuário realmente tem o personagem no harém
    const haremEntry = await this.prisma.haremEntry.findFirst({
      where: { userId, characterId },
      include: { character: true },
    });

    if (!haremEntry) {
      throw new DomainError('NOT_IN_HAREM', 'Você não possui este personagem no seu harém.');
    }

    if (haremEntry.character.isMythic || (haremEntry.character as any).baseRarity === 'MYTHIC') {
      throw new DomainError('CANNOT_LIST_MYTHIC', 'Personagens Míticos pertencem exclusivamente ao seu criador e não podem ser anunciados nos classificados.');
    }

    // 2. Checa se já existe anúncio ativo para este personagem
    const existingListing = await this.prisma.marketListing.findFirst({
      where: { characterId, status: ListingStatus.ACTIVE },
    });

    if (existingListing) {
      throw new DomainError('ALREADY_LISTED', 'Este personagem já possui um anúncio ativo nos classificados.');
    }

    const listing = await this.prisma.marketListing.create({
      data: {
        userId,
        characterId,
        interest: interest.trim(),
        status: ListingStatus.ACTIVE,
      },
      include: {
        character: true,
        user: { select: { name: true, publicId: true } },
      },
    });

    // Registra notificações para quem possui na Wishlist ou cobiçou este personagem
    try {
      const interestedUsers = await this.prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT "user_id" as "userId" FROM (
          SELECT "user_id" FROM "wishlist_entries" WHERE "character_id" = ${characterId}
          UNION
          SELECT "user_id" FROM "character_covets" WHERE "character_id" = ${characterId}
        ) t WHERE "user_id" != ${userId}
      `;

      if (interestedUsers.length > 0) {
        await this.prisma.marketListingNotification.createMany({
          data: interestedUsers.map((u) => ({
            userId: u.userId,
            listingId: listing.id,
            characterId,
            notified: false,
          })),
          skipDuplicates: true,
        });

        for (const u of interestedUsers) {
          this.notificationService.notifyMarketEvent(
            u.userId,
            'MARKET_LISTING_MATCH',
            `📢 ${listing.character.name} da sua Wishlist foi anunciada!`,
            `Um jogador acabou de anunciar ${listing.character.name} nos classificados!`,
            {
              listingId: listing.id,
              characterId,
              characterName: listing.character.name,
              actorPublicId: listing.user?.publicId || null,
              actorName: listing.user?.name || 'Jogador',
            }
          ).catch(() => {});
        }
      }
    } catch {
      // Ignora erro para não falhar a criação do anúncio
    }

    return {
      ...listing,
      character: this.formatCharacter(listing.character),
    };
  }

  /**
   * Cancela um anúncio criado pelo próprio usuário
   */
  async cancelListing(userId: string, listingId: string) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new DomainError('NOT_FOUND', 'Anúncio não encontrado.');
    }

    if (listing.userId !== userId) {
      throw new DomainError('UNAUTHORIZED', 'Você só pode cancelar seus próprios anúncios.');
    }

    if (listing.status !== ListingStatus.ACTIVE) {
      throw new DomainError('INVALID_STATUS', 'Apenas anúncios ativos podem ser cancelados.');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Cancela todas as ofertas pendentes desse anúncio
      await tx.marketOffer.updateMany({
        where: { listingId, status: OfferStatus.PENDING },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: 'Anúncio cancelado pelo vendedor.',
          notifiedBuyer: false,
          buyerNotifiedStatus: 'CANCELLED',
        },
      });

      return await tx.marketListing.update({
        where: { id: listingId },
        data: { status: ListingStatus.CANCELLED },
      });
    });
  }

  /**
   * Listagem global paginada de classificados com busca e ordenação
   */
  async listGlobalListings(options: {
    search?: string;
    sortBy?: 'rarity' | 'wishlist' | 'popularity' | 'recent';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
    const skip = (page - 1) * limit;
    const search = options.search?.trim();

    const where: any = {
      status: ListingStatus.ACTIVE,
    };

    if (search) {
      const searchTerms = search.replace(/[,;+]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (searchTerms.length > 1) {
        where.AND = searchTerms.map((term) => ({
          OR: [
            { character: { name: { contains: term, mode: 'insensitive' } } },
            { character: { series: { contains: term, mode: 'insensitive' } } },
            { interest: { contains: term, mode: 'insensitive' } },
          ],
        }));
      } else if (searchTerms.length === 1) {
        const term = searchTerms[0];
        where.OR = [
          { character: { name: { contains: term, mode: 'insensitive' } } },
          { character: { series: { contains: term, mode: 'insensitive' } } },
          { interest: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    let orderBy: any = { createdAt: 'desc' };
    if (options.sortBy === 'popularity') {
      orderBy = { character: { claimCount: 'desc' } };
    }

    const [total, listings] = await Promise.all([
      this.prisma.marketListing.count({ where }),
      this.prisma.marketListing.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          user: {
            select: { id: true, name: true, publicId: true },
          },
          character: {
            include: {
              _count: {
                select: { wishlists: true },
              },
              haremEntries: {
                select: { userId: true, keys: true, isFavorite: true },
              },
            },
          },
        },
      }),
    ]);

    // Ordenação secundária por raridade ou wishlist em memória se solicitado
    let sorted = listings;
    if (options.sortBy === 'wishlist') {
      sorted = [...listings].sort((a, b) => b.character._count.wishlists - a.character._count.wishlists);
    } else if (options.sortBy === 'rarity') {
      const rarityRank: Record<string, number> = {
        MYTHIC: 6,
        LEGENDARY: 5,
        EPIC: 4,
        RARE: 3,
        UNCOMMON: 2,
        COMMON: 1,
      };
      sorted = [...listings].sort((a, b) => {
        const scoreB = b.character.isMythic ? rarityRank.MYTHIC : rarityRank[b.character.baseRarity] || 0;
        const scoreA = a.character.isMythic ? rarityRank.MYTHIC : rarityRank[a.character.baseRarity] || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const kB = (b.character as any).haremEntries?.find((h: any) => h.userId === b.userId)?.keys || 1;
        const kA = (a.character as any).haremEntries?.find((h: any) => h.userId === a.userId)?.keys || 1;
        return kB - kA;
      });
    }

    const formattedListings = sorted.map((l) => {
      const ownerHarem = (l.character as any).haremEntries?.find((h: any) => h.userId === l.userId);
      const keys = ownerHarem?.keys || 1;
      const isSoulmate = keys >= 10;
      return {
        ...l,
        keys,
        isSoulmate,
        character: {
          ...this.formatCharacter(l.character),
          keys,
          isSoulmate,
        },
      };
    });

    return {
      listings: formattedListings,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retorna os anúncios ATIVOS do próprio usuário com contagem de ofertas pendentes
   */
  async getUserListings(userId: string) {
    const listings = await this.prisma.marketListing.findMany({
      where: { userId, status: ListingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      include: {
        character: {
          include: {
            haremEntries: {
              where: { userId },
              select: { keys: true, isFavorite: true },
            },
          },
        },
        offers: {
          where: { status: OfferStatus.PENDING },
          select: { id: true },
        },
        _count: {
          select: {
            offers: {
              where: { status: OfferStatus.PENDING },
            },
          },
        },
      },
    });

    return listings.map((l) => {
      const keys = (l.character as any).haremEntries?.[0]?.keys || 1;
      const isSoulmate = keys >= 10;
      return {
        ...l,
        keys,
        isSoulmate,
        character: {
          ...this.formatCharacter(l.character),
          keys,
          isSoulmate,
        },
      };
    });
  }

  /**
   * Retorna os anúncios ATIVOS cujos personagens estão na wishlist do usuário
   */
  async getWishlistListings(userId: string) {
    const listings = await this.prisma.marketListing.findMany({
      where: {
        status: ListingStatus.ACTIVE,
        character: {
          wishlists: {
            some: { userId },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, publicId: true },
        },
        character: {
          include: {
            _count: {
              select: { wishlists: true },
            },
            haremEntries: {
              select: { userId: true, keys: true, isFavorite: true },
            },
          },
        },
      },
    });

    return listings.map((l) => {
      const ownerHarem = (l.character as any).haremEntries?.find((h: any) => h.userId === l.userId);
      const keys = ownerHarem?.keys || 1;
      const isSoulmate = keys >= 10;
      return {
        ...l,
        keys,
        isSoulmate,
        character: {
          ...this.formatCharacter(l.character),
          keys,
          isSoulmate,
        },
      };
    });
  }

  /**
   * Retorna todas as ofertas enviadas pelo usuário (ordenadas da mais recente para a mais antiga)
   */
  async getUserSentOffers(buyerId: string) {
    const offers = await this.prisma.marketOffer.findMany({
      where: {
        buyerId,
      },
      orderBy: { createdAt: 'desc' },
      // Histórico limitado: o payload crescia sem limite desde que o corte de 15 dias foi removido
      take: 200,
      include: {
        listing: {
          include: {
            character: true,
            user: { select: { id: true, name: true, publicId: true } },
          },
        },
      },
    });

    return offers.map((o) => ({
      ...o,
      listing: {
        ...o.listing,
        character: this.formatCharacter(o.listing.character),
      },
    }));
  }

  /**
   * Retorna as ofertas de um anúncio específico para o vendedor com detalhes das waifus ofertadas
   */
  async getListingOffers(sellerId: string, listingId: string) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new DomainError('NOT_FOUND', 'Anúncio não encontrado.');
    }

    if (listing.userId !== sellerId) {
      throw new DomainError('UNAUTHORIZED', 'Apenas o dono do anúncio pode ver suas ofertas.');
    }

    const offers = await this.prisma.marketOffer.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: {
          select: { id: true, name: true, publicId: true },
        },
      },
    });

    // Se há waifuIds nas ofertas, busca os dados das waifus para exibir no modal
    const allWaifuIds = new Set<string>();
    offers.forEach((o) => {
      const waifuIds = (o.offeredItems as any)?.waifuIds || [];
      waifuIds.forEach((id: string) => allWaifuIds.add(id));
    });

    const waifuMap = new Map<string, any>();
    if (allWaifuIds.size > 0) {
      const chars = await this.prisma.character.findMany({
        where: { id: { in: Array.from(allWaifuIds) } },
      });
      chars.forEach((c) => waifuMap.set(c.id, this.formatCharacter(c)));
    }

    return offers.map((o) => {
      const offered = (o.offeredItems as any) || {};
      const waifus = (offered.waifuIds || []).map((id: string) => waifuMap.get(id) || { id, name: id });
      return {
        ...o,
        offeredItems: {
          ...offered,
          waifus,
        },
      };
    });
  }

  /**
   * Retorna todas as ofertas pendentes recebidas pelo vendedor (para WhatsApp !mu-ofertas)
   */
  async getUserReceivedOffers(sellerId: string) {
    const offers = await this.prisma.marketOffer.findMany({
      where: {
        sellerId,
        status: OfferStatus.PENDING,
        listing: { status: ListingStatus.ACTIVE },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: { select: { id: true, name: true, publicId: true } },
        listing: { include: { character: true } },
      },
    });

    return offers.map((o) => ({
      ...o,
      listing: {
        ...o.listing,
        character: this.formatCharacter(o.listing.character),
      },
    }));
  }

  /**
   * Cria uma proposta de oferta para um anúncio
   */
  /**
   * Normaliza e valida os itens ofertados. Quantidades precisam ser inteiras e não negativas:
   * antes, runas/petalitas/quantidades negativas passavam direto para a transferência da Ravena
   * (o vendedor via só os valores positivos, mas o comprador podia receber runas do vendedor).
   */
  private sanitizeOfferedItems(raw: any): CreateOfferData['offeredItems'] {
    const items = raw && typeof raw === 'object' ? raw : {};
    const invalid = (msg: string): never => {
      throw new DomainError('INVALID_OFFER_ITEMS', msg);
    };
    const nonNegInt = (value: any, label: string): number => {
      if (value === undefined || value === null || value === '') return 0;
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        invalid(`Quantidade inválida de ${label}: use um número inteiro maior ou igual a zero.`);
      }
      return n;
    };
    const posInt = (value: any, label: string): number => {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        invalid(`Valor inválido em ${label}: use um número inteiro maior que zero.`);
      }
      return n;
    };

    const waifuIds: string[] = Array.isArray(items.waifuIds)
      ? [...new Set<string>(items.waifuIds.map((id: any) => String(id || '').trim()).filter(Boolean))]
      : [];
    if (waifuIds.length > 20) invalid('Você pode ofertar no máximo 20 waifus por proposta.');

    const fishingBuffs = Array.isArray(items.fishingBuffs)
      ? items.fishingBuffs.map((b: any) => ({
          ...(b && typeof b === 'object' ? b : {}),
          id: posInt(b?.id, 'buffs de pesca'),
        }))
      : [];
    const buffIdSet = new Set<number>([
      ...fishingBuffs.map((b: any) => b.id),
      ...(Array.isArray(items.fishingBuffIds) ? items.fishingBuffIds.map((id: any) => posInt(id, 'buffs de pesca')) : []),
    ]);
    if (buffIdSet.size > 50) invalid('Você pode ofertar no máximo 50 buffs de pesca por proposta.');

    const farmMap = new Map<string, { itemId: string; name?: string; amount: number }>();
    if (Array.isArray(items.farmItems)) {
      for (const it of items.farmItems) {
        const itemId = String(it?.itemId || '').trim();
        if (!itemId) invalid('Item da fazenda sem identificador.');
        const amount = posInt(it?.amount ?? it?.quantity, 'itens da fazenda');
        const prev = farmMap.get(itemId);
        farmMap.set(itemId, {
          itemId,
          name: typeof it?.name === 'string' ? it.name.slice(0, 80) : prev?.name,
          amount: (prev?.amount || 0) + amount,
        });
      }
    }
    if (farmMap.size > 50) invalid('Você pode ofertar no máximo 50 itens da fazenda diferentes por proposta.');

    return {
      isFree: Boolean(items.isFree),
      zinthos: nonNegInt(items.zinthos, 'Zinthos'),
      runas: nonNegInt(items.runas, 'Runas'),
      petalitas: nonNegInt(items.petalitas, 'Petalitas'),
      waifuIds,
      fishes: Array.isArray(items.fishes) ? items.fishes.slice(0, 50) : [],
      fishingBuffs,
      fishingBuffIds: [...buffIdSet],
      farmItems: [...farmMap.values()],
    };
  }

  async createOffer(buyerId: string, listingId: string, data: CreateOfferData) {
    data = { ...data, offeredItems: this.sanitizeOfferedItems(data?.offeredItems) };
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      include: { character: true },
    });

    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new DomainError('LISTING_NOT_ACTIVE', 'O anúncio não está mais disponível.');
    }

    if (listing.userId === buyerId) {
      throw new DomainError('CANNOT_OFFER_OWN', 'Você não pode fazer oferta no seu próprio anúncio.');
    }

    // Checa se o comprador já tem oferta pendente neste anúncio
    const existingOffer = await this.prisma.marketOffer.findFirst({
      where: { listingId, buyerId, status: OfferStatus.PENDING },
    });

    if (existingOffer) {
      throw new DomainError('ALREADY_OFFERED', 'Você já possui uma oferta pendente neste anúncio.');
    }

    // Se ofertou waifus, valida se o comprador tem todas elas no harém e não são míticas
    const waifuIds = data.offeredItems?.waifuIds || [];
    if (waifuIds.length > 0) {
      const owned = await this.prisma.haremEntry.findMany({
        where: { userId: buyerId, characterId: { in: waifuIds } },
        include: { character: true },
      });
      if (owned.length !== waifuIds.length) {
        throw new DomainError('MISSING_WAIFUS', 'Você não possui todos os personagens ofertados no seu harém.');
      }
      const hasMythic = owned.some((o) => o.character.isMythic || (o.character as any).baseRarity === 'MYTHIC');
      if (hasMythic) {
        throw new DomainError('CANNOT_OFFER_MYTHIC', 'Personagens Míticos pertencem exclusivamente ao seu criador e não podem ser ofertados em negociações.');
      }
    }

    // Se ofertou Zinthos, valida se o comprador tem saldo suficiente
    const offeredZinthos = Number(data.offeredItems?.zinthos) || 0;
    if (offeredZinthos > 0) {
      const buyer = await this.prisma.user.findUnique({
        where: { id: buyerId },
        select: { kakera: true },
      });
      if (!buyer || buyer.kakera < offeredZinthos) {
        throw new DomainError(
          'INSUFFICIENT_ZINTHOS',
          `Saldo insuficiente de Zinthos. Você possui ${buyer?.kakera || 0} Zinthos, mas tentou oferecer ${offeredZinthos}.`
        );
      }
    }

    // Validação ao vivo de estoque de itens externos (Runas, Buffs, Fazenda e Petalitas)
    const offeredRunas = Number(data.offeredItems?.runas) || 0;
    const offeredPetalitas = Number(data.offeredItems?.petalitas) || 0;
    const offeredBuffs = Array.isArray(data.offeredItems?.fishingBuffs) ? data.offeredItems.fishingBuffs : [];
    const offeredBuffIds = Array.isArray(data.offeredItems?.fishingBuffIds) ? data.offeredItems.fishingBuffIds : [];
    const offeredFarmItems = Array.isArray(data.offeredItems?.farmItems) ? data.offeredItems.farmItems : [];

    const hasExternalItems = offeredRunas > 0 || offeredPetalitas > 0 || offeredBuffs.length > 0 || offeredBuffIds.length > 0 || offeredFarmItems.length > 0;
    if (hasExternalItems) {
      try {
        const invRes = await fetch(`${config.RAVENA_API_URL}/api/market/user-inventory/${encodeURIComponent(buyerId)}`, {
          headers: ravenaMarketHeaders(),
          signal: AbortSignal.timeout(6000),
        });
        if (!invRes.ok) {
          throw new Error(`Serviço de inventário indisponível (HTTP ${invRes.status})`);
        }
        const invData = (await invRes.json()) as any;
        if (!invData || !invData.success) {
          throw new Error(invData?.error || 'Não foi possível validar seu inventário externo.');
        }

        // Valida Runas
        if (offeredRunas > 0) {
          if ((invData.runas || 0) < offeredRunas) {
            throw new DomainError(
              'INSUFFICIENT_RUNAS',
              `Saldo insuficiente de Runas. Você possui ${invData.runas || 0} ᚱ, mas tentou oferecer ${offeredRunas} ᚱ.`
            );
          }
        }

        // Valida Petalitas
        if (offeredPetalitas > 0) {
          const userCoins = invData.farm?.coins || 0;
          if (userCoins < offeredPetalitas) {
            throw new DomainError(
              'INSUFFICIENT_PETALITAS',
              `Saldo insuficiente de Petalitas. Você possui ${userCoins} petalitas, mas tentou oferecer ${offeredPetalitas}.`
            );
          }
        }

        // Valida Buffs
        const checkBuffIds = offeredBuffIds.length > 0 ? offeredBuffIds : offeredBuffs.map((b: any) => b.id);
        if (checkBuffIds.length > 0) {
          const userBuffIds = new Set((invData.fishingBuffs || []).map((b: any) => b.id));
          for (const bId of checkBuffIds) {
            if (!userBuffIds.has(bId)) {
              throw new DomainError(
                'INSUFFICIENT_BUFFS',
                `O buff de pesca selecionado (ID: ${bId}) não foi encontrado no seu inventário atual.`
              );
            }
          }
        }

        // Valida Itens da Fazenda
        if (offeredFarmItems.length > 0) {
          const farmMap = new Map<string, number>((invData.farm?.items || []).map((it: any) => [String(it.itemId), Number(it.quantity) || 0]));
          for (const reqItem of offeredFarmItems) {
            const currentQty = Number(farmMap.get(reqItem.itemId) || 0);
            const needQty = Number(reqItem.amount) || 1;
            if (currentQty < needQty) {
              throw new DomainError(
                'INSUFFICIENT_FARM_ITEMS',
                `Item da fazenda insuficiente (${reqItem.name || reqItem.itemId}: você possui ${currentQty}, tentou oferecer ${needQty}).`
              );
            }
          }
        }
      } catch (valErr: any) {
        if (valErr instanceof DomainError) throw valErr;
        throw new DomainError('INVENTORY_VALIDATION_FAILED', `Falha ao validar inventário em tempo real: ${valErr?.message || 'Erro desconhecido'}`);
      }
    }

    const offer = await this.prisma.marketOffer.create({
      data: {
        listingId,
        buyerId,
        sellerId: listing.userId,
        message: data.message?.trim() || null,
        offeredItems: data.offeredItems as any,
        status: OfferStatus.PENDING,
        notifiedSeller: false,
      },
      include: {
        listing: { include: { character: true } },
      },
    });

    const buyerUser = await this.prisma.user.findUnique({ where: { id: buyerId }, select: { name: true, publicId: true } });
    this.notificationService
      .notifyMarketEvent(
        listing.userId,
        'MARKET_OFFER_RECEIVED',
        `💰 Nova proposta para ${listing.character.name}!`,
        `${buyerUser?.name || 'Um jogador'} enviou uma proposta no seu anúncio nos classificados.`,
        {
          listingId,
          characterId: listing.characterId,
          characterName: listing.character.name,
          offerId: offer.id,
          actorPublicId: buyerUser?.publicId || null,
          actorName: buyerUser?.name || 'Jogador',
        }
      )
      .catch(() => {});

    return offer;
  }

  /**
   * Rejeita uma oferta recebida (com motivo opcional)
   */
  async rejectOffer(sellerId: string, offerId: string, reason?: string) {
    const offer = await this.prisma.marketOffer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      throw new DomainError('NOT_FOUND', 'Oferta não encontrada.');
    }

    if (offer.sellerId !== sellerId) {
      throw new DomainError('UNAUTHORIZED', 'Você não tem permissão para responder a esta oferta.');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new DomainError('INVALID_STATUS', 'Esta oferta já foi finalizada.');
    }

    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 300) : null;

    // Condicional ao status: um aceite em andamento (PROCESSING) ou concluído não pode ser sobrescrito
    const rejectedCount = await this.prisma.marketOffer.updateMany({
      where: { id: offerId, sellerId, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.REJECTED,
        cancelReason: cleanReason,
        notifiedBuyer: false,
        buyerNotifiedStatus: 'REJECTED',
      },
    });
    if (rejectedCount.count !== 1) {
      throw new DomainError('INVALID_STATUS', 'Esta oferta já foi finalizada ou está sendo processada.');
    }

    const rejected = await this.prisma.marketOffer.findUniqueOrThrow({
      where: { id: offerId },
      include: {
        listing: { include: { character: true, user: { select: { name: true, publicId: true } } } },
      },
    });

    const notifBody = cleanReason
      ? `O vendedor não aceitou a sua proposta. Motivo: "${cleanReason}". Os itens/zinthos ofertados permanecem com você.`
      : 'O vendedor não aceitou a sua proposta e os itens/zinthos ofertados foram devolvidos.';

    this.notificationService
      .notifyMarketEvent(
        offer.buyerId,
        'MARKET_OFFER_REJECTED',
        `❌ Proposta recusada para ${rejected.listing?.character?.name || 'personagem'}`,
        notifBody,
        {
          listingId: offer.listingId,
          offerId: offer.id,
          reason: cleanReason,
          characterId: rejected.listing?.character?.id || null,
          characterName: rejected.listing?.character?.name || null,
          actorPublicId: rejected.listing?.user?.publicId || null,
          actorName: rejected.listing?.user?.name || 'Vendedor',
        }
      )
      .catch(() => {});

    return rejected;
  }

  /**
   * Cancela uma proposta enviada pelo próprio comprador enquanto ainda estiver pendente
   */
  async cancelOffer(buyerId: string, offerId: string) {
    const offer = await this.prisma.marketOffer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      throw new DomainError('NOT_FOUND', 'Oferta não encontrada.');
    }

    if (offer.buyerId !== buyerId) {
      throw new DomainError('UNAUTHORIZED', 'Você só pode cancelar propostas enviadas por você.');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new DomainError('INVALID_STATUS', 'Apenas propostas pendentes podem ser canceladas.');
    }

    // Condicional ao status: se o vendedor já está aceitando (PROCESSING), o cancelamento não sobrescreve
    const cancelledCount = await this.prisma.marketOffer.updateMany({
      where: { id: offerId, buyerId, status: OfferStatus.PENDING },
      data: {
        status: OfferStatus.CANCELLED,
        cancelReason: 'Cancelada pelo comprador',
        notifiedBuyer: true,
        buyerNotifiedStatus: 'CANCELLED',
      },
    });
    if (cancelledCount.count !== 1) {
      throw new DomainError('INVALID_STATUS', 'Esta proposta já foi respondida ou está sendo processada pelo vendedor.');
    }

    return this.prisma.marketOffer.findUniqueOrThrow({ where: { id: offerId } });
  }

  /**
   * Aceita uma oferta com validação em tempo real e transferência atômica multi-jogo
   */
  async acceptOffer(sellerId: string, offerId: string) {
    try {
      return await this.acceptOfferLocked(sellerId, offerId);
    } finally {
      // Nenhum caminho pode deixar a oferta presa em PROCESSING: se o fluxo saiu sem marcá-la como
      // ACCEPTED/CANCELLED/PENDING (exceção de Redis/Prisma, throw de validação), devolve para PENDING.
      // Condicional ao status, então é no-op quando outro caminho já finalizou a oferta.
      await this.prisma.marketOffer
        .updateMany({
          where: { id: offerId, sellerId, status: OfferStatus.PROCESSING },
          data: { status: OfferStatus.PENDING },
        })
        .catch((err: any) => {
          console.error(`[Market] Falha ao liberar trava PROCESSING da oferta ${offerId}:`, err?.message);
        });
    }
  }

  private async acceptOfferLocked(sellerId: string, offerId: string) {
    const offer = await this.prisma.marketOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: { include: { character: true, user: { select: { name: true, publicId: true } } } },
        buyer: true,
      },
    });

    if (!offer) {
      throw new DomainError('NOT_FOUND', 'Oferta não encontrada.');
    }

    if (offer.sellerId !== sellerId) {
      throw new DomainError('UNAUTHORIZED', 'Você não tem permissão para aceitar esta oferta.');
    }

    if (offer.status !== OfferStatus.PENDING) {
      throw new DomainError('INVALID_STATUS', 'Esta oferta já foi respondida ou cancelada.');
    }

    // Trava atômica da oferta: move de PENDING para PROCESSING para prevenir concorrência / duplo aceite
    if (typeof this.prisma.marketOffer?.updateMany === 'function') {
      const locked = await this.prisma.marketOffer.updateMany({
        where: { id: offerId, status: OfferStatus.PENDING },
        data: { status: OfferStatus.PROCESSING },
      });

      if (locked.count === 0) {
        throw new DomainError('OFFER_ALREADY_PROCESSED', 'Esta oferta já está sendo processada ou já foi respondida/cancelada.');
      }
    }

    const listing = offer.listing;
    // Relê o status do anúncio depois da trava (o include acima pode estar defasado)
    const freshListing = await this.prisma.marketListing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    });
    if (!freshListing || freshListing.status !== ListingStatus.ACTIVE) {
      await this.prisma.marketOffer.updateMany({
        where: { id: offer.id, status: OfferStatus.PROCESSING },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: 'O anúncio não está mais ativo.',
          notifiedBuyer: false,
          buyerNotifiedStatus: 'CANCELLED',
        },
      });
      throw new DomainError('LISTING_NOT_ACTIVE', 'O anúncio não está mais ativo.');
    }

    // Serializa aceites do mesmo anúncio: se outra oferta dele já está em processamento, não inicia
    // uma segunda transferência externa (a trava acima é por oferta, não por anúncio).
    const otherProcessing = await this.prisma.marketOffer.count({
      where: { listingId: listing.id, id: { not: offer.id }, status: OfferStatus.PROCESSING },
    });
    if (otherProcessing > 0) {
      throw new DomainError(
        'OFFER_ALREADY_PROCESSED',
        'Outra proposta deste anúncio está sendo processada. Aguarde alguns segundos e tente novamente.'
      );
    }

    if (listing.character.isMythic || (listing.character as any).baseRarity === 'MYTHIC') {
      await this.prisma.marketListing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.CANCELLED },
      });
      await this.prisma.marketOffer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: 'Personagens Míticos não podem ser negociados nos classificados.',
        },
      });
      throw new DomainError('CANNOT_TRADE_MYTHIC', 'Personagens Míticos pertencem exclusivamente ao seu criador e não podem ser negociados nos classificados.');
    }

    // 1. Valida se o Vendedor ainda possui o personagem anunciado
    const sellerHarem = await this.prisma.haremEntry.findFirst({
      where: { userId: sellerId, characterId: listing.characterId },
    });

    if (!sellerHarem) {
      await this.prisma.marketListing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.CANCELLED },
      });
      await this.prisma.marketOffer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: 'O vendedor não possui mais o personagem anunciado.',
        },
      });
      throw new DomainError('SELLER_LOST_WAIFU', 'Você não possui mais o personagem deste anúncio.');
    }

    // 2. Valida se o Comprador ainda possui as Waifus ofertadas
    const offered = (offer.offeredItems || {}) as any;
    const waifuIds: string[] = Array.isArray(offered.waifuIds) ? offered.waifuIds : [];
    let buyerEntries: any[] = [];

    if (waifuIds.length > 0) {
      buyerEntries = await this.prisma.haremEntry.findMany({
        where: { userId: offer.buyerId, characterId: { in: waifuIds } },
        include: { character: true },
      });

      if (buyerEntries.length !== waifuIds.length) {
        // Falta de itens no momento: cancela a oferta
        await this.prisma.marketOffer.update({
          where: { id: offer.id },
          data: {
            status: OfferStatus.CANCELLED,
            cancelReason: 'Falta de itens no momento: O proponente não possui mais as waifus ofertadas no harém.',
            notifiedBuyer: false,
            buyerNotifiedStatus: 'CANCELLED',
          },
        });
        return {
          success: false,
          cancelled: true,
          reason: 'Não foi possível aceitar a oferta: o usuário não possui mais os personagens oferecidos. A oferta foi cancelada automaticamente.',
        };
      }

      const hasMythic = buyerEntries.some((o) => o.character.isMythic || (o.character as any).baseRarity === 'MYTHIC');
      if (hasMythic) {
        await this.prisma.marketOffer.update({
          where: { id: offer.id },
          data: {
            status: OfferStatus.CANCELLED,
            cancelReason: 'Proposta contém personagens Míticos, que não podem ser negociados.',
            notifiedBuyer: false,
            buyerNotifiedStatus: 'CANCELLED',
          },
        });
        return {
          success: false,
          cancelled: true,
          reason: 'Não foi possível aceitar a oferta: personagens Míticos pertencem exclusivamente ao seu criador e não podem ser negociados nos classificados. A oferta foi cancelada automaticamente.',
        };
      }
    }

    // 2.1. Valida cotas diárias de casamento e trocas nos classificados
    const buyerCharRarity = (listing.character.baseRarity || 'COMMON') as Rarity;
    if (this.cooldownService) {
      // Valida se o comprador pode receber o personagem anunciado
      const buyerCheck = await this.cooldownService.canMarryDaily(offer.buyerId, buyerCharRarity, true);
      if (!buyerCheck.allowed) {
        await this.prisma.marketOffer.update({
          where: { id: offer.id },
          data: { status: OfferStatus.PENDING },
        });
        return {
          success: false,
          cancelled: false,
          reason: `Não foi possível aceitar a oferta: ${buyerCheck.reason || 'O proponente atingiu o limite diário de casamentos/trocas.'}`,
        };
      }

      // Valida se o vendedor pode receber os personagens ofertados
      if (buyerEntries.length > 0) {
        const legCount = buyerEntries.filter((e) => (e.character.baseRarity || 'COMMON') === 'LEGENDARY').length;
        if (legCount > 0) {
          const currentTradeUsed = await this.cooldownService.getDailyTradeCount(sellerId, Rarity.LEGENDARY);
          if (currentTradeUsed + legCount > 10) {
            await this.prisma.marketOffer.update({
              where: { id: offer.id },
              data: { status: OfferStatus.PENDING },
            });
            return {
              success: false,
              cancelled: false,
              reason: `Não foi possível aceitar a oferta: Você atingirá o limite de 10 Lendárias recebidas em trocas hoje (${currentTradeUsed}/${10}).`,
            };
          }
        }

        for (const entry of buyerEntries) {
          const wRarity = (entry.character.baseRarity || 'COMMON') as Rarity;
          if (wRarity !== 'LEGENDARY') {
            const sellerCheck = await this.cooldownService.canMarryDaily(sellerId, wRarity, true);
            if (!sellerCheck.allowed) {
              await this.prisma.marketOffer.update({
                where: { id: offer.id },
                data: { status: OfferStatus.PENDING },
              });
              return {
                success: false,
                cancelled: false,
                reason: `Não foi possível aceitar a oferta: Você atingiu seu limite diário para personagens ${wRarity}.`,
              };
            }
          }
        }
      }
    }

    // 3. Valida se o Comprador ainda possui os Zinthos ofertados
    const offeredZinthos = Number(offered.zinthos) || 0;
    if (offeredZinthos > 0) {
      const buyer = await this.prisma.user.findUnique({
        where: { id: offer.buyerId },
        select: { kakera: true },
      });
      if (!buyer || buyer.kakera < offeredZinthos) {
        await this.prisma.marketOffer.update({
          where: { id: offer.id },
          data: {
            status: OfferStatus.CANCELLED,
            cancelReason: `Falta de itens no momento: O proponente não possui mais os Zinthos ofertados (${buyer?.kakera || 0}/${offeredZinthos}).`,
            notifiedBuyer: false,
            buyerNotifiedStatus: 'CANCELLED',
          },
        });
        return {
          success: false,
          cancelled: true,
          reason: 'Não foi possível aceitar a oferta: o usuário não possui mais o saldo de Zinthos ofertado. A oferta foi cancelada automaticamente.',
        };
      }
    }

    // 4. Valida e transfere itens externos (Runas, Buffs, Fazenda e Petalitas) via Ravena
    const offeredRunas = Number(offered.runas) || 0;
    const offeredPetalitas = Number(offered.petalitas) || 0;
    const fishes = Array.isArray(offered.fishes) ? offered.fishes : [];
    const buffs = Array.isArray(offered.fishingBuffs) ? offered.fishingBuffs : [];
    const fishingBuffIds = Array.isArray(offered.fishingBuffIds) ? offered.fishingBuffIds : buffs.map((b: any) => b.id);
    const farmItems = Array.isArray(offered.farmItems) ? offered.farmItems : [];

    const hasExternalItems = offeredRunas > 0 || offeredPetalitas > 0 || fishes.length > 0 || buffs.length > 0 || fishingBuffIds.length > 0 || farmItems.length > 0;
    if (hasExternalItems) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const transferRes = await fetch(`${config.RAVENA_API_URL}/api/market/transfer`, {
          method: 'POST',
          headers: ravenaMarketHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            fromUserId: offer.buyerId,
            toUserId: sellerId,
            runas: offeredRunas,
            petalitas: offeredPetalitas,
            fishes,
            buffs,
            fishingBuffIds,
            farmItems,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const transferData = (await transferRes.json().catch(() => ({}))) as any;

        if (!transferRes.ok || !transferData || !transferData.success) {
          const reasonMsg = transferData?.reason || `Falha na transferência externa (HTTP ${transferRes.status})`;
          await this.prisma.marketOffer.update({
            where: { id: offer.id },
            data: {
              status: OfferStatus.CANCELLED,
              cancelReason: `Falta de itens no momento: ${reasonMsg}`,
              notifiedBuyer: false,
              buyerNotifiedStatus: 'CANCELLED',
            },
          });
          return {
            success: false,
            cancelled: true,
            reason: `Não foi possível aceitar a oferta: ${reasonMsg}. A oferta foi cancelada automaticamente.`,
          };
        }
      } catch (err: any) {
        const errMsg = err?.message || 'Falha na validação externa';
        await this.prisma.marketOffer.update({
          where: { id: offer.id },
          data: {
            status: OfferStatus.CANCELLED,
            cancelReason: `Falta de itens no momento: ${errMsg}`,
            notifiedBuyer: false,
            buyerNotifiedStatus: 'CANCELLED',
          },
        });
        return {
          success: false,
          cancelled: true,
          reason: `Não foi possível aceitar a oferta: ${errMsg}. A oferta foi cancelada automaticamente.`,
        };
      }
    }

    // 5. Executa a transferência de Waifus e Zinthos atomicamente no PostgreSQL com reversão por compensação
    try {
      await this.prisma.$transaction(async (tx) => {
        // Reivindica o anúncio atomicamente: só uma transação consegue mover ACTIVE -> COMPLETED.
        // Aceites concorrentes (outra oferta do mesmo anúncio) falham aqui e caem na compensação.
        const claimedListing = await tx.marketListing.updateMany({
          where: { id: listing.id, status: ListingStatus.ACTIVE },
          data: { status: ListingStatus.COMPLETED },
        });
        if (claimedListing.count !== 1) {
          throw new DomainError('LISTING_NOT_ACTIVE', 'O anúncio foi concluído ou cancelado durante o processamento.');
        }

        // Passa a waifu anunciada do vendedor para o comprador (remove da coleção do antigo dono e reseta favorito).
        // Condicionado ao dono atual: se o vendedor perdeu o personagem no meio do caminho, aborta.
        const movedListed = await tx.haremEntry.updateMany({
          where: { characterId: listing.characterId, userId: sellerId },
          data: {
            userId: offer.buyerId,
            collectionId: null,
            isFavorite: false,
          },
        });
        if (movedListed.count !== 1) {
          throw new DomainError('SELLER_LOST_WAIFU', 'O vendedor não possui mais o personagem anunciado.');
        }

        // Se o comprador tiver cobiçado este personagem anunciado, remove o covet dele
        await tx.characterCovet.deleteMany({
          where: { characterId: listing.characterId, userId: offer.buyerId },
        });

        // Atualiza os covets restantes desse personagem para o novo dono
        await tx.characterCovet.updateMany({
          where: { characterId: listing.characterId },
          data: { ownerId: offer.buyerId },
        });

        // Passa as waifus ofertadas do comprador para o vendedor (remove da coleção do comprador e reseta favorito)
        for (const wId of waifuIds) {
          const movedOffered = await tx.haremEntry.updateMany({
            where: { characterId: wId, userId: offer.buyerId },
            data: {
              userId: sellerId,
              collectionId: null,
              isFavorite: false,
            },
          });
          if (movedOffered.count !== 1) {
            throw new DomainError('BUYER_LOST_WAIFU', 'O proponente não possui mais uma das waifus ofertadas.');
          }

          // Atualiza covets das waifus ofertadas para o novo dono
          await tx.characterCovet.deleteMany({
            where: { characterId: wId, userId: sellerId },
          });
          await tx.characterCovet.updateMany({
            where: { characterId: wId },
            data: { ownerId: sellerId },
          });
        }

        // Transfere Zinthos (se houver)
        if (offeredZinthos > 0) {
          const debited = await tx.user.updateMany({
            where: { id: offer.buyerId, kakera: { gte: offeredZinthos } },
            data: { kakera: { decrement: offeredZinthos } },
          });
          if (debited.count !== 1) {
            throw new DomainError('INSUFFICIENT_FUNDS', 'O proponente não possui mais os Zinthos ofertados.');
          }
          await tx.user.update({
            where: { id: sellerId },
            data: { kakera: { increment: offeredZinthos } },
          });
          await tx.kakeraTransaction.createMany({
            data: [
              {
                userId: offer.buyerId,
                amount: -offeredZinthos,
                reason: KakeraReason.MARKET_TRADE,
                metadata: { type: 'market_offer_paid', listingId: listing.id, sellerId },
              },
              {
                userId: sellerId,
                amount: offeredZinthos,
                reason: KakeraReason.MARKET_TRADE,
                metadata: { type: 'market_offer_received', listingId: listing.id, buyerId: offer.buyerId },
              },
            ],
          });
        }

        // Marca a oferta como ACEITA (só se continuar em PROCESSING: um cancelamento concorrente vence)
        const acceptedOffer = await tx.marketOffer.updateMany({
          where: { id: offer.id, status: OfferStatus.PROCESSING },
          data: {
            status: OfferStatus.ACCEPTED,
            notifiedBuyer: false,
            buyerNotifiedStatus: 'ACCEPTED',
          },
        });
        if (acceptedOffer.count !== 1) {
          throw new DomainError('INVALID_STATUS', 'A proposta foi cancelada durante o processamento.');
        }

        // Cancela outros anúncios ativos desse mesmo personagem (caso existam)
        const sameCharListings = await tx.marketListing.findMany({
          where: { characterId: listing.characterId, id: { not: listing.id }, status: ListingStatus.ACTIVE },
          select: { id: true },
        });
        if (sameCharListings.length > 0) {
          const sameCharIds = sameCharListings.map((l) => l.id);
          await tx.marketListing.updateMany({
            where: { id: { in: sameCharIds } },
            data: { status: ListingStatus.CANCELLED },
          });
          await tx.marketOffer.updateMany({
            where: { listingId: { in: sameCharIds }, status: OfferStatus.PENDING },
            data: {
              status: OfferStatus.CANCELLED,
              cancelReason: 'O personagem anunciado foi trocado em outra negociação.',
              notifiedBuyer: false,
              buyerNotifiedStatus: 'CANCELLED',
            },
          });
        }

        // Se o comprador ofertou waifus, cancela anúncios ativos delas também
        if (waifuIds.length > 0) {
          const offeredListings = await tx.marketListing.findMany({
            where: { characterId: { in: waifuIds }, status: ListingStatus.ACTIVE },
            select: { id: true },
          });
          if (offeredListings.length > 0) {
            const offeredListingIds = offeredListings.map((l) => l.id);
            await tx.marketListing.updateMany({
              where: { id: { in: offeredListingIds } },
              data: { status: ListingStatus.CANCELLED },
            });
            // Sem isso, as propostas desses anúncios ficariam PENDING para sempre em anúncios mortos
            await tx.marketOffer.updateMany({
              where: { listingId: { in: offeredListingIds }, status: OfferStatus.PENDING },
              data: {
                status: OfferStatus.CANCELLED,
                cancelReason: 'O personagem anunciado foi trocado em outra negociação.',
                notifiedBuyer: false,
                buyerNotifiedStatus: 'CANCELLED',
              },
            });
          }
        }

        // Cancela outras ofertas pendentes no mesmo anúncio
        await tx.marketOffer.updateMany({
          where: {
            listingId: listing.id,
            id: { not: offer.id },
            status: OfferStatus.PENDING,
          },
          data: {
            status: OfferStatus.CANCELLED,
            cancelReason: 'Outra oferta foi aceita pelo vendedor.',
            notifiedBuyer: false,
            buyerNotifiedStatus: 'CANCELLED',
          },
        });
      });
    } catch (pgTxErr: any) {
      console.error('[Market Transaction] Erro na transação PostgreSQL, iniciando compensação externa:', pgTxErr);

      // Compensating Transaction: Devolve itens externos do vendedor de volta para o comprador
      let compensationOk = !hasExternalItems;
      if (hasExternalItems) {
        try {
          const compController = new AbortController();
          const compTimeout = setTimeout(() => compController.abort(), 12000);
          const rollbackRes = await fetch(`${config.RAVENA_API_URL}/api/market/transfer`, {
            method: 'POST',
            headers: ravenaMarketHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              fromUserId: sellerId,
              toUserId: offer.buyerId,
              runas: offeredRunas,
              petalitas: offeredPetalitas,
              fishes,
              buffs,
              fishingBuffIds,
              farmItems,
            }),
            signal: compController.signal,
          });
          clearTimeout(compTimeout);
          const rollbackData = (await rollbackRes.json().catch(() => ({}))) as any;
          if (rollbackRes.ok && rollbackData?.success) {
            compensationOk = true;
            console.log(`[Market Compensation] Sucesso ao devolver itens externos para o comprador ${offer.buyerId}`);
          } else {
            console.error(`[Market Compensation] CRÍTICO: Falha ao devolver itens externos para ${offer.buyerId}:`, rollbackData);
          }
        } catch (compErr: any) {
          console.error(`[Market Compensation] CRÍTICO: Exceção ao executar compensação externa para ${offer.buyerId}:`, compErr?.message);
        }
      }

      const isDomain = pgTxErr instanceof DomainError;
      const baseReason = (
        isDomain ? pgTxErr.message : `Erro no processamento interno da troca: ${pgTxErr?.message || 'Falha no banco'}`
      ).replace(/[.\s]+$/, '');
      const refundNote = !hasExternalItems
        ? ''
        : compensationOk
        ? ' Itens externos foram estornados.'
        : ' ATENÇÃO: o estorno automático dos itens externos falhou e precisa de conferência manual da administração.';

      await this.prisma.marketOffer.updateMany({
        where: { id: offer.id, status: OfferStatus.PROCESSING },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: `${baseReason}.${refundNote}`,
          notifiedBuyer: false,
          buyerNotifiedStatus: 'CANCELLED',
        },
      });

      if (hasExternalItems && !compensationOk) {
        this.notificationService
          .notifyMarketEvent(
            offer.buyerId,
            'SYSTEM',
            '⚠️ Troca não concluída: estorno pendente',
            'A troca não pôde ser concluída e a devolução automática dos seus itens externos (runas, buffs ou itens da fazenda) falhou. A administração foi avisada para conferir manualmente.',
            { listingId: listing.id, offerId: offer.id, needsReconciliation: true }
          )
          .catch(() => {});
      }

      return {
        success: false,
        cancelled: true,
        reason: `Não foi possível concluir a negociação: ${baseReason}.${
          !hasExternalItems ? '' : compensationOk ? ' Os itens externos ofertados foram estornados.' : ' O estorno automático dos itens externos falhou e será conferido manualmente.'
        }`,
      };
    }

    // 6. Atualiza cotas diárias de casamento e troca nos classificados
    if (this.cooldownService) {
      if (buyerCharRarity === 'LEGENDARY') {
        await this.cooldownService.incrementDailyTrade(offer.buyerId, Rarity.LEGENDARY, 1);
      } else {
        await this.cooldownService.incrementDailyMarry(offer.buyerId, buyerCharRarity, 0.5);
      }

      if (buyerEntries.length > 0) {
        for (const entry of buyerEntries) {
          const wRarity = (entry.character.baseRarity || 'COMMON') as Rarity;
          if (wRarity === 'LEGENDARY') {
            await this.cooldownService.incrementDailyTrade(sellerId, Rarity.LEGENDARY, 1);
          } else {
            await this.cooldownService.incrementDailyMarry(sellerId, wRarity, 0.5);
          }
        }
      }
    }

    this.notificationService
      .notifyMarketEvent(
        offer.buyerId,
        'MARKET_OFFER_ACCEPTED',
        `🤝 Proposta aceita por ${listing.character.name}!`,
        'Parabéns! Sua proposta foi aceita pelo vendedor e a negociação foi concluída com sucesso.',
        {
          listingId: listing.id,
          characterId: listing.characterId,
          characterName: listing.character.name,
          offerId: offer.id,
          actorPublicId: listing.user?.publicId || null,
          actorName: listing.user?.name || 'Vendedor',
        }
      )
      .catch(() => {});

    return {
      success: true,
      cancelled: false,
      message: 'Oferta aceita com sucesso! Os personagens e itens foram trocados.',
    };
  }

  /**
   * Busca e consome a notificação passiva para a 2ª linha do !mu-roll
   */
  async getPendingRollNotification(userId: string): Promise<string | null> {
    // 1. Prioridade: avisos para o comprador sobre suas ofertas resolvidas
    const buyerOffer = await this.prisma.marketOffer.findFirst({
      where: {
        buyerId: userId,
        notifiedBuyer: false,
        buyerNotifiedStatus: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (buyerOffer) {
      await this.prisma.marketOffer.update({
        where: { id: buyerOffer.id },
        data: { notifiedBuyer: true },
      });

      if (buyerOffer.buyerNotifiedStatus === 'ACCEPTED') {
        return '🤩 Uma oferta sua foi aceita nos classificados!';
      }
      if (buyerOffer.buyerNotifiedStatus === 'REJECTED') {
        return '👎 Uma oferta sua foi negada nos classificados.';
      }
      if (buyerOffer.buyerNotifiedStatus === 'CANCELLED') {
        return '⚠️ Uma oferta sua foi cancelada nos classificados por falta de itens!';
      }
    }

    // 2. Avisos para o vendedor sobre ofertas pendentes em seus anúncios ativos
    const pendingOfferForSeller = await this.prisma.marketOffer.findFirst({
      where: {
        sellerId: userId,
        status: OfferStatus.PENDING,
        listing: { status: ListingStatus.ACTIVE },
        notifiedSeller: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingOfferForSeller) {
      await this.prisma.marketOffer.update({
        where: { id: pendingOfferForSeller.id },
        data: { notifiedSeller: true },
      });
      return '🫰 Tem ofertas pendentes nos seus classificados! Veja no !mu-adm';
    }

    // 3. Avisos para o dono se alguém cobiçou personagem do seu harém
    const pendingCovet = await this.prisma.characterCovet.findFirst({
      where: {
        ownerId: userId,
        notifiedOwner: false,
      },
    });

    if (pendingCovet) {
      await this.prisma.characterCovet.updateMany({
        where: {
          ownerId: userId,
          notifiedOwner: false,
        },
        data: { notifiedOwner: true },
      });
      return '👀 Alguém está cobiçando um personagem do seu harém! Acesse !mu-adm';
    }

    // 4. Avisos para o usuário se um personagem da sua wishlist ou cobiçado foi anunciado nos classificados
    const pendingListingNotif = await this.prisma.marketListingNotification.findFirst({
      where: {
        userId,
        notified: false,
      },
    });

    if (pendingListingNotif) {
      await this.prisma.marketListingNotification.updateMany({
        where: {
          userId,
          notified: false,
        },
        data: { notified: true },
      });
      return '📢 Um personagem da sua Wishlist ou cobiçado foi anunciado nos classificados! Veja no !mu-adm';
    }

    return null;
  }

  /**
   * Listagem administrativa de todas as transações/negociações dos Classificados
   */
  async listAdminTrades(options: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;
    const search = options.search?.trim();

    const where: any = {
      OR: [
        { status: OfferStatus.ACCEPTED },
        { cancelReason: { contains: 'Revertida' } },
      ],
    };

    if (search) {
      where.AND = [
        {
          OR: [
            { listing: { character: { name: { contains: search, mode: 'insensitive' } } } },
            { listing: { character: { series: { contains: search, mode: 'insensitive' } } } },
            { listing: { character: { id: { contains: search, mode: 'insensitive' } } } },
            { seller: { name: { contains: search, mode: 'insensitive' } } },
            { seller: { id: { contains: search } } },
            { buyer: { name: { contains: search, mode: 'insensitive' } } },
            { buyer: { id: { contains: search } } },
          ],
        },
      ];
    }

    const [total, offers] = await Promise.all([
      this.prisma.marketOffer.count({ where }),
      this.prisma.marketOffer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          listing: {
            include: {
              character: true,
            },
          },
          seller: {
            select: { id: true, name: true, publicId: true, platform: true },
          },
          buyer: {
            select: { id: true, name: true, publicId: true, platform: true },
          },
        },
      }),
    ]);

    const allOfferedWaifuIds = Array.from(
      new Set(
        offers.flatMap((o) => {
          const offered = (o.offeredItems || {}) as any;
          return Array.isArray(offered.waifuIds) ? offered.waifuIds : [];
        })
      )
    );

    const waifuMap = new Map<string, any>();
    if (allOfferedWaifuIds.length > 0) {
      const waifus = await this.prisma.character.findMany({
        where: { id: { in: allOfferedWaifuIds } },
      });
      for (const w of waifus) {
        waifuMap.set(w.id, this.formatCharacter(w));
      }
    }

    const formattedTrades = offers.map((offer) => {
      const offered = (offer.offeredItems || {}) as any;
      const waifuIds: string[] = Array.isArray(offered.waifuIds) ? offered.waifuIds : [];
      const offeredWaifus = waifuIds.map((id) => waifuMap.get(id) || { id, name: id });

      return {
        id: offer.id,
        listingId: offer.listingId,
        status: offer.status,
        cancelReason: offer.cancelReason,
        isReverted: offer.status === OfferStatus.CANCELLED && Boolean(offer.cancelReason?.includes('Revertida')),
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
        seller: offer.seller,
        buyer: offer.buyer,
        character: this.formatCharacter(offer.listing.character),
        listingInterest: offer.listing.interest,
        offeredItems: {
          ...offered,
          offeredWaifus,
        },
      };
    });

    return {
      trades: formattedTrades,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Reverte manualmente uma oferta aceita nos classificados (Painel Administrativo)
   */
  async revertOffer(offerId: string) {
    const offer = await this.prisma.marketOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: { include: { character: true, user: { select: { id: true, name: true, publicId: true } } } },
        buyer: true,
        seller: true,
      },
    });

    if (!offer) {
      throw new DomainError('NOT_FOUND', 'Oferta de negociação não encontrada.');
    }

    if (offer.status !== OfferStatus.ACCEPTED) {
      if (offer.cancelReason?.includes('Revertida')) {
        throw new DomainError('ALREADY_REVERTED', 'Esta negociação já foi revertida anteriormente.');
      }
      throw new DomainError('INVALID_STATUS', 'Apenas negociações com status CONCLUÍDA (Aceitas) podem ser revertidas.');
    }

    const listing = offer.listing;
    const charId = listing.characterId;

    // 1. Valida se o Comprador ainda possui o personagem anunciado no harém
    const buyerHarem = await this.prisma.haremEntry.findFirst({
      where: { characterId: charId },
    });

    if (!buyerHarem || buyerHarem.userId !== offer.buyerId) {
      throw new DomainError(
        'INVALID_STATE',
        `Não é possível reverter: o comprador (${offer.buyer.name}) já não possui mais o personagem ${listing.character.name} no harém (já trocou ou divorciou).`
      );
    }

    // 2. Valida se o Vendedor ainda possui as Waifus ofertadas
    const offered = (offer.offeredItems || {}) as any;
    const waifuIds: string[] = Array.isArray(offered.waifuIds) ? offered.waifuIds : [];

    if (waifuIds.length > 0) {
      const sellerEntries = await this.prisma.haremEntry.findMany({
        where: { characterId: { in: waifuIds } },
      });
      const missingWaifus = waifuIds.filter((id) => !sellerEntries.some((e) => e.characterId === id && e.userId === offer.sellerId));
      if (missingWaifus.length > 0) {
        throw new DomainError(
          'INVALID_STATE',
          `Não é possível reverter: o vendedor (${offer.seller.name}) já não possui mais todos os personagens recebidos na troca (${missingWaifus.join(', ')}).`
        );
      }
    }

    // 3. Valida se o Vendedor possui saldo suficiente de Zinthos para devolução
    const offeredZinthos = Number(offered.zinthos) || 0;
    if (offeredZinthos > 0) {
      const seller = await this.prisma.user.findUnique({
        where: { id: offer.sellerId },
        select: { kakera: true },
      });
      if (!seller || seller.kakera < offeredZinthos) {
        throw new DomainError(
          'INSUFFICIENT_FUNDS',
          `Não é possível reverter: o vendedor (${offer.seller.name}) possui apenas ${seller?.kakera || 0} Zinthos, mas precisa devolver ${offeredZinthos} Zinthos.`
        );
      }
    }

    // 4. Se houver itens externos (Pesca e Fazenda), transfere de volta via Ravena
    const fishes = Array.isArray(offered.fishes) ? offered.fishes : [];
    const buffs = Array.isArray(offered.fishingBuffs) ? offered.fishingBuffs : [];
    const farmItems = Array.isArray(offered.farmItems) ? offered.farmItems : [];

    const hasExternalItems = fishes.length > 0 || buffs.length > 0 || farmItems.length > 0;
    if (hasExternalItems) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const transferRes = await fetch(`${config.RAVENA_API_URL}/api/market/transfer`, {
          method: 'POST',
          headers: ravenaMarketHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            fromUserId: offer.sellerId,
            toUserId: offer.buyerId,
            fishes,
            buffs,
            farmItems,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const transferData = (await transferRes.json().catch(() => ({}))) as any;
        if (!transferRes.ok || !transferData || !transferData.success) {
          const reasonMsg = transferData?.reason || `Falha na transferência inversa (HTTP ${transferRes.status})`;
          throw new DomainError('EXTERNAL_TRANSFER_FAILED', `Falha ao devolver itens externos na Ravena: ${reasonMsg}`);
        }
      } catch (err: any) {
        if (err instanceof DomainError) throw err;
        throw new DomainError('EXTERNAL_TRANSFER_FAILED', `Falha na devolução de itens na Ravena: ${err?.message || 'Erro de conexão'}`);
      }
    }

    // 5. Executa a reversão atômica no banco de dados
    await this.prisma.$transaction(async (tx) => {
      // Devolve o personagem anunciado para o vendedor original
      await tx.haremEntry.update({
        where: { characterId: charId },
        data: {
          userId: offer.sellerId,
          collectionId: null,
          isFavorite: false,
        },
      });

      await tx.characterCovet.updateMany({
        where: { characterId: charId },
        data: { ownerId: offer.sellerId },
      });

      // Devolve as waifus ofertadas para o comprador
      for (const wId of waifuIds) {
        await tx.haremEntry.update({
          where: { characterId: wId },
          data: {
            userId: offer.buyerId,
            collectionId: null,
            isFavorite: false,
          },
        });

        await tx.characterCovet.updateMany({
          where: { characterId: wId },
          data: { ownerId: offer.buyerId },
        });
      }

      // Estorna Zinthos
      if (offeredZinthos > 0) {
        await tx.user.update({
          where: { id: offer.sellerId },
          data: { kakera: { decrement: offeredZinthos } },
        });
        await tx.user.update({
          where: { id: offer.buyerId },
          data: { kakera: { increment: offeredZinthos } },
        });
        await tx.kakeraTransaction.createMany({
          data: [
            {
              userId: offer.sellerId,
              amount: -offeredZinthos,
              reason: KakeraReason.MARKET_TRADE,
              metadata: { type: 'market_offer_reverted_admin', listingId: listing.id, offerId: offer.id, buyerId: offer.buyerId },
            },
            {
              userId: offer.buyerId,
              amount: offeredZinthos,
              reason: KakeraReason.MARKET_TRADE,
              metadata: { type: 'market_offer_reverted_admin', listingId: listing.id, offerId: offer.id, sellerId: offer.sellerId },
            },
          ],
        });
      }

      // Atualiza status da oferta para CANCELLED com motivo explícito
      await tx.marketOffer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.CANCELLED,
          cancelReason: 'Revertida pelo administrador.',
          notifiedBuyer: false,
          buyerNotifiedStatus: 'CANCELLED',
        },
      });

      // Restaura o anúncio para ACTIVE
      await tx.marketListing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ACTIVE },
      });

      // Restaura ofertas pendentes que haviam sido canceladas automaticamente
      await tx.marketOffer.updateMany({
        where: {
          listingId: listing.id,
          cancelReason: 'Outra oferta foi aceita pelo vendedor.',
        },
        data: {
          status: OfferStatus.PENDING,
          cancelReason: null,
          notifiedBuyer: false,
          buyerNotifiedStatus: null,
        },
      });
    });

    // Notifica vendedor e comprador
    this.notificationService
      .notifyMarketEvent(
        offer.sellerId,
        'SYSTEM',
        `🔄 Negociação de ${listing.character.name} revertida`,
        `A negociação de ${listing.character.name} foi revertida pela administração. O personagem retornou ao seu harém.`,
        {
          listingId: listing.id,
          characterId: charId,
          characterName: listing.character.name,
          offerId: offer.id,
        }
      )
      .catch(() => {});

    this.notificationService
      .notifyMarketEvent(
        offer.buyerId,
        'SYSTEM',
        `🔄 Negociação de ${listing.character.name} revertida`,
        `A negociação de ${listing.character.name} foi revertida pela administração. Seus itens e Zinthos retornaram ao seu saldo.`,
        {
          listingId: listing.id,
          characterId: charId,
          characterName: listing.character.name,
          offerId: offer.id,
        }
      )
      .catch(() => {});

    return {
      success: true,
      message: `Negociação revertida com sucesso! ${listing.character.name} retornou ao harém de ${offer.seller.name}.`,
    };
  }
}
