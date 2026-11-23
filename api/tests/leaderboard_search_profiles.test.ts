import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

describe('🏆 Leaderboard Search and Public Profiles', () => {
  const testUserId1 = 'test_leaderboard_user_1';
  const testUserId2 = 'test_leaderboard_user_2';

  beforeAll(async () => {
    // Garante usuários de teste
    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId1,
        groupId: 'test_group_rankings',
        name: 'Alpha Player Ranking Test',
      }),
    });

    await fetch(`${BASE_URL}/user/ensure`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId2,
        groupId: 'test_group_rankings',
        name: 'Beta Player Ranking Test',
      }),
    });

    // Configura harem-name para testUserId1
    await fetch(`${BASE_URL}/user/${testUserId1}/harem-name`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        haremName: 'Castelo Alpha Especial',
      }),
    });
  });

  it('GET /leaderboard/users anônimo deve incluir publicId, haremName e haremPrivate sem expor id', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/users?limit=10`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.topRich)).toBe(true);

    for (const u of json.data.topRich) {
      expect(u).not.toHaveProperty('id');
      expect(u).toHaveProperty('name');
      expect(u).toHaveProperty('publicId');
      expect(u).toHaveProperty('haremPrivate');
      expect(typeof u.haremPrivate).toBe('boolean');
    }
  });

  it('GET /leaderboard/users com parâmetro search deve filtrar por nome ou nome do harém', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/users?search=Alpha`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.topRich)).toBe(true);

    const found = json.data.topRich.find((u: any) => u.name.includes('Alpha') || (u.haremName && u.haremName.includes('Alpha')));
    expect(found).toBeDefined();
    expect(found.publicId).toBeDefined();
  });

  it('GET /leaderboard/harem anônimo deve incluir publicId, haremName e haremPrivate sem expor id ou platform', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/harem?limit=10`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.topHarem)).toBe(true);

    for (const u of json.data.topHarem) {
      expect(u).not.toHaveProperty('id');
      expect(u).not.toHaveProperty('platform');
      expect(u).toHaveProperty('name');
      expect(u).toHaveProperty('publicId');
      expect(u).toHaveProperty('haremPrivate');
      expect(u).toHaveProperty('collectionPoints');
      expect(u).toHaveProperty('totalMarriages');
    }
  });

  it('GET /leaderboard/harem com search aceita busca sem erros', async () => {
    const res = await fetch(`${BASE_URL}/leaderboard/harem?search=NonExistentSearchTerm123456`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.topHarem)).toBe(true);
    expect(json.data.topHarem.length).toBe(0);
  });
});
