import { describe, it, expect, vi } from 'vitest';
import { MarketService } from '../src/services/MarketService.js';
import { ListingStatus } from '@prisma/client';

describe('📢 Classificados: Valor de Divórcio e Idade do Anúncio', () => {
  describe('Formatação da idade do anúncio (formatListingAge)', () => {
    function formatListingAge(createdAt: any) {
      if (!createdAt) return null;
      const postDate = new Date(createdAt);
      if (isNaN(postDate.getTime())) return null;

      const now = new Date();
      const diffMs = Math.max(0, now.getTime() - postDate.getTime());
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const dateFormatted = postDate.toLocaleDateString('pt-BR');

      let daysText = '';
      if (diffDays <= 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        daysText = diffHours <= 0 ? 'hoje' : `hoje (há ${diffHours}h)`;
      } else if (diffDays === 1) {
        daysText = 'há 1 dia';
      } else {
        daysText = `há ${diffDays} dias`;
      }

      const timeFormatted = postDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      return {
        dateFormatted,
        timeFormatted,
        daysText,
        diffDays,
        html: `<div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px;" title="Postado em ${dateFormatted} às ${timeFormatted}"><i class="fas fa-clock"></i> Anunciado em <strong>${dateFormatted}</strong> • <strong>${daysText}</strong></div>`
      };
    }

    it('deve retornar null para data nula ou inválida', () => {
      expect(formatListingAge(null)).toBeNull();
      expect(formatListingAge(undefined)).toBeNull();
      expect(formatListingAge('data-invalida')).toBeNull();
    });

    it('deve formatar anúncios postados hoje', () => {
      const now = new Date();
      const res = formatListingAge(now);
      expect(res).not.toBeNull();
      expect(res?.diffDays).toBe(0);
      expect(res?.daysText).toContain('hoje');
      expect(res?.html).toContain('Anunciado em');
      expect(res?.html).toContain(res?.dateFormatted);
    });

    it('deve formatar anúncio postado há exatamente 1 dia', () => {
      const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 horas
      const res = formatListingAge(oneDayAgo);
      expect(res).not.toBeNull();
      expect(res?.diffDays).toBe(1);
      expect(res?.daysText).toBe('há 1 dia');
      expect(res?.html).toContain('há 1 dia');
    });

    it('deve formatar anúncio postado há múltiplos dias (ex: 7 dias)', () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const res = formatListingAge(sevenDaysAgo);
      expect(res).not.toBeNull();
      expect(res?.diffDays).toBe(7);
      expect(res?.daysText).toBe('há 7 dias');
      expect(res?.html).toContain('há 7 dias');
    });
  });

  describe('Formatação do valor mínimo de divórcio no input', () => {
    function formatDivorcePrefill(val: number) {
      return val > 0 ? `Valor mínimo: ${Number(val).toLocaleString('pt-BR')}z` : '';
    }

    it('deve gerar o texto "Valor mínimo: 123.456z" com pontuação pt-BR', () => {
      expect(formatDivorcePrefill(123456)).toBe('Valor mínimo: 123.456z');
      expect(formatDivorcePrefill(2100000)).toBe('Valor mínimo: 2.100.000z');
      expect(formatDivorcePrefill(750)).toBe('Valor mínimo: 750z');
    });

    it('não deve preencher se o valor de divórcio for zero ou negativo', () => {
      expect(formatDivorcePrefill(0)).toBe('');
      expect(formatDivorcePrefill(-500)).toBe('');
    });
  });

  describe('Preservação do campo createdAt na listagem de classificados', () => {
    it('deve retornar createdAt preservado em listGlobalListings', async () => {
      const listingDate = new Date('2026-11-20T12:00:00Z');
      const mockPrisma: any = {
        marketListing: {
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'listing_1',
              userId: 'u1',
              characterId: 'c1',
              interest: 'Valor mínimo: 123.456z',
              status: ListingStatus.ACTIVE,
              createdAt: listingDate,
              user: { id: 'u1', name: 'Player 1', publicId: 'pub1' },
              character: {
                id: 'c1',
                name: 'Asuna',
                series: 'SAO',
                baseRarity: 'EPIC',
                _count: { wishlists: 10 },
                haremEntries: [{ userId: 'u1', keys: 1, isFavorite: false }],
              },
            },
          ]),
        },
      };

      const service = new MarketService(mockPrisma);
      const res = await service.listGlobalListings({});
      expect(res.listings).toHaveLength(1);
      expect(res.listings[0].createdAt).toEqual(listingDate);
      expect(res.listings[0].interest).toBe('Valor mínimo: 123.456z');
    });
  });
});
