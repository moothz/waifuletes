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

describe('User Audit Web Route (GET /api/admin/users/:userId/audit)', () => {
  let server: any;
  let adminToken: string;
  const testUserId = `test_audit_user_${Date.now()}`;
  const testCharacterId = `test_char_audit_${Date.now()}`;

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    await server.ready();

    // Cria sessão admin
    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: process.env.ADMIN_PASSWORD || 'waifupass123' },
    });
    const loginData = JSON.parse(loginRes.body);
    adminToken = loginData.data?.token || '';

    // Cria dados de teste
    await server.prisma.user.create({
      data: {
        id: testUserId,
        name: 'Audit Test User',
        platform: 'WHATSAPP',
        kakera: 50000,
      },
    });

    await server.prisma.character.create({
      data: {
        id: testCharacterId,
        name: 'Audit Test Character',
        series: 'Test Series',
        baseRarity: 'LEGENDARY',
        gender: 'FEMALE',
      },
    });

    // Cria 1 casamento
    await server.prisma.haremEntry.create({
      data: {
        userId: testUserId,
        characterId: testCharacterId,
        claimedInGroup: 'test_group_audit',
        keys: 2,
      },
    });

    // Cria 1 anúncio
    await server.prisma.marketListing.create({
      data: {
        userId: testUserId,
        characterId: testCharacterId,
        interest: 'Buscando 100k Zinthos',
        status: 'ACTIVE',
      },
    });

    // Cria 1 transação de kakera (ADMIN_GRANT)
    await server.prisma.kakeraTransaction.create({
      data: {
        userId: testUserId,
        amount: 5000,
        reason: 'ADMIN_GRANT',
        metadata: { characterName: 'Audit Test Character' },
      },
    });

    // Cria 1 divórcio
    await server.prisma.kakeraTransaction.create({
      data: {
        userId: testUserId,
        amount: 8500,
        reason: 'DIVORCE',
        metadata: {
          characterId: testCharacterId,
          characterName: 'Audit Test Character',
          rarity: 'LEGENDARY',
          keysAccumulated: 2,
          penaltyRate: '5%',
          dailyDivorceNumber: 1,
        },
      },
    });

    // Cria 1 soulmate
    await server.prisma.soulmate.create({
      data: {
        userId: testUserId,
        characterId: testCharacterId,
        alias: 'Amada Teste',
      },
    });
  });

  afterAll(async () => {
    if (server?.prisma) {
      await server.prisma.soulmate.deleteMany({ where: { userId: testUserId } });
      await server.prisma.haremEntry.deleteMany({ where: { userId: testUserId } });
      await server.prisma.marketListing.deleteMany({ where: { userId: testUserId } });
      await server.prisma.kakeraTransaction.deleteMany({ where: { userId: testUserId } });
      await server.prisma.character.deleteMany({ where: { id: testCharacterId } });
      await server.prisma.user.deleteMany({ where: { id: testUserId } });
    }
    if (server) {
      await server.close();
    }
  });

  it('deve retornar 401 sem autenticação administrativa', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('deve retornar 404 para usuário inexistente', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/admin/users/non_existent_user_99999/audit',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('USER_NOT_FOUND');
  });

  it('deve retornar auditoria completa unificada (type=ALL) com paginação e resumo', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=ALL&page=1&limit=10`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    const { summary, items, pagination, user } = body.data;
    expect(user.id).toBe(testUserId);
    expect(summary.days).toBe(30);
    expect(summary.marriagesCount).toBeGreaterThanOrEqual(1);
    expect(summary.divorcesCount).toBeGreaterThanOrEqual(1);
    expect(summary.marriagesByRarity.LEGENDARY).toBeGreaterThanOrEqual(1);
    expect(summary.listingsCount).toBeGreaterThanOrEqual(1);

    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(pagination.total).toBeGreaterThanOrEqual(4);

    // Valida estrutura dos itens
    const marriageItem = items.find((i: any) => i.category === 'MARRIAGE');
    expect(marriageItem).toBeDefined();
    expect(marriageItem.character.name).toBe('Audit Test Character');
    expect(marriageItem.character.rarity).toBe('LEGENDARY');
    expect(marriageItem.counterpart.group).toBe('test_group_audit');

    const divorceItem = items.find((i: any) => i.category === 'DIVORCE');
    expect(divorceItem).toBeDefined();
    expect(divorceItem.badge.label).toBe('Divórcio');
    expect(divorceItem.character.name).toBe('Audit Test Character');
    expect(divorceItem.details).toContain('Divórcio #1 no dia');

    const soulmateItem = items.find((i: any) => i.category === 'SOULMATE');
    expect(soulmateItem).toBeDefined();
    expect(soulmateItem.badge.label).toBe('Soulmate');
    expect(soulmateItem.details).toContain('Amada Teste');

    const listingItem = items.find((i: any) => i.category === 'LISTING');
    expect(listingItem).toBeDefined();
    expect(listingItem.currency.formatted).toContain('Buscando 100k Zinthos');
  });

  it('deve filtrar apenas casamentos quando type=MARRIAGES', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=MARRIAGES`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items.every((i: any) => i.category === 'MARRIAGE')).toBe(true);
  });

  it('deve filtrar apenas divórcios quando type=DIVORCES', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=DIVORCES`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(body.data.items.every((i: any) => i.category === 'DIVORCE')).toBe(true);
    expect(body.data.items[0].badge.label).toBe('Divórcio');
    expect(body.data.items[0].character.name).toBe('Audit Test Character');
  });

  it('deve filtrar apenas soulmates quando type=SOULMATES', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=SOULMATES`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(body.data.items.every((i: any) => i.category === 'SOULMATE')).toBe(true);
    expect(body.data.items[0].details).toContain('Amada Teste');
  });

  it('deve filtrar apenas anúncios quando type=LISTINGS', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=LISTINGS`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items.every((i: any) => i.category === 'LISTING')).toBe(true);
  });

  it('deve filtrar transações quando type=TRANSACTIONS', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=30&type=TRANSACTIONS`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('deve respeitar filtro de período days=0 (Hoje)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=0`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.summary.days).toBe(0);
    // Atividades criadas hoje nos testes devem aparecer
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('deve respeitar filtro de período (ex: days=15)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/users/${testUserId}/audit?days=15`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.summary.days).toBe(15);
  });
});
