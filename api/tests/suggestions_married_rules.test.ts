import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

describe('💍 Regras de Sugestão de Raridade para Personagens Casados', () => {
  let testUserId = 'test_married_rule_user';
  let testPublicId = '';
  let testUserToken = '';
  let adminToken = '';
  let marriedCharId = 'test_married_char_rule';
  let singleCharId = 'test_single_char_rule';
  let createdNewLegendarySuggestionId = '';
  let createdMarriedEpicSuggestionId = '';

  beforeAll(async () => {
    // 1. Login do admin
    try {
      const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      const loginJson = await loginRes.json();
      if (loginJson?.data?.token) adminToken = loginJson.data.token;
    } catch (_) {}

    // 2. Garante usuário de teste
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        groupId: 'test_group_married_rules',
        name: 'Jogador Teste Casamentos',
      }),
    });

    // 3. Obtém dados do usuário e token web
    const userRes = await fetch(`${BASE_URL}/user/${testUserId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const userJson = await userRes.json();
    testPublicId = userJson.data.publicId;

    const tokenRes = await fetch(`${BASE_URL}/user/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: testUserId }),
    });
    const tokenJson = await tokenRes.json();
    testUserToken = tokenJson.data.token;

    // 4. Cria ou garante um personagem solteiro e um personagem casado
    const singleRes = await fetch(`${BASE_URL}/characters?limit=1&maritalStatus=single&rarity=COMMON`);
    const singleJson = await singleRes.json();
    if (singleJson.data?.data?.[0]) {
      singleCharId = singleJson.data.data[0].id;
    }

    const marryCandidateRes = await fetch(`${BASE_URL}/characters?limit=1&page=2&maritalStatus=single&rarity=COMMON`);
    const marryJson = await marryCandidateRes.json();
    if (marryJson.data?.data?.[0]) {
      marriedCharId = marryJson.data.data[0].id;
      // Casa via rota de admin
      await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(testUserId)}/marry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ characterId: marriedCharId }),
      });
    }
  });

  afterAll(async () => {
    // Limpeza de sugestões criadas
    if (createdNewLegendarySuggestionId && adminToken) {
      await fetch(`${BASE_URL}/api/admin/suggestions/${createdNewLegendarySuggestionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
    if (createdMarriedEpicSuggestionId && adminToken) {
      await fetch(`${BASE_URL}/api/admin/suggestions/${createdMarriedEpicSuggestionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
  });

  it('GET /characters/:id deve retornar flag wasEverMarried correta', async () => {
    const res = await fetch(`${BASE_URL}/characters/${encodeURIComponent(marriedCharId)}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty('wasEverMarried');
    expect(json.data.wasEverMarried).toBe(true);
  });

  it('POST suggestions deve REJEITAR sugestão de LENDÁRIO para personagem casado sem foto (400)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'RARITY',
        characterId: marriedCharId,
        suggestedRarity: 'LEGENDARY',
        reason: 'Tentativa de transformar personagem casado em Lendário sem foto.',
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('PHOTO_REQUIRED_FOR_LEGENDARY');
  });

  it('POST suggestions deve REJEITAR sugestão de EDIT com LENDÁRIO para personagem casado sem foto (400)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'EDIT',
        characterId: marriedCharId,
        suggestedRarity: 'LEGENDARY',
        suggestedName: 'Nome Alterado',
        reason: 'Tentativa de editar personagem casado para Lendário sem nova foto.',
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('PHOTO_REQUIRED_FOR_LEGENDARY');
  });

  it('POST suggestions deve ACEITAR sugestão de ÉPICO para personagem já casado (raridade máxima permitida)', async () => {
    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'RARITY',
        characterId: marriedCharId,
        suggestedRarity: 'EPIC',
        reason: 'Mudança legítima para a raridade máxima permitida (ÉPICO).',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.suggestedRarity).toBe('EPIC');
    expect(json.data.suggestion.type).toBe('RARITY');
    createdMarriedEpicSuggestionId = json.data.suggestion.id;
  });

  it('POST suggestions para LENDÁRIO com foto em personagem casado DEVE CRIAR NOVO PERSONAGEM', async () => {
    // 1x1 pixel PNG em base64
    const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: testUserToken,
        type: 'EDIT',
        characterId: marriedCharId,
        suggestedRarity: 'LEGENDARY',
        suggestedName: 'Versão Lendária Oficial',
        reason: 'Criação da versão lendária com foto nova obrigatória.',
        imageBase64: samplePngBase64,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.type).toBe('NEW_CHARACTER');
    expect(json.data.suggestion.suggestedRarity).toBe('LEGENDARY');
    expect(json.data.suggestion.characterId).toBe(marriedCharId);
    expect(json.data.suggestion.imageUrl).toBeTruthy();
    createdNewLegendarySuggestionId = json.data.suggestion.id;
  });

  it('POST approve deve rejeitar tentativa de forçar LEGENDARY em personagem casado existente', async () => {
    if (!createdMarriedEpicSuggestionId || !adminToken) return;

    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdMarriedEpicSuggestionId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ overrideRarity: 'LEGENDARY' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('MARRIED_CHARACTER_CANNOT_BE_LEGENDARY');
  });

  it('POST approve no novo personagem lendário deve criar novo registro independente no catálogo', async () => {
    if (!createdNewLegendarySuggestionId || !adminToken) return;

    const res = await fetch(`${BASE_URL}/api/admin/suggestions/${createdNewLegendarySuggestionId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.suggestion.status).toBe('APPROVED');

    // Confere se o personagem original permaneceu casado e intacto
    const origRes = await fetch(`${BASE_URL}/characters/${encodeURIComponent(marriedCharId)}`);
    const origJson = await origRes.json();
    expect(origJson.data.isClaimed).toBe(true);
    expect(origJson.data.baseRarity).not.toBe('LEGENDARY');
  });
});
