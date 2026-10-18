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
});
