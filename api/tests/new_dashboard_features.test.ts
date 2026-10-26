import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

describe('✨ Novas Funcionalidades: Manter Login, Likes, Ranks e Notificações', () => {
  let testUserId = 'test_feature_user_1';
  let testGroupId = 'test_feature_group_1';
  let testPublicId = '';
  let testToken = '';
  let testCharacterId = '';

  beforeAll(async () => {
    // 1. Garante usuário
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        groupId: testGroupId,
        name: 'Jogador Novas Features',
      }),
    });

    // 2. Obtém publicId
    const userRes = await fetch(`${BASE_URL}/user/${testUserId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const userJson = await userRes.json();
    testPublicId = userJson.data.publicId;

    // 3. Obtém token inicial
    const tokenRes = await fetch(`${BASE_URL}/user/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: testUserId }),
    });
    const tokenJson = await tokenRes.json();
    testToken = tokenJson.data.token;

    // 4. Seleciona personagem para teste de curtida
    const charRes = await fetch(`${BASE_URL}/characters?limit=1&maritalStatus=single&rarity=COMMON`);
    const charJson = await charRes.json();
    testCharacterId = charJson.data?.data?.[0]?.id || 'test-char';
  });

  describe('🔒 Manter Login (Sessão Persistente 3 dias) & Logout', () => {
    it('POST /persist-session deve ativar persistência de 3 dias (259200s)', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/persist-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: testToken }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.isPersistent).toBe(true);
      expect(json.data.expiresIn).toBe(259200);

      // Confere se o perfil web agora retorna isPersistent = true
      const checkRes = await fetch(`${BASE_URL}/api/web/user/${testPublicId}?token=${encodeURIComponent(testToken)}`);
      const checkJson = await checkRes.json();
      expect(checkJson.data.isAdmin).toBe(true);
      expect(checkJson.data.isPersistent).toBe(true);
    });

    it('POST /logout deve invalidar a sessão mantida no Redis', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: testToken }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Após logout, acesso com aquele token deve cair para modo público
      const checkRes = await fetch(`${BASE_URL}/api/web/user/${testPublicId}?token=${encodeURIComponent(testToken)}`);
      const checkJson = await checkRes.json();
      expect(checkJson.data.isAdmin).toBe(false);
    });
  });

  describe('❤️ Sistema de Likes em Personagens (Limite Diário 04:00 BRT)', () => {
    let freshToken = '';

    beforeAll(async () => {
      // Gera nova sessão após logout
      const tokenRes = await fetch(`${BASE_URL}/user/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: testUserId }),
      });
      const tokenJson = await tokenRes.json();
      freshToken = tokenJson.data.token;
    });

    it('POST /like deve registrar curtida e incrementar likeCount', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/characters/${encodeURIComponent(testCharacterId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: freshToken }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(typeof json.data.likeCount).toBe('number');
      expect(json.data.message).toContain('curtiu');
    });

    it('POST /like repetido no mesmo personagem no mesmo dia DEVE SER REJEITADO (429 LIKE_ALREADY_GIVEN_TODAY)', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/characters/${encodeURIComponent(testCharacterId)}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: freshToken }),
      });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('LIKE_ALREADY_GIVEN_TODAY');
      expect(json.error.message).toContain('04:00');
    });
  });

  describe('🔔 Central de Notificações', () => {
    let freshToken = '';

    beforeAll(async () => {
      const tokenRes = await fetch(`${BASE_URL}/user/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: testUserId }),
      });
      const tokenJson = await tokenRes.json();
      freshToken = tokenJson.data.token;
    });

    it('GET /notifications deve retornar lista de notificações do usuário', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/notifications?token=${encodeURIComponent(freshToken)}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.notifications)).toBe(true);
    });

    it('POST /notifications/read com all=true deve marcar notificações como lidas', async () => {
      const res = await fetch(`${BASE_URL}/api/web/user/${testPublicId}/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: freshToken, all: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe('🏆 Ranking por Grupo (Comando Ravena /groups/:groupId/leaderboard)', () => {
    it('GET /groups/:groupId/leaderboard deve retornar topKakera, topHarem e topCharacters', async () => {
      const res = await fetch(`${BASE_URL}/groups/${encodeURIComponent(testGroupId)}/leaderboard`, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('topKakera');
      expect(json.data).toHaveProperty('topHarem');
      expect(json.data).toHaveProperty('topCharacters');
      expect(Array.isArray(json.data.topKakera)).toBe(true);
      expect(Array.isArray(json.data.topHarem)).toBe(true);
      expect(Array.isArray(json.data.topCharacters)).toBe(true);
    });

    it('Chamada sem API_KEY deve retornar 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/groups/${encodeURIComponent(testGroupId)}/leaderboard`);
      expect(res.status).toBe(401);
    });
  });
});
