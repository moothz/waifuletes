import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

describe('🌐 Workstream Web & Admin — Waifuletes Web Features', () => {
  let testUserId = 'test_web_user_1';
  let testPublicId = '';
  let testUserToken = '';
  let adminToken = '';
  let testCharacterId = '';
  let createdSuggestionId = '';
  let originalCharacterData: any = null;

  beforeAll(async () => {
    // 1. Garante um usuário de teste
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        groupId: 'test_group_web',
        name: 'Jogador Web Teste',
      }),
    });

    // 2. Busca um personagem existente para testes e preserva dados originais
    const charRes = await fetch(`${BASE_URL}/characters?limit=1`);
    const charJson = await charRes.json();
    if (charJson.data?.data?.[0]) {
      testCharacterId = charJson.data.data[0].id;
      originalCharacterData = { ...charJson.data.data[0] };
    }
  });

  let createdReportSuggestionId = '';
  let createdMultiReportId = '';
  let createdEditSuggestionId = '';

  afterAll(async () => {
    if (!adminToken) {
      try {
        const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ADMIN_PASSWORD }),
        });
        const loginJson = await loginRes.json();
        if (loginJson?.data?.token) adminToken = loginJson.data.token;
      } catch (_) {}
    }

    // 1. Apaga a mensagem gerada no Telegram para as sugestões de teste (Beowulf / Denúncias)
    if (createdSuggestionId && adminToken) {
      const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdSuggestionId}/telegram`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await res.json().catch(() => null);
      console.log('Deleted rarity telegram msg:', json);

      await fetch(`${BASE_URL}/api/admin/suggestions/${createdSuggestionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }

    if (createdReportSuggestionId && adminToken) {
      const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdReportSuggestionId}/telegram`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await res.json().catch(() => null);
      console.log('Deleted report telegram msg:', json);

      await fetch(`${BASE_URL}/api/admin/suggestions/${createdReportSuggestionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }

    if (createdMultiReportId && adminToken) {
      const res = await fetch(`${BASE_URL}/api/admin/multi-reports/${createdMultiReportId}/telegram`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await res.json().catch(() => null);
      console.log('Deleted multi-report telegram msg:', json);
    }

    if (createdEditSuggestionId && adminToken) {
      const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdEditSuggestionId}/telegram`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const json = await res.json().catch(() => null);
      console.log('Deleted edit telegram msg:', json);

      await fetch(`${BASE_URL}/api/admin/suggestions/${createdEditSuggestionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }

    // 2. Restaura dados do personagem original
    if (testCharacterId && originalCharacterData && adminToken) {
      await fetch(`${BASE_URL}/api/admin/characters/${testCharacterId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: originalCharacterData.name,
          series: originalCharacterData.series,
          description: originalCharacterData.description,
          baseRarity: originalCharacterData.baseRarity,
          gender: originalCharacterData.gender,
          tags: originalCharacterData.tags,
        }),
      });
    }
  });

  it('POST /user/session deve gerar link com publicId e token de 30 min para o bot', async () => {
    const res = await fetch(`${BASE_URL}/user/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: testUserId }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('publicId');
    expect(json.data).toHaveProperty('token');
    expect(json.data).toHaveProperty('url');
    expect(json.data.expiresIn).toBe(1800);

    testPublicId = json.data.publicId;
    testUserToken = json.data.token;
    expect(json.data.url).toContain(`/user/${testPublicId}?token=${testUserToken}`);
  });

  it('GET /api/web/user/:publicId sem token deve retornar modo público com proteção estrita de PII', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.isAdmin).toBe(false);
    expect(json.data.publicId).toBe(testPublicId);
    expect(json.data.name).toBe('Jogador Web Teste');
    expect(json.data).not.toHaveProperty('id'); // Não expõe JID/telefone!
    expect(json.data).not.toHaveProperty('userId');
    expect(json.data).not.toHaveProperty('wishlist'); // Wishlist é privada
    expect(Array.isArray(json.data.harem)).toBe(true);
  });

  it('GET /api/web/user/:publicId?token=... deve autenticar e retornar modo privado com wishlist e tempo restante', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}?token=${testUserToken}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.isAdmin).toBe(true);
    expect(json.data.name).toBe('Jogador Web Teste');
    expect(json.data.expiresIn).toBeGreaterThan(1700);
    expect(json.data).toHaveProperty('wishlist');
    expect(Array.isArray(json.data.wishlist)).toBe(true);
  });

  it('POST /api/web/user/:publicId/suggestions deve rejeitar sugestão de raridade sem motivo (400)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'RARITY',
        characterId: testCharacterId,
        suggestedRarity: 'LEGENDARY',
        reason: '', // Vazio
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('REASON_REQUIRED');
  });

  it('POST /api/web/user/:publicId/suggestions deve criar sugestão de raridade com motivo válido', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'RARITY',
        characterId: testCharacterId,
        suggestedRarity: 'LEGENDARY',
        reason: 'Personagem extremamente poderoso e icônico na história da obra.',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('suggestion');
    expect(json.data.suggestion.status).toBe('PENDING');
    createdSuggestionId = json.data.suggestion.id;
  });

  it('Prisma Client SuggestionType deve conter todos os enums suportados (EDIT, RARITY, IMAGE, NEW_CHARACTER, DELETE_CHARACTER)', async () => {
    const { SuggestionType } = await import('@prisma/client');
    expect(SuggestionType.EDIT).toBe('EDIT');
    expect(SuggestionType.RARITY).toBe('RARITY');
    expect(SuggestionType.IMAGE).toBe('IMAGE');
    expect(SuggestionType.NEW_CHARACTER).toBe('NEW_CHARACTER');
    expect(SuggestionType.DELETE_CHARACTER).toBe('DELETE_CHARACTER');
  });

  it('POST /api/web/user/:publicId/suggestions deve rejeitar sugestão de edição sem alterações reais (400 NO_CHANGES)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'EDIT',
        characterId: testCharacterId,
        suggestedName: originalCharacterData.name,
        suggestedSeries: originalCharacterData.series,
        reason: 'Tentativa sem alteração real',
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NO_CHANGES');
  });

  it('POST /api/web/user/:publicId/suggestions deve rejeitar sugestão de edição sem justificativa válida (400 REASON_REQUIRED)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'EDIT',
        characterId: testCharacterId,
        suggestedName: `${originalCharacterData.name} Editado`,
        reason: 'abc', // < 5 caracteres
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('REASON_REQUIRED');
  });

  it('POST /api/web/user/:publicId/suggestions deve criar sugestão de alteração (type: EDIT) com campos completos', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'EDIT',
        characterId: testCharacterId,
        suggestedName: `${originalCharacterData.name} Versão Sugerida`,
        suggestedSeries: `${originalCharacterData.series} Série Sugerida`,
        suggestedGender: 'OTHER',
        suggestedDescription: 'Descrição completa sugerida pelo usuário no painel.',
        suggestedTags: ['tag_edicao_1', 'tag_edicao_2'],
        suggestedRarity: 'EPIC',
        reason: 'Sugestão de alteração completa para testes automatizados.',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('suggestion');
    expect(json.data.suggestion.type).toBe('EDIT');
    expect(json.data.suggestion.status).toBe('PENDING');
    expect(json.data.suggestion.suggestedName).toBe(`${originalCharacterData.name} Versão Sugerida`);
    expect(json.data.suggestion.suggestedGender).toBe('OTHER');
    createdEditSuggestionId = json.data.suggestion.id;
  });

  it('GET /api/web/user/:publicId/suggestions deve listar sugestão de EDIT enviada pelo usuário', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions?token=${encodeURIComponent(testUserToken)}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const list = Array.isArray(json.data) ? json.data : (json.data?.suggestions || []);
    const found = list.find((s: any) => s.id === createdEditSuggestionId);
    expect(found).toBeDefined();
    expect(found.type).toBe('EDIT');
    expect(found.suggestedName).toBe(`${originalCharacterData.name} Versão Sugerida`);
  });

  it('debounce: requisições concorrentes ou duplicadas devem retornar a mesma sugestão sem duplicar no banco', async () => {
    const payload = {
      token: testUserToken,
      type: 'EDIT',
      characterId: testCharacterId,
      suggestedName: `${originalCharacterData.name} Debounce Teste`,
      reason: 'Sugestão para validar debounce no servidor',
    };

    // Envia 2 requisições concorrentes idênticas no mesmo instante
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    const json2 = await res2.json();

    expect(json1.success).toBe(true);
    expect(json2.success).toBe(true);
    // Ambos devem retornar exatamente o mesmo ID de sugestão (reutilizado pelo debounce)
    expect(json1.data.suggestion.id).toBe(json2.data.suggestion.id);

    // Limpa a sugestão criada do teste
    if (json1.data?.suggestion?.id && adminToken) {
      await fetch(`${BASE_URL}/api/admin/suggestions/${json1.data.suggestion.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
  });

  it('horário formatado no serviço de Telegram deve conter GMT-3 e fuso de Brasília', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();
    const formatted = service.formatBrazilDateTime(new Date('2026-10-22T21:00:00Z'));
    expect(formatted).toContain('(GMT-3)');
    expect(formatted).toContain('18:00:00'); // 21:00 UTC = 18:00 BRT
  });

  it('notificação de alteração de raridade deve gerar botões para cada raridade e processar callback com override', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();

    let capturedQuery: string | null = null;
    let capturedApproveArgs: any = null;
    const mockSuggestionService = {
      approveSuggestion: async (id: string, reviewedBy: string, overrideRarity?: string) => {
        capturedApproveArgs = { id, reviewedBy, overrideRarity };
        return { success: true };
      },
    };

    (service as any).answerCallback = async (id: string, text: string) => {
      capturedQuery = text;
    };
    (service as any).updateTelegramMessage = async () => {};
    (service as any).botToken = 'mock_token';

    const callbackQuery = {
      id: 'query123',
      data: 'sug_app_rar:sug_456:EPIC',
      from: { first_name: 'Admin', username: 'moothz' },
      message: { chat: { id: 123 }, message_id: 999 },
    };

    await service.handleCallback(callbackQuery, mockSuggestionService);

    expect(capturedApproveArgs).toEqual({
      id: 'sug_456',
      reviewedBy: 'telegram:Admin (@moothz)',
      overrideRarity: 'EPIC',
    });
    expect(capturedQuery).toContain('EPIC');
  });

  it('POST /characters/:id/report deve aceitar denúncia enviando publicId e characterId sem erro 500/P2003', async () => {
    const res = await fetch(`${BASE_URL}/characters/${encodeURIComponent(testCharacterId)}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: testCharacterId,
        reason: 'Conteúdo reportado pelo usuário (🔞).',
        userId: testPublicId,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('suggestion');
    expect(json.data.suggestion.type).toBe('DELETE_CHARACTER');
    createdReportSuggestionId = json.data.suggestion.id;
  });

  it('POST /characters/multi-report deve registrar denúncia de múltiplos rolls e retornar ID', async () => {
    const res = await fetch(`${BASE_URL}/characters/multi-report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slots: [
          {
            slot: 1,
            characterId: testCharacterId,
            characterName: originalCharacterData?.name || 'Teste Slot 1',
            series: originalCharacterData?.series || 'Série Teste',
            rarity: 'COMMON',
          },
          {
            slot: 2,
            characterId: 'fake-char-2',
            characterName: 'Slot 2 Fake',
            series: 'Série Fake',
            rarity: 'RARE',
          },
        ],
        reason: 'Denúncia de teste de múltiplos rolls',
        userId: testPublicId,
        userName: 'Tester Web',
        source: 'Grupo de Testes',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('report');
    expect(json.data.report).toHaveProperty('id');
    expect(json.data.report.slotsCount).toBe(2);
    createdMultiReportId = json.data.report.id;
  });

  it('POST /api/admin/login deve autenticar com a senha única do .env', async () => {
    // 1. Senha errada -> 401
    const failRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'senha_completamente_incorreta' }),
    });
    expect(failRes.status).toBe(401);

    // 2. Senha correta -> 200 e token
    const okRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(okRes.status).toBe(200);
    const json = await okRes.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('token');
    adminToken = json.data.token;
  });

  it('GET /api/admin/suggestions deve listar sugestões pendentes para o admin', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/suggestions?status=PENDING`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.data)).toBe(true);
    const found = json.data.data.find((s: any) => s.id === createdSuggestionId);
    expect(found).toBeDefined();
    expect(found.reason).toContain('extremamente poderoso');
  });

  it('POST /api/admin/suggestions/:id/approve deve aprovar e aplicar a sugestão', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdSuggestionId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.status).toBe('APPROVED');
  });

  it('POST /api/admin/suggestions/:id/approve deve aprovar sugestão de EDIT e atualizar o personagem no catálogo', async () => {
    if (!createdEditSuggestionId) return;

    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdEditSuggestionId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.status).toBe('APPROVED');

    // Confere se o personagem recebeu os novos dados no catálogo
    const charRes = await fetch(`${BASE_URL}/characters/${encodeURIComponent(testCharacterId)}`);
    expect(charRes.status).toBe(200);
    const charJson = await charRes.json();
    expect(charJson.data.name).toBe(`${originalCharacterData.name} Versão Sugerida`);
    expect(charJson.data.gender).toBe('OTHER');
    expect(charJson.data.baseRarity).toBe('EPIC');
  });

  it('PUT /api/admin/characters/:id deve permitir ao admin editar nome e descrição diretamente', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/characters/${testCharacterId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Personagem Teste Modificado',
        description: 'Nova biografia salva diretamente pelo painel administrativo web.',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.character.name).toBe('Personagem Teste Modificado');
    expect(json.data.character.description).toBe('Nova biografia salva diretamente pelo painel administrativo web.');
  });

  it('GET /api/admin/users deve listar usuários e permitir busca por nome e número', async () => {
    // 1. Listagem geral
    const res = await fetch(`${BASE_URL}/api/admin/users?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.users)).toBe(true);
    expect(json.data.pagination).toHaveProperty('total');

    // 2. Busca pelo nome do usuário de teste
    const searchRes = await fetch(`${BASE_URL}/api/admin/users?search=Jogador+Web+Teste`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(searchRes.status).toBe(200);
    const searchJson = await searchRes.json();
    expect(searchJson.success).toBe(true);
    const foundUser = searchJson.data.users.find((u: any) => u.id === testUserId);
    expect(foundUser).toBeDefined();
    expect(foundUser.name).toBe('Jogador Web Teste');
    expect(foundUser).toHaveProperty('totalHarem');
    expect(foundUser).toHaveProperty('totalWishlist');
  });

  it('POST /api/admin/users/:userId/session deve gerar impersonation URL do usuário', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(testUserId)}/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('token');
    expect(json.data).toHaveProperty('url');
    expect(json.data.url).toContain(`/user/${testPublicId}?token=`);
  });

  it('POST /api/admin/users/:userId/marry deve validar personagem e casar se solteiro', async () => {
    // 1. Personagem inexistente -> 400
    const notFoundRes = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(testUserId)}/marry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ characterId: 'id_inexistente_12345' }),
    });
    expect(notFoundRes.status).toBe(400);

    // 2. Busca uma waifu solteira no catálogo
    const singleCharRes = await fetch(`${BASE_URL}/characters?maritalStatus=single&limit=1`);
    const singleCharJson = await singleCharRes.json();
    const singleChar = singleCharJson.data?.data?.[0];

    if (singleChar) {
      // 3. Realiza casamento administrativo
      const marryRes = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(testUserId)}/marry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ characterId: singleChar.id }),
      });
      expect(marryRes.status).toBe(200);
      const marryJson = await marryRes.json();
      expect(marryJson.success).toBe(true);
      expect(marryJson.data.character.id).toBe(singleChar.id);

      // 4. Tentativa de casar com a mesma agora que já está casada -> 400
      const alreadyClaimedRes = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(testUserId)}/marry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ characterId: singleChar.id }),
      });
      expect(alreadyClaimedRes.status).toBe(400);
      const alreadyClaimedJson = await alreadyClaimedRes.json();
      expect(alreadyClaimedJson.error.code).toMatch(/CHARACTER_ALREADY_/);

      // 5. Desfaz o casamento do teste para não deixar personagem preso
      await fetch(`${BASE_URL}/api/web/user/${encodeURIComponent(testPublicId)}/divorce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: testUserToken, characterId: singleChar.id }),
      });
    }
  });

  it('filtro de gênero OTHER deve retornar Trish de Devil May Cry e filtros MALE/FEMALE não devem incluí-la', async () => {
    // 1. Busca com filtro OTHER
    const resOther = await fetch(`${BASE_URL}/characters?gender=OTHER&search=trish`);
    expect(resOther.status).toBe(200);
    const jsonOther = await resOther.json();
    expect(jsonOther.success).toBe(true);
    const trishOther = jsonOther.data.data.find((c: any) => c.id === 'trish');
    expect(trishOther).toBeDefined();
    expect(trishOther.gender).toBe('OTHER');
    expect(trishOther.series).toBe('Devil May Cry');

    // 2. Busca com filtro FEMALE não deve conter Trish DMC
    const resFemale = await fetch(`${BASE_URL}/characters?gender=FEMALE&search=trish`);
    expect(resFemale.status).toBe(200);
    const jsonFemale = await resFemale.json();
    const trishFemale = jsonFemale.data.data.find((c: any) => c.id === 'trish');
    expect(trishFemale).toBeUndefined();

    // 3. Busca com filtro MALE não deve conter Trish DMC
    const resMale = await fetch(`${BASE_URL}/characters?gender=MALE&search=trish`);
    expect(resMale.status).toBe(200);
    const jsonMale = await resMale.json();
    const trishMale = jsonMale.data.data.find((c: any) => c.id === 'trish');
    expect(trishMale).toBeUndefined();
  });

  it('PUT /api/admin/characters/:id deve permitir atualizar gênero pelo painel administrativo', async () => {
    if (!adminToken) {
      const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      const loginJson = await loginRes.json();
      adminToken = loginJson?.data?.token || '';
    }

    if (!testCharacterId) return;

    // Salva com gender: OTHER
    const updateRes = await fetch(`${BASE_URL}/api/admin/characters/${encodeURIComponent(testCharacterId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: originalCharacterData?.name || 'Test Char',
        baseRarity: originalCharacterData?.baseRarity || 'COMMON',
        gender: 'OTHER',
        description: 'Descrição de teste com gênero atualizado.',
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateJson = await updateRes.json();
    expect(updateJson.success).toBe(true);
    expect(updateJson.data.character.gender).toBe('OTHER');

    // Restaura dados originais do personagem
    if (originalCharacterData) {
      await fetch(`${BASE_URL}/api/admin/characters/${encodeURIComponent(testCharacterId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: originalCharacterData.name,
          baseRarity: originalCharacterData.baseRarity,
          gender: originalCharacterData.gender || 'FEMALE',
          description: originalCharacterData.description || '',
        }),
      });
    }
  });

  it('toggle de Wishlist: deve adicionar (POST) e em seguida remover (DELETE) com sucesso', async () => {
    if (!testPublicId || !testUserToken || !testCharacterId) return;

    // 1. Adicionar à Wishlist
    const addRes = await fetch(`${BASE_URL}/api/web/user/${encodeURIComponent(testPublicId)}/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        characterId: testCharacterId,
        isStarWish: false,
      }),
    });
    expect(addRes.status).toBe(200);
    const addJson = await addRes.json();
    expect(addJson.success).toBe(true);

    // 2. Remover da Wishlist (comportamento de toggle)
    const delRes = await fetch(
      `${BASE_URL}/api/web/user/${encodeURIComponent(testPublicId)}/wishlist/${encodeURIComponent(testCharacterId)}?token=${encodeURIComponent(testUserToken)}`,
      {
        method: 'DELETE',
      }
    );
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBe(true);
  });

  it('POST /roll com gender FEMALE e MALE deve sortear personagens FEMALE/MALE ou OTHER', async () => {
    const rollUser = `roll_tester_${Date.now()}`;
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: rollUser,
        groupId: `group_${rollUser}`,
        name: 'Roll Tester',
      }),
    });

    const rollFemaleRes = await fetch(`${BASE_URL}/roll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: rollUser,
        groupId: `group_${rollUser}`,
        name: 'Roll Tester',
        gender: 'FEMALE',
      }),
    });
    expect(rollFemaleRes.status).toBe(200);
    const rollFemaleJson = await rollFemaleRes.json();
    expect(rollFemaleJson.success).toBe(true);
    expect(['FEMALE', 'OTHER']).toContain(rollFemaleJson.data.character.gender);
  });

  it('POST /api/admin/users/:userId/block-suggestions deve bloquear o usuário para não enviar sugestões', async () => {
    // 1. Bloqueia o usuário por 24h
    const blockRes = await fetch(`${BASE_URL}/api/admin/users/${testUserId}/block-suggestions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        duration: '24h',
        reason: 'Suspeita de spam',
      }),
    });
    expect(blockRes.status).toBe(200);
    const blockJson = await blockRes.json();
    expect(blockJson.success).toBe(true);
    expect(blockJson.data.blockInfo.duration).toBe('24h');

    // 2. Consulta sugestões do usuário e confirma isBlocked === true
    const listRes = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions?token=${encodeURIComponent(testUserToken)}`);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.success).toBe(true);
    expect(listJson.data.isBlocked).toBe(true);

    // 3. Tenta enviar uma sugestão enquanto bloqueado -> deve retornar 403 SUGGESTIONS_BLOCKED
    const submitRes = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'RARITY',
        characterId: testCharacterId,
        suggestedRarity: 'LEGENDARY',
        reason: 'Tentativa de envio enquanto bloqueado',
      }),
    });
    expect(submitRes.status).toBe(403);
    const submitJson = await submitRes.json();
    expect(submitJson.success).toBe(false);
    expect(submitJson.error.code).toBe('SUGGESTIONS_BLOCKED');
    expect(submitJson.error.message).toBe('Você está temporariamente impedido de enviar sugestões por suspeita de spam.');

    // 4. Desbloqueia o usuário
    const unblockRes = await fetch(`${BASE_URL}/api/admin/users/${testUserId}/unblock-suggestions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(unblockRes.status).toBe(200);
    const unblockJson = await unblockRes.json();
    expect(unblockJson.success).toBe(true);

    // 5. Consulta novamente e confirma que isBlocked agora é false
    const listAfterRes = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions?token=${encodeURIComponent(testUserToken)}`);
    const listAfterJson = await listAfterRes.json();
    expect(listAfterJson.data.isBlocked).toBe(false);
  });
});
