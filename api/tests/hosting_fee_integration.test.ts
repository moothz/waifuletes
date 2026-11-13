import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { HostingFeeService } from '../src/services/HostingFeeService.js';
import { activeHostingRates } from '../src/config.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

/**
 * Integração da taxa de hospedagem com PostgreSQL/Redis reais. A cobrança é exercitada por jogador
 * (chargeUser) para não afetar dados de outras suítes que rodam em paralelo.
 */
const DATABASE_URL = process.env.DATABASE_URL?.replace('postgres:5432', '127.0.0.1:5433');
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!DATABASE_URL || !REDIS_URL)('🏠 Taxa de hospedagem — integração', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let service: HostingFeeService;

  const SUFFIX = Date.now().toString(36);
  const RICH = `test_host_rich_${SUFFIX}`;
  const POOR = `test_host_poor_${SUFFIX}`;
  const USERS = [RICH, POOR];
  const charIds: string[] = [];
  let mythicId = '';
  const dateStr = new Date().toISOString().slice(0, 10);

  const ctx = () => ({
    now: new Date(),
    dateStr,
    graceMs: 72 * 3600 * 1000,
    confiscoRatio: 0.3,
    inflationMultiplier: 1,
    dryRun: false,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    redis = new Redis(REDIS_URL!);
    service = new HostingFeeService(prisma, redis);

    // Personagens próprios do teste (não disputa personagens com outras suítes em paralelo)
    const rarities = ['COMMON', 'UNCOMMON', 'RARE'];
    for (let i = 0; i < 3; i++) {
      const id = `test_host_char_${i}_${SUFFIX}`;
      await prisma.character.create({
        data: { id, name: `Personagem Teste Hospedagem ${i}`, series: 'Testes', baseRarity: rarities[i] } as any,
      });
      charIds.push(id);
    }

    mythicId = `test_host_mythic_${SUFFIX}`;
    await prisma.character.create({
      data: {
        id: mythicId,
        name: 'Mítico de Teste Hospedagem',
        series: 'Testes',
        baseRarity: 'RARE',
        isMythic: true,
      } as any,
    });

    for (const id of USERS) {
      await prisma.user.create({ data: { id, name: id, kakera: 0, lastActiveAt: new Date() } });
    }
  });

  afterAll(async () => {
    await prisma.haremEntry.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.kakeraTransaction.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.userNotification.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
    await prisma.character.deleteMany({ where: { id: { in: [mythicId, ...charIds] } } });
    await redis.quit();
    await prisma.$disconnect();
  });

  it('cobra uma vez por dia com débito relativo e não cobra Míticos', async () => {
    await prisma.user.update({ where: { id: RICH }, data: { kakera: 10_000 } });
    await prisma.haremEntry.create({ data: { userId: RICH, characterId: charIds[0], claimedInGroup: 'test_group_host' } });
    await prisma.haremEntry.create({ data: { userId: RICH, characterId: mythicId, claimedInGroup: 'test_group_host' } });
    const rarity = (await prisma.character.findUnique({ where: { id: charIds[0] } }))!.baseRarity;
    const expectedFee = activeHostingRates[rarity];

    const first = await (service as any).chargeUser(RICH, ctx());
    expect(first.charged).toBe(true);
    expect(first.totalFee).toBe(expectedFee); // o Mítico não entra na conta
    expect(first.waifusCount).toBe(1);

    // Saldo muda depois da cobrança (ex.: ganho num roll): a cobrança não pode sobrescrevê-lo
    await prisma.user.update({ where: { id: RICH }, data: { kakera: { increment: 500 } } });

    const second = await (service as any).chargeUser(RICH, ctx());
    expect(second.alreadyCharged).toBe(true);

    const rich = await prisma.user.findUnique({ where: { id: RICH } });
    expect(rich!.kakera).toBe(10_000 - expectedFee + 500);
    // O Mítico continua no harém
    expect(await prisma.haremEntry.count({ where: { userId: RICH, characterId: mythicId } })).toBe(1);
  });

  it('sem saldo: confisca da menos valiosa, só entradas do próprio jogador, e credita a sobra de forma relativa', async () => {
    await prisma.user.update({ where: { id: POOR }, data: { kakera: 0, lastActiveAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) } });
    await prisma.haremEntry.create({ data: { userId: POOR, characterId: charIds[1], claimedInGroup: 'test_group_host' } });
    await prisma.haremEntry.create({ data: { userId: POOR, characterId: charIds[2], claimedInGroup: 'test_group_host' } });

    const result = await (service as any).chargeUser(POOR, ctx());
    expect(result.charged).toBe(true);
    expect(result.isInactive).toBe(true);
    expect(result.debited).toBe(0);
    expect(result.confiscated.length).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.haremEntry.count({ where: { userId: POOR } });
    expect(remaining).toBe(2 - result.confiscated.length);

    const poor = await prisma.user.findUnique({ where: { id: POOR } });
    expect(poor!.kakera).toBe(result.finalBalance);
    expect(poor!.kakera).toBeGreaterThanOrEqual(0);

    // Reexecução no mesmo dia (ex.: force após falha) não confisca de novo
    const again = await (service as any).chargeUser(POOR, ctx());
    expect(again.alreadyCharged).toBe(true);
    expect(await prisma.haremEntry.count({ where: { userId: POOR } })).toBe(remaining);
  });

  it('trava de execução: duas execuções simultâneas não rodam juntas', async () => {
    const isolatedRedis = new Redis(REDIS_URL!);
    const fakePrisma: any = { user: { findMany: async () => { await new Promise((r) => setTimeout(r, 150)); return []; } } };
    const svc = new HostingFeeService(fakePrisma, isolatedRedis);
    const lockKey = `hosting:fee:lock:${dateStr}`;
    const previous = await isolatedRedis.get(lockKey);
    await isolatedRedis.del(lockKey);
    try {
      const results = await Promise.allSettled([svc.runDailyFee(), svc.runDailyFee()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await isolatedRedis.get(lockKey)).toBe('done');
      // Sem force, uma nova execução no mesmo dia é recusada
      await expect(svc.runDailyFee()).rejects.toThrow(/já foi executada/);
    } finally {
      if (previous) await isolatedRedis.set(lockKey, previous, 'EX', 23 * 3600);
      else await isolatedRedis.del(lockKey);
      await isolatedRedis.quit();
    }
  });
});
