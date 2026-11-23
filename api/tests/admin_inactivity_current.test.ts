import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

const SUFFIX = Date.now().toString(36);
const USER_A = `test_inact_a_${SUFFIX}`;
const USER_B = `test_inact_b_${SUFFIX}`;
const USER_C = `test_inact_c_${SUFFIX}`;
const DAY_MS = 24 * 3600 * 1000;

describe.skipIf(!process.env.DATABASE_URL)('GET /api/admin/inactivity/current', () => {
  let server: any;
  let adminToken: string;

  const charA = `test_inact_char_a_${SUFFIX}`;
  const charAMythic = `test_inact_mythic_${SUFFIX}`;
  const charB = `test_inact_char_b_${SUFFIX}`;
  const charC = `test_inact_char_c_${SUFFIX}`;
  const userIds = [USER_A, USER_B, USER_C];
  const charIds = [charA, charAMythic, charB, charC];

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    await server.ready();

    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: process.env.ADMIN_PASSWORD || 'waifupass123' },
    });
    const loginData = JSON.parse(loginRes.body);
    adminToken = loginData.data?.token || '';

    await server.prisma.character.create({
      data: { id: charA, name: 'Inatv Teste Common', series: 'Testes', baseRarity: 'COMMON' } as any,
    });
    await server.prisma.character.create({
      data: { id: charAMythic, name: 'Inatv Teste Mítico', series: 'Testes', baseRarity: 'EPIC', isMythic: true } as any,
    });
    await server.prisma.character.create({
      data: { id: charB, name: 'Inatv Teste Legendary', series: 'Testes', baseRarity: 'LEGENDARY' } as any,
    });
    await server.prisma.character.create({
      data: { id: charC, name: 'Inatv Teste Active', series: 'Testes', baseRarity: 'COMMON' } as any,
    });

    // Usuário A: inativo (4 dias), saldo 50, 1 COMMON + 1 Mítico (excluído)
    await server.prisma.user.create({
      data: { id: USER_A, name: 'Inatv Teste A', platform: 'WHATSAPP', kakera: 50, lastActiveAt: new Date(Date.now() - 4 * DAY_MS) },
    });
    await server.prisma.haremEntry.create({
      data: { userId: USER_A, characterId: charA, claimedInGroup: 'test_group_inact', keys: 1 },
    });
    await server.prisma.haremEntry.create({
      data: { userId: USER_A, characterId: charAMythic, claimedInGroup: 'test_group_inact', keys: 1 },
    });

    // Usuário B: inativo (10 dias), saldo 10M, 1 LEGENDARY -> nunca perde tudo
    await server.prisma.user.create({
      data: { id: USER_B, name: 'Inatv Teste B', platform: 'WHATSAPP', kakera: 10_000_000, lastActiveAt: new Date(Date.now() - 10 * DAY_MS) },
    });
    await server.prisma.haremEntry.create({
      data: { userId: USER_B, characterId: charB, claimedInGroup: 'test_group_inact', keys: 2 },
    });

    // Usuário C: ativo (1h) -> não deve aparecer
    await server.prisma.user.create({
      data: { id: USER_C, name: 'Inatv Teste C', platform: 'WHATSAPP', kakera: 500, lastActiveAt: new Date(Date.now() - 3600 * 1000) },
    });
    await server.prisma.haremEntry.create({
      data: { userId: USER_C, characterId: charC, claimedInGroup: 'test_group_inact', keys: 1 },
    });

    // Transações: 1 cobrança + 1 confisco por usuário inativo
    const becomeInactiveA = new Date(Date.now() - 4 * DAY_MS + 72 * 3600 * 1000);
    const becomeInactiveB = new Date(Date.now() - 10 * DAY_MS + 72 * 3600 * 1000);
    const createdAtA = new Date(Date.now() - 3600 * 1000);
    const createdAtB = new Date(Date.now() - 3600 * 1000);

    await server.prisma.kakeraTransaction.create({
      data: { userId: USER_A, amount: -120, reason: 'HOSTING_FEE', metadata: { feeDate: '2026-11-20' }, createdAt: createdAtA } as any,
    });
    await server.prisma.kakeraTransaction.create({
      data: { userId: USER_A, amount: 45, reason: 'HOSTING_FEE_WAIFU', metadata: { characterId: charA, characterName: 'Inatv Teste Common', rarity: 'COMMON' }, createdAt: createdAtA } as any,
    });
    await server.prisma.kakeraTransaction.create({
      data: { userId: USER_B, amount: -300, reason: 'HOSTING_FEE', metadata: { feeDate: '2026-11-20' }, createdAt: createdAtB } as any,
    });
    await server.prisma.kakeraTransaction.create({
      data: { userId: USER_B, amount: 90, reason: 'HOSTING_FEE_WAIFU', metadata: { characterId: charB, characterName: 'Inatv Teste Legendary', rarity: 'LEGENDARY' }, createdAt: createdAtB } as any,
    });

    // sanity: createdAt acima de becomeInactiveDate para os dois
    expect(createdAtA.getTime()).toBeGreaterThan(becomeInactiveA.getTime());
    expect(createdAtB.getTime()).toBeGreaterThan(becomeInactiveB.getTime());
  });

  afterAll(async () => {
    if (server?.prisma) {
      await server.prisma.haremEntry.deleteMany({ where: { userId: { in: userIds } } });
      await server.prisma.kakeraTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await server.prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await server.prisma.character.deleteMany({ where: { id: { in: charIds } } });
    }
    if (server) await server.close();
  });

  async function fetchCurrent(params = 'limit=100') {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/inactivity/current${params ? `?${params}` : ''}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body || '{}') };
  }

  it('deve retornar 401 sem autenticação administrativa', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/admin/inactivity/current' });
    expect(res.statusCode).toBe(401);
  });

  it('deve incluir jogadores inativos com os campos esperados (Míticos excluídos)', async () => {
    // Busca todas as páginas (jogadores indeterminados vêm por último e pode haver muitas páginas)
    const all: any[] = [];
    let page = 1;
    let lastBody: any = null;
    for (;;) {
      const { statusCode, body } = await fetchCurrent(`page=${page}&limit=100`);
      expect(statusCode).toBe(200);
      expect(body.success).toBe(true);
      all.push(...(body.data.items as any[]));
      lastBody = body;
      if (page >= body.data.pagination.totalPages) break;
      page++;
    }

    const items = all;
    const body = lastBody;
    const userA = items.find((i: any) => i.userId === USER_A);
    const userB = items.find((i: any) => i.userId === USER_B);

    expect(userA).toBeTruthy();
    expect(userB).toBeTruthy();

    // A: 1 COMMON (mítico excluído), 4 dias, saldo 50
    expect(userA.waifus).toBe(1);
    expect(userA.offlineDays).toBeGreaterThanOrEqual(3);
    expect(userA.balance).toBe(50);
    expect(userA.valueRemainingWithDiscount).toBeGreaterThan(0);
    expect(userA.chargedSinceInactive).toBe(120);
    expect(userA.totalConfiscatedValue).toBe(45);
    expect(userA.totalConfiscatedCount).toBe(1);
    expect(userA.dailyFee).toBeGreaterThan(0);
    expect(userA.multiplier).toBeGreaterThan(1);
    expect(typeof userA.estimatedDays).toBe('number');

    // B: saldo 10M, 1 LEGENDARY -> nunca perde tudo
    expect(userB.waifus).toBe(1);
    expect(userB.balance).toBe(10_000_000);
    expect(userB.valueRemainingWithDiscount).toBeGreaterThan(0);
    expect(userB.chargedSinceInactive).toBe(300);
    expect(userB.totalConfiscatedValue).toBe(90);
    expect(userB.totalConfiscatedCount).toBe(1);
    expect(userB.estimatedDays).toBeNull();

    // C: ativo, não aparece
    expect(items.find((i: any) => i.userId === USER_C)).toBeUndefined();

    expect(body.data.config?.graceHours).toBeGreaterThan(0);
  });

  it('deve respeitar paginação', async () => {
    const { statusCode, body } = await fetchCurrent('page=1&limit=1');
    expect(statusCode).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.pagination.total).toBeGreaterThanOrEqual(1);
    expect(body.data.pagination.page).toBe(1);
  });

  it('deve rejeitar parâmetros inválidos (page não inteiro)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/admin/inactivity/current?page=abc',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
