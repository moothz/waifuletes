import { describe, it, expect, vi } from 'vitest';
import { TelegramNotificationService } from '../src/services/TelegramNotificationService.js';
import { RarityAdvisorService } from '../src/services/RarityAdvisorService.js';

describe('📸 Ações de Foto (Adição vs Substituição) e Notificações no Telegram', () => {
  it('deve gerar botões de Aceitar Proposto, Nova Foto e Trocar Foto Atual para sugestão de imagem com ADD', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_token';
    (service as any).chatId = 'mock_chat';
    let sentPhotoPayload: any = null;

    (service as any).sendPhotoWithBuffer = async (buf: Buffer, caption: string, replyMarkup: any) => {
      sentPhotoPayload = { caption, replyMarkup };
      return { messageId: 101, chatId: 'test_chat' };
    };
    (service as any).sendMessage = async (text: string, replyMarkup: any) => {
      sentPhotoPayload = { caption: text, replyMarkup };
      return { messageId: 102, chatId: 'test_chat' };
    };

    await service.notifySuggestion({
      id: 'sug_img_add_1',
      type: 'IMAGE',
      characterId: 'char_1',
      photoAction: 'ADD',
      forceNotificationForTest: true,
      reason: 'Foto linda da personagem sorrindo',
      character: {
        id: 'char_1',
        name: 'Aqua',
        series: 'Konosuba',
        baseRarity: 'RARE',
      },
    });

    expect(sentPhotoPayload).not.toBeNull();
    expect(sentPhotoPayload.caption).toContain('Adicionar nova foto à galeria');

    const keyboard = sentPhotoPayload.replyMarkup.inline_keyboard;
    const flatButtons = keyboard.flat();

    // Deve conter botão aceitar proposto (Adicionar)
    const proposedBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app:sug_img_add_1');
    expect(proposedBtn).toBeDefined();
    expect(proposedBtn.text).toContain('Aceitar Proposto (Adicionar)');

    // Deve conter botão aceitar adicionando como foto nova
    const addBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app_img:sug_img_add_1:ADD');
    expect(addBtn).toBeDefined();
    expect(addBtn.text).toContain('Aceitar (Nova Foto)');

    // Deve conter botão aceitar trocando pela atual
    const replaceBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app_img:sug_img_add_1:REPLACE');
    expect(replaceBtn).toBeDefined();
    expect(replaceBtn.text).toContain('Aceitar (Trocar Atual)');

    // Deve conter rejeitar
    const rejBtn = flatButtons.find((b: any) => b.callback_data === 'sug_rej:sug_img_add_1');
    expect(rejBtn).toBeDefined();
  });

  it('deve gerar botões de Aceitar Proposto (Trocar), Nova Foto e Trocar Atual para sugestão de imagem com REPLACE', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_token';
    (service as any).chatId = 'mock_chat';
    let sentPhotoPayload: any = null;

    (service as any).sendPhotoWithBuffer = async (buf: Buffer, caption: string, replyMarkup: any) => {
      sentPhotoPayload = { caption, replyMarkup };
      return { messageId: 201, chatId: 'test_chat' };
    };
    (service as any).sendMessage = async (text: string, replyMarkup: any) => {
      sentPhotoPayload = { caption: text, replyMarkup };
      return { messageId: 202, chatId: 'test_chat' };
    };

    await service.notifySuggestion({
      id: 'sug_img_rep_1',
      type: 'IMAGE',
      characterId: 'char_2',
      photoAction: 'REPLACE',
      targetPhoto: 'old_photo.jpg',
      forceNotificationForTest: true,
      reason: 'A foto atual está de baixa qualidade',
      character: {
        id: 'char_2',
        name: 'Megumin',
        series: 'Konosuba',
        baseRarity: 'EPIC',
      },
    });

    expect(sentPhotoPayload).not.toBeNull();
    expect(sentPhotoPayload.caption).toContain('Substituir foto atual pela nova foto enviada');
    expect(sentPhotoPayload.caption).toContain('old_photo.jpg');

    const keyboard = sentPhotoPayload.replyMarkup.inline_keyboard;
    const flatButtons = keyboard.flat();

    const proposedBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app:sug_img_rep_1');
    expect(proposedBtn).toBeDefined();
    expect(proposedBtn.text).toContain('Aceitar Proposto (Trocar)');

    const addBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app_img:sug_img_rep_1:ADD');
    expect(addBtn).toBeDefined();

    const replaceBtn = flatButtons.find((b: any) => b.callback_data === 'sug_app_img:sug_img_rep_1:REPLACE');
    expect(replaceBtn).toBeDefined();
  });

  it('handleCallback deve despachar aprovação com overridePhotoAction ADD ao clicar no botão de Nova Foto', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_bot_token';

    let capturedApproveArgs: any = null;
    let answeredText: string | null = null;
    let messageUpdatedText: string | null = null;

    const mockSuggestionService = {
      approveSuggestion: async (id: string, reviewedBy: string, overrideRarity?: string, overridePhotoAction?: string) => {
        capturedApproveArgs = { id, reviewedBy, overrideRarity, overridePhotoAction };
        return { success: true };
      },
    };

    (service as any).answerCallback = async (id: string, text: string) => {
      answeredText = text;
    };
    (service as any).updateTelegramMessage = async (chatId: any, messageId: any, message: any, appendText: string) => {
      messageUpdatedText = appendText;
    };

    const callbackQuery = {
      id: 'cb_query_1',
      data: 'sug_app_img:sug_abc_123:ADD',
      from: { first_name: 'Mod', username: 'admin_waifu' },
      message: { chat: { id: 777 }, message_id: 888 },
    };

    await service.handleCallback(callbackQuery, mockSuggestionService);

    expect(capturedApproveArgs).toEqual({
      id: 'sug_abc_123',
      reviewedBy: 'telegram:Mod (@admin_waifu)',
      overrideRarity: undefined,
      overridePhotoAction: 'ADD',
    });
    expect(answeredText).toContain('Nova foto adicionada à galeria');
    expect(messageUpdatedText).toContain('ADICIONADA COMO NOVA FOTO');
  });

  it('handleCallback deve despachar aprovação com overridePhotoAction REPLACE ao clicar no botão de Trocar Foto', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_bot_token';

    let capturedApproveArgs: any = null;
    let answeredText: string | null = null;

    const mockSuggestionService = {
      approveSuggestion: async (id: string, reviewedBy: string, overrideRarity?: string, overridePhotoAction?: string) => {
        capturedApproveArgs = { id, reviewedBy, overrideRarity, overridePhotoAction };
        return { success: true };
      },
    };

    (service as any).answerCallback = async (id: string, text: string) => {
      answeredText = text;
    };
    (service as any).updateTelegramMessage = async () => {};

    const callbackQuery = {
      id: 'cb_query_2',
      data: 'sug_app_img:sug_def_456:REPLACE',
      from: { first_name: 'Mod2' },
      message: { chat: { id: 777 }, message_id: 889 },
    };

    await service.handleCallback(callbackQuery, mockSuggestionService);

    expect(capturedApproveArgs).toEqual({
      id: 'sug_def_456',
      reviewedBy: 'telegram:Mod2',
      overrideRarity: undefined,
      overridePhotoAction: 'REPLACE',
    });
    expect(answeredText).toContain('Foto atual substituída');
  });

  it('deve enviar grupo de mídia (álbum) com ambas as fotos para comparação quando photoAction for REPLACE', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_token';
    (service as any).chatId = 'mock_chat';

    const currBuffer = Buffer.from('current_photo_bytes');
    const newBuffer = Buffer.from('new_photo_bytes');

    (service as any).resolveImageBuffer = async (ref?: string | null) => {
      if (ref === 'old_photo.jpg' || ref === 'char_3') return currBuffer;
      if (ref === 'suggestions/new_photo.png') return newBuffer;
      return null;
    };

    let mediaGroupArgs: any = null;
    let sentTextMessage: any = null;

    (service as any).sendComparisonMediaGroup = async (cb: Buffer, nb: Buffer, cc: string, nc: string) => {
      mediaGroupArgs = { cb, nb, cc, nc };
      return { messageIds: [801, 802], chatId: 'mock_chat' };
    };

    (service as any).sendMessage = async (text: string, replyMarkup: any) => {
      sentTextMessage = { text, replyMarkup };
      return { messageId: 803, chatId: 'mock_chat' };
    };

    const mockRedis = {
      set: vi.fn(),
    };
    (service as any).redis = mockRedis;

    await service.notifySuggestion({
      id: 'sug_dual_1',
      type: 'IMAGE',
      characterId: 'char_3',
      photoAction: 'REPLACE',
      targetPhoto: 'old_photo.jpg',
      imageUrl: 'suggestions/new_photo.png',
      forceNotificationForTest: true,
      reason: 'Comparar fotos',
      character: {
        id: 'char_3',
        name: 'Rem',
        series: 'Re:Zero',
        baseRarity: 'LEGENDARY',
      },
    });

    // Deve ter chamado sendComparisonMediaGroup com as 2 fotos
    expect(mediaGroupArgs).not.toBeNull();
    expect(mediaGroupArgs.cb).toBe(currBuffer);
    expect(mediaGroupArgs.nb).toBe(newBuffer);
    expect(mediaGroupArgs.cc).toContain('Foto 1: Foto Atual');
    expect(mediaGroupArgs.nc).toContain('Foto 2: Nova Foto Sugerida');

    // Deve ter enviado a mensagem de texto com os botões inline logo após o álbum
    expect(sentTextMessage).not.toBeNull();
    expect(sentTextMessage.text).toContain('Substituir foto atual pela nova foto enviada');
    expect(sentTextMessage.replyMarkup.inline_keyboard.length).toBeGreaterThan(0);

    // Deve salvar albumMessageIds no Redis
    expect(mockRedis.set).toHaveBeenCalledWith(
      'telegram:suggestion:sug_dual_1:msg',
      expect.stringContaining('"albumMessageIds":[801,802]'),
      'EX',
      expect.any(Number)
    );
  });

  it('deve fazer fallback para sendMessage se envio de foto falhar', async () => {
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_token';
    (service as any).chatId = 'mock_chat';

    (service as any).resolveImageBuffer = async () => Buffer.from('dummy_photo');
    (service as any).sendPhotoWithBuffer = async () => null; // Simula falha da API Telegram

    let fallbackCalled = false;
    let fallbackText = '';
    (service as any).sendMessage = async (text: string) => {
      fallbackCalled = true;
      fallbackText = text;
      return { messageId: 999, chatId: 'mock_chat' };
    };

    await service.notifySuggestion({
      id: 'sug_fallback_1',
      type: 'IMAGE',
      characterId: 'char_4',
      photoAction: 'ADD',
      imageUrl: 'suggestions/dummy.png',
      forceNotificationForTest: true,
      character: {
        id: 'char_4',
        name: 'Emilia',
        series: 'Re:Zero',
        baseRarity: 'EPIC',
      },
    });

    expect(fallbackCalled).toBe(true);
    expect(fallbackText).toContain('Emilia');
  });
});

