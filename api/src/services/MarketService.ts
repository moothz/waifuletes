import { PrismaClient, ListingStatus, OfferStatus } from '@prisma/client';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

export interface CreateOfferData {
  message?: string;
  offeredItems: {
    waifuIds?: string[];
    fishes?: Array<{ id: number; name?: string; weight?: number; isRare?: boolean }>;
    fishingBuffs?: Array<{ id: number; originalName?: string; type?: string }>;
    farmItems?: Array<{ itemId: string; name?: string; amount: number }>;
    isFree?: boolean;
  };
}

export class MarketService {
  constructor(private prisma: PrismaClient) {}

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
      },
    });

    return listing;
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
      where.character = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { series: { contains: search, mode: 'insensitive' } },
        ],
      };
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
        LEGENDARY: 5,
        EPIC: 4,
        RARE: 3,
        UNCOMMON: 2,
        COMMON: 1,
      };
      sorted = [...listings].sort(
        (a, b) => (rarityRank[b.character.baseRarity] || 0) - (rarityRank[a.character.baseRarity] || 0)
      );
    }

    return {
      listings: sorted,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retorna os anúncios do próprio usuário com contagem de ofertas pendentes
   */
  async getUserListings(userId: string) {
    return await this.prisma.marketListing.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        character: true,
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
  }

  /**
   * Retorna todas as ofertas enviadas pelo usuário nos últimos 15 dias
   */
  async getUserSentOffers(buyerId: string) {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    return await this.prisma.marketOffer.findMany({
      where: {
        buyerId,
        createdAt: { gte: fifteenDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          include: {
            character: true,
            user: { select: { id: true, name: true, publicId: true } },
          },
        },
      },
    });
  }

  /**
   * Retorna as ofertas de um anúncio específico para o vendedor
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

    return await this.prisma.marketOffer.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: {
          select: { id: true, name: true, publicId: true },
        },
      },
    });
  }

  /**
   * Retorna todas as ofertas pendentes recebidas pelo vendedor (para WhatsApp !mu-ofertas)
   */
  async getUserReceivedOffers(sellerId: string) {
    return await this.prisma.marketOffer.findMany({
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
  }

  /**
   * Cria uma proposta de oferta para um anúncio
   */
  async createOffer(buyerId: string, listingId: string, data: CreateOfferData) {
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

    // Se ofertou waifus, valida se o comprador tem todas elas no harém
    const waifuIds = data.offeredItems?.waifuIds || [];
    if (waifuIds.length > 0) {
      const owned = await this.prisma.haremEntry.findMany({
        where: { userId: buyerId, characterId: { in: waifuIds } },
      });
      if (owned.length !== waifuIds.length) {
        throw new DomainError('MISSING_WAIFUS', 'Você não possui todos os personagens ofertados no seu harém.');
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

    return offer;
  }

  /**
   * Rejeita uma oferta recebida
   */
  async rejectOffer(sellerId: string, offerId: string) {
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

    return await this.prisma.marketOffer.update({
      where: { id: offerId },
      data: {
        status: OfferStatus.REJECTED,
        notifiedBuyer: false,
        buyerNotifiedStatus: 'REJECTED',
      },
    });
  }

  /**
   * Aceita uma oferta com validação em tempo real e transferência atômica multi-jogo
   */
  async acceptOffer(sellerId: string, offerId: string) {
    const offer = await this.prisma.marketOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: { include: { character: true } },
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

    const listing = offer.listing;
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new DomainError('LISTING_NOT_ACTIVE', 'O anúncio não está mais ativo.');
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

    if (waifuIds.length > 0) {
      const buyerEntries = await this.prisma.haremEntry.findMany({
        where: { userId: offer.buyerId, characterId: { in: waifuIds } },
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
    }

    // 3. Valida e transfere itens externos (Pesca e Fazenda) via Ravena
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromUserId: offer.buyerId,
            toUserId: sellerId,
            fishes,
            buffs,
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

    // 4. Executa a transferência de Waifus atomicamente no PostgreSQL
    await this.prisma.$transaction(async (tx) => {
      // Passa a waifu anunciada do vendedor para o comprador
      await tx.haremEntry.update({
        where: { characterId: listing.characterId },
        data: { userId: offer.buyerId },
      });

      // Passa as waifus ofertadas do comprador para o vendedor
      for (const wId of waifuIds) {
        await tx.haremEntry.update({
          where: { characterId: wId },
          data: { userId: sellerId },
        });
      }

      // Marca a oferta como ACEITA
      await tx.marketOffer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.ACCEPTED,
          notifiedBuyer: false,
          buyerNotifiedStatus: 'ACCEPTED',
        },
      });

      // Marca o anúncio como CONCLUÍDO
      await tx.marketListing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.COMPLETED },
      });

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

    return null;
  }
}
