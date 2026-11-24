import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuggestionService } from '../src/services/SuggestionService.js';

describe('🤖 Auto-Aprovação de Sugestões com Consenso da IA (SuggestionService)', () => {
  let suggestionService: SuggestionService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockTelegramService: any;
  let mockNotificationService: any;
  let mockCharacterService: any;
  let mockRarityAdvisorService: any;

  beforeEach(() => {
    mockPrisma = {
      characterSuggestion: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      character: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
      haremEntry: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      marriageHistory: {
        findFirst: vi.fn(),
      },
      wishlistEntry: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
      },
      soulmateRecord: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      kakeraTransaction: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      mget: vi.fn().mockResolvedValue([]),
    };

    mockTelegramService = {
      notifySuggestion: vi.fn().mockResolvedValue(undefined),
    };

    mockNotificationService = {
      notifyCharacterModification: vi.fn().mockResolvedValue(undefined),
      notifySuggestionReview: vi.fn().mockResolvedValue(undefined),
    };

    mockCharacterService = {
      findCharacter: vi.fn(),
      getRandomImageUrl: vi.fn().mockReturnValue('https://example.com/img.jpg'),
      updateCharacterScore: vi.fn().mockResolvedValue(undefined),
    };

    mockRarityAdvisorService = {
      evaluateRaritySuggestionDetailed: vi.fn(),
    };

    suggestionService = new SuggestionService(
      mockPrisma,
      mockRedis,
      mockCharacterService
    );

    (suggestionService as any).telegramService = mockTelegramService;
    (suggestionService as any).notificationService = mockNotificationService;
    (suggestionService as any).rarityAdvisorService = mockRarityAdvisorService;
  });

  it('deve auto-aprovar sugestão de raridade quando o parecer da IA concorda com o usuário', async () => {
    mockPrisma.characterSuggestion.findUnique.mockResolvedValue({
      id: 'sug_auto_1',
      characterId: 'char_rimuru',
      userId: 'user_1',
      type: 'RARITY',
      status: 'PENDING',
      currentRarity: 'RARE',
      suggestedRarity: 'EPIC',
      reason: 'Protagonista de uma franquia enorme',
      character: {
        id: 'char_rimuru',
        name: 'Rimuru Tempest',
        series: 'That Time I Got Reincarnated as a Slime',
        baseRarity: 'RARE',
      },
    });

    mockPrisma.marriageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.haremEntry.findUnique.mockResolvedValue(null);
    mockPrisma.character.update.mockResolvedValue({
      id: 'char_rimuru',
      name: 'Rimuru Tempest',
      baseRarity: 'EPIC',
    });
    mockPrisma.characterSuggestion.update.mockResolvedValue({
      id: 'sug_auto_1',
      status: 'APPROVED',
      reviewedBy: 'ia-auto-approval',
    });

    const evaluation = {
      response: '🤖 <b>Parecer da IA</b>: Aprovado!',
      structured: {
        verdict: 'PROCEDENTE',
        recommendedRarity: 'EPIC',
        agreesWithUser: true,
        justification: 'Franquia muito influente e personagem icônico.',
      },
    };

    const approved = await suggestionService.maybeAutoApproveSuggestion('sug_auto_1', evaluation);

    expect(approved).toBe(true);
    expect(mockPrisma.character.update).toHaveBeenCalledWith({
      where: { id: 'char_rimuru' },
      data: { baseRarity: 'EPIC' },
    });
    expect(mockPrisma.characterSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sug_auto_1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedBy: 'ia-auto-approval',
        }),
      })
    );
  });

  it('NÃO deve auto-aprovar quando o parecer da IA discordar da raridade sugerida', async () => {
    mockPrisma.characterSuggestion.findUnique.mockResolvedValue({
      id: 'sug_diverged_1',
      characterId: 'char_maple',
      userId: 'user_2',
      type: 'RARITY',
      status: 'PENDING',
      currentRarity: 'COMMON',
      suggestedRarity: 'LEGENDARY',
      character: {
        id: 'char_maple',
        name: 'Maple',
        baseRarity: 'COMMON',
      },
    });

    const evaluation = {
      response: '🤖 <b>Parecer da IA</b>: Exagero!',
      structured: {
        verdict: 'EXAGERO',
        recommendedRarity: 'RARE',
        agreesWithUser: false,
        justification: 'Obra de nicho médio, não é um topo histórico mundial.',
      },
    };

    const approved = await suggestionService.maybeAutoApproveSuggestion('sug_diverged_1', evaluation);

    expect(approved).toBe(false);
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
    expect(mockPrisma.characterSuggestion.update).not.toHaveBeenCalled();
  });

  it('NÃO deve auto-aprovar para LEGENDARY se o personagem já foi casado', async () => {
    mockPrisma.characterSuggestion.findUnique.mockResolvedValue({
      id: 'sug_married_legendary',
      characterId: 'char_married',
      userId: 'user_3',
      type: 'RARITY',
      status: 'PENDING',
      currentRarity: 'EPIC',
      suggestedRarity: 'LEGENDARY',
      character: {
        id: 'char_married',
        name: 'Personagem Casado',
        baseRarity: 'EPIC',
      },
    });

    // Simula que o personagem já foi casado
    mockPrisma.haremEntry.findFirst.mockResolvedValue({ id: 'harem_1' });

    const evaluation = {
      response: '🤖 <b>Parecer da IA</b>: Procedente!',
      structured: {
        verdict: 'PROCEDENTE',
        recommendedRarity: 'LEGENDARY',
        agreesWithUser: true,
        justification: 'Ícone histórico.',
      },
    };

    const approved = await suggestionService.maybeAutoApproveSuggestion('sug_married_legendary', evaluation);

    expect(approved).toBe(false);
    expect(mockPrisma.character.update).not.toHaveBeenCalled();
    expect(mockPrisma.characterSuggestion.update).not.toHaveBeenCalled();
  });
});
