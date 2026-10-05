import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

describe('🔒 Workstream C — Privacidade e Proteção de PII', () => {
  beforeAll(async () => {
    // Garante um usuário para testes de leaderboard
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'seed_init_user',
        groupId: 'seed_init_group',
        name: 'Seed Init User',
      }),
    });
  });

  it('chamada anônima a /leaderboard/users não deve expor id/telefone de usuários', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/users?limit=5`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.topRich)).toBe(true);

    for (const user of json.data.topRich) {
      expect(user).not.toHaveProperty('id');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('platform');
      expect(user).toHaveProperty('kakera');
    }
  });

  it('chamada autenticada a /leaderboard/users deve incluir id para o bot', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/users?limit=5`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.topRich.length).toBeGreaterThan(0);
    expect(json.data.topRich[0]).toHaveProperty('id');
  });

  it('chamada anônima a /characters não deve expor id do dono nem claimedInGroup', async () => {
    const res = await fetch(`${BASE_URL}/characters?maritalStatus=married&limit=5`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    for (const char of json.data.data) {
      expect(char.claimedInGroup).toBeNull();
      if (char.owner) {
        expect(char.owner).not.toHaveProperty('id');
        expect(char.owner).toHaveProperty('name');
      }
      expect(char).not.toHaveProperty('haremEntries');
    }
  });

  it('chamada anônima com userId em /characters/stats deve desconsiderar o parâmetro', async () => {
    const resAnon = await fetch(`${BASE_URL}/characters/stats?userId=551199999999`);
    expect(resAnon.status).toBe(200);

    const jsonAnon = await resAnon.json();
    expect(jsonAnon.success).toBe(true);
    // Para anônimos, userWishlistStats não deve ser processado
    expect(jsonAnon.data.userWishlistStats).toBeNull();
  });
});

describe('🛡️ Validações de Entrada e Limites de Paginação', () => {
  it('deve rejeitar limite de paginação acima do teto permitido', async () => {
    const res = await fetch(`${BASE_URL}/characters?limit=500`);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('deve rejeitar página menor que 1', async () => {
    const res = await fetch(`${BASE_URL}/characters?page=0`);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('deve rejeitar bônus de sorteio abusivos no /roll', async () => {
    const res = await fetch(`${BASE_URL}/roll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'test_validation_user',
        groupId: 'test_validation_group',
        bonuses: {
          wishlistMultiplier: 999, // Acima do teto de 100
        },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('🧩 Workstream D — Concorrência e Atomicidade', () => {
  it('concorrência de 15 rolls simultâneos com saldo limitado', async () => {
    const testUserId = `test_race_user_${Date.now()}`;
    const testGroupId = `test_race_group_${Date.now()}`;

    // Executa 15 requisições de /roll exatamente no mesmo milissegundo
    const promises = Array.from({ length: 15 }, () =>
      fetch(`${BASE_URL}/roll`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: testUserId,
          groupId: testGroupId,
          name: 'Concurrent Tester',
        }),
      }).then((r) => r.json())
    );

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.success === true);
    const cooldowns = results.filter(
      (r) => r.success === false && r.error?.code === 'COOLDOWN_ACTIVE'
    );

    // O usuário começa com 10 rolls base. Exatamente 10 devem suceder e exatamente 5 devem receber COOLDOWN_ACTIVE.
    expect(successes.length).toBe(10);
    expect(cooldowns.length).toBe(5);
  });

  it('concorrência de múltiplos resgates de /kakera/daily', async () => {
    const testUserId = `test_daily_user_${Date.now()}`;

    // Cadastra o usuário primeiro
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        groupId: `group_${testUserId}`,
        name: 'Daily Tester',
      }),
    });

    // 10 requisições simultâneas de resgate diário
    const promises = Array.from({ length: 10 }, () =>
      fetch(`${BASE_URL}/kakera/daily`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: testUserId,
        }),
      }).then((r) => r.json())
    );

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.success === true);
    const cooldowns = results.filter(
      (r) => r.success === false && r.error?.code === 'COOLDOWN_ACTIVE'
    );

    // Exatamente 1 deve ser concedido, 9 devem ser bloqueados
    expect(successes.length).toBe(1);
    expect(cooldowns.length).toBe(9);
  });
});