describe('🤖 Prompt de IA e Classificação por Rank Mudae no RarityAdvisorService', () => {
  it('deve incluir regras estritas de Rank Mudae no systemPrompt e formatar o Rank Mudae do personagem', async () => {
    const advisor = new RarityAdvisorService();

    // Mock do fetch global para testar construção do prompt e retorno de avaliação
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
      if (typeof url === 'string' && url.includes('/chat/completions')) {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '🎯 <b>Veredito:</b> PROCEDENTE\n🏆 <b>Rank Mudae:</b> #500 (Top 1000 -> Lendário)\n🔍 <b>Fatos Apurados:</b> Protagonista lendário mundial.\n⚖️ <b>Checagem da Alegação:</b> Confere totalmente.\n💡 <b>Raridade Recomendada:</b> LEGENDARY',
                },
              },
            ],
          }),
        };
      }
      return originalFetch(url, opts);
    });

    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    };

    try {
      const evaluation = await advisor.evaluateRaritySuggestion(
        {
          id: 'sug_test_mudae_1',
          type: 'RARITY',
          characterId: 'char_goku',
          characterName: 'Son Goku',
          series: 'Dragon Ball',
          currentRarity: 'COMMON',
          suggestedRarity: 'LEGENDARY',
          reason: 'Ícone mundial absoluto dos animes e cultura pop',
          character: {
            id: 'char_goku',
            name: 'Son Goku',
            series: 'Dragon Ball',
            baseRarity: 'COMMON',
            rank: 450, // Top 1000
          },
        },
        mockRedis as any
      );

      expect(evaluation).not.toBeNull();
      expect(evaluation?.response).toContain('Veredito');

      // Verifica se o systemPrompt recebido pelo LLM contém as regras do Mudae
      const systemMsg = capturedBody.messages.find((m: any) => m.role === 'system');
      expect(systemMsg.content).toContain('Top 1000 (1 a 1000): Recomende LEGENDARY');
      expect(systemMsg.content).toContain('1001 a 3000: Recomende EPIC');
      expect(systemMsg.content).toContain('3001 a 10000: Recomende RARE');

      // Verifica se o userPrompt identifica o rank e a regra oficial
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(userMsg.content).toContain('#450 (Top 1000 ➔ Regra Oficial: LENDÁRIO)');

      // Verifica se salvou o parecer e o prompt no Redis para o /admin exibir
      expect(mockRedis.set).toHaveBeenCalledWith(
        'suggestion:ai:sug_test_mudae_1',
        expect.stringContaining('systemPrompt'),
        'EX',
        expect.any(Number)
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'suggestion:ai:sug_test_mudae_1',
        expect.stringContaining('#450'),
        'EX',
        expect.any(Number)
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('deve formatar corretamente as faixas de Rank Mudae para 1001..3000 (Épico) e 3001..10000 (Raro)', async () => {
    const advisor = new RarityAdvisorService();

    let capturedBodies: any[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
      if (typeof url === 'string' && url.includes('/chat/completions')) {
        capturedBodies.push(JSON.parse(opts.body));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '🎯 <b>Veredito:</b> PROCEDENTE\n💡 <b>Raridade Recomendada:</b> EPIC' } }],
          }),
        };
      }
      return originalFetch(url, opts);
    });

    try {
      // Teste Épico: Rank 1800
      await advisor.evaluateRaritySuggestion({
        id: 'sug_test_epic',
        type: 'RARITY',
        character: {
          id: 'char_epic',
          name: 'Rimuru Tempest',
          series: 'Slime',
          baseRarity: 'RARE',
          rank: 1800,
        },
      });

      // Teste Raro: Rank 6500
      await advisor.evaluateRaritySuggestion({
        id: 'sug_test_rare',
        type: 'RARITY',
        character: {
          id: 'char_rare',
          name: 'Maple',
          series: 'Bofuri',
          baseRarity: 'COMMON',
          rank: 6500,
        },
      });

      const userMsgEpic = capturedBodies[0].messages.find((m: any) => m.role === 'user');
      expect(userMsgEpic.content).toContain('#1800 (1001 a 3000 ➔ Regra Oficial: ÉPICO)');

      const userMsgRare = capturedBodies[1].messages.find((m: any) => m.role === 'user');
      expect(userMsgRare.content).toContain('#6500 (3001 a 10000 ➔ Regra Oficial: RARO)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('🔧 Aplicação de Ações de Foto no SuggestionService (ADD vs REPLACE)', () => {
  const dummyRelative = 'suggestions/unit_test_photo.png';
  let fullDummyPath = '';

  it('deve aplicar overridePhotoAction: ADD adicionando à lista de imagens sem excluir as existentes', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { config } = await import('../src/config.js');

    fullDummyPath = path.resolve(config.MEDIA_DIR, dummyRelative);
    await fs.mkdir(path.dirname(fullDummyPath), { recursive: true });
    await fs.writeFile(fullDummyPath, Buffer.from('fake image content'));

    const { SuggestionService } = await import('../src/services/SuggestionService.js');

    let updatedCharacterData: any = null;
    const mockPrisma: any = {
      characterSuggestion: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sug_test_override_add',
          type: 'IMAGE',
          status: 'PENDING',
          imageUrl: dummyRelative,
          description: JSON.stringify({ action: 'REPLACE', targetPhoto: 'photo_1.png' }), // proposta era REPLACE
          character: {
            id: 'char_test_1',
            name: 'Test Character',
            imageUrls: ['photo_1.png', 'photo_2.png'],
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      character: {
        findUnique: vi.fn().mockResolvedValue({ id: 'char_test_1', name: 'Test Character', imageUrls: [] }),
        update: vi.fn().mockImplementation(async ({ data }) => {
          updatedCharacterData = data;
          return { id: 'char_test_1', ...data };
        }),
      },
    };

    const mockRedis: any = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const mockCharacterService: any = {
      formatImageUrl: (id: string, img: string) => img,
      getRandomImageUrl: () => 'default.png',
      updateCharacterScore: vi.fn().mockResolvedValue(undefined),
    };

    const suggestionService = new SuggestionService(mockPrisma, mockRedis, mockCharacterService);

    // O moderador força overridePhotoAction = 'ADD', ignorando o REPLACE original
    const result = await suggestionService.approveSuggestion(
      'sug_test_override_add',
      'admin',
      undefined,
      'ADD'
    );

    expect(result.success).toBe(true);
    expect(updatedCharacterData).toBeDefined();
    // A lista de imagens deve conter a nova imagem E manter photo_1.png e photo_2.png
    expect(updatedCharacterData.imageUrls.length).toBe(3);
    expect(updatedCharacterData.imageUrls).toContain('photo_1.png');
    expect(updatedCharacterData.imageUrls).toContain('photo_2.png');
  });

  it('deve aplicar overridePhotoAction: REPLACE substituindo a foto atual pela nova foto enviada', async () => {
    const { SuggestionService } = await import('../src/services/SuggestionService.js');

    let updatedCharacterData: any = null;
    const mockPrisma: any = {
      characterSuggestion: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sug_test_override_replace',
          type: 'IMAGE',
          status: 'PENDING',
          imageUrl: dummyRelative,
          description: JSON.stringify({ action: 'ADD' }), // proposta original era ADD
          character: {
            id: 'char_test_2',
            name: 'Test Character 2',
            imageUrls: ['primary_photo.png', 'secondary_photo.png'],
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      character: {
        findUnique: vi.fn().mockResolvedValue({ id: 'char_test_2', name: 'Test Character 2', imageUrls: [] }),
        update: vi.fn().mockImplementation(async ({ data }) => {
          updatedCharacterData = data;
          return { id: 'char_test_2', ...data };
        }),
      },
    };

    const mockRedis: any = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const mockCharacterService: any = {
      formatImageUrl: (id: string, img: string) => img,
      getRandomImageUrl: () => 'default.png',
      updateCharacterScore: vi.fn().mockResolvedValue(undefined),
    };

    const suggestionService = new SuggestionService(mockPrisma, mockRedis, mockCharacterService);

    // O moderador força overridePhotoAction = 'REPLACE', substituindo a foto atual
    const result = await suggestionService.approveSuggestion(
      'sug_test_override_replace',
      'admin',
      undefined,
      'REPLACE'
    );

    expect(result.success).toBe(true);
    expect(updatedCharacterData).toBeDefined();
    // Deve ter substituído a primeira foto (primary_photo.png) pela nova foto
    expect(updatedCharacterData.imageUrls.length).toBe(2);
    expect(updatedCharacterData.imageUrls).not.toContain('primary_photo.png');
    expect(updatedCharacterData.imageUrls).toContain('secondary_photo.png');

    // Limpa arquivo dummy
    const fs = await import('node:fs/promises');
    await fs.unlink(fullDummyPath).catch(() => {});
  });

  it('deve rejeitar sugestão de edição com erro NO_CHANGES se nenhum campo for alterado (mesmo contendo tags)', async () => {
    const { SuggestionService } = await import('../src/services/SuggestionService.js');

    const mockPrisma: any = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user_1', name: 'Agrius' }),
      },
    };

    const mockRedis: any = {
      get: vi.fn().mockResolvedValue(null),
    };

    const mockCharacterService: any = {
      findCharacter: vi.fn().mockResolvedValue({
        id: 'black-gold-saw',
        name: 'Black★Gold Saw',
        series: 'Black★Rock Shooter',
        gender: 'OTHER',
        baseRarity: 'EPIC',
        description: 'Descrição original',
        tags: ['anime', 'mudae-rank:9293'],
      }),
    };

    const suggestionService = new SuggestionService(mockPrisma, mockRedis, mockCharacterService);

    // Envia exatamente os mesmos dados que já existem no personagem
    await expect(
      suggestionService.submitEditSuggestion('user_1', 'black-gold-saw', {
        suggestedName: 'Black★Gold Saw',
        suggestedSeries: 'Black★Rock Shooter',
        suggestedGender: 'OTHER',
        suggestedRarity: 'EPIC',
        suggestedDescription: 'Descrição original',
        suggestedTags: ['anime', 'mudae-rank:9293'],
        reason: 'Papel: Atua como protetora do Hollow World',
      })
    ).rejects.toThrow('Nenhuma alteração foi sugerida em relação aos dados atuais do personagem');
  });

  it('deve aceitar sugestão de edição quando pelo menos um campo for modificado', async () => {
    const { SuggestionService } = await import('../src/services/SuggestionService.js');

    let createdData: any = null;
    const mockPrisma: any = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user_1', name: 'Agrius' }),
      },
      characterSuggestion: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdData = data;
          return { id: 'sug_edit_ok_1', ...data, character: {} };
        }),
      },
      haremEntry: { findUnique: vi.fn().mockResolvedValue(null) },
      soulmate: { findFirst: vi.fn().mockResolvedValue(null) },
      kakeraTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    const mockRedis: any = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    const mockCharacterService: any = {
      findCharacter: vi.fn().mockResolvedValue({
        id: 'black-gold-saw',
        name: 'Black★Gold Saw',
        series: 'Black★Rock Shooter',
        gender: 'OTHER',
        baseRarity: 'EPIC',
        description: 'Descrição original',
        tags: ['anime', 'mudae-rank:9293'],
      }),
      getRandomImageUrl: () => 'default.png',
      formatImageUrl: (id: string, img: string) => img,
    };

    const suggestionService = new SuggestionService(mockPrisma, mockRedis, mockCharacterService);
    (suggestionService as any).telegramService = {
      notifySuggestion: vi.fn().mockResolvedValue(undefined),
    };

    // Altera a descrição incluindo o novo papel
    const res = await suggestionService.submitEditSuggestion('user_1', 'black-gold-saw', {
      suggestedName: 'Black★Gold Saw',
      suggestedSeries: 'Black★Rock Shooter',
      suggestedGender: 'OTHER',
      suggestedRarity: 'EPIC',
      suggestedDescription: 'Descrição original com papel de protetora do Hollow World',
      suggestedTags: ['anime', 'mudae-rank:9293'],
      reason: 'Papel atualizado conforme a lore oficial',
    });

    expect(createdData).not.toBeNull();
    expect(createdData.characterId).toBe('black-gold-saw');
    expect(createdData.suggestedDescription).toContain('papel de protetora');
  });
});
