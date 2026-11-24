import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');
const BASE_URL = process.env.DATABASE_URL || '';
const TEST_DB = `econ_limits_test_${Date.now()}`;
const testUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
})();

const HOUR = 60 * 60 * 1000;
const TO = Date.now() - (Date.now() % HOUR);
const FROM = TO - HOUR;
const SUMMARY = `/internal/economy/summary?from=${FROM}&to=${TO}`;
const PLAYERS = `/internal/economy/players?from=${FROM}&to=${TO}`;
const HEADERS = { authorization: `Bearer ${API_KEY}` };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('limites das rotas internas da economia', () => {
  let root: PrismaClient;
  let db: PrismaClient;
  let server: any;
  let baseUrl = '';
  let dbCreated = false;
  const releases: Array<() => Promise<void>> = [];

  async function lockTable(table: 'kakera_transactions' | 'users') {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const held = db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
        locked();
        await gate;
      },
      { timeout: 60_000 }
    );
    await Promise.race([ready, held]);
    const release = async () => {
      open();
      await held;
    };
    releases.push(release);
    return release;
  }

  const blockedPids = async (): Promise<number[]> => {
    const rows = await db.$queryRaw<Array<{ pid: number }>>`
      SELECT pid FROM pg_stat_activity WHERE datname = ${TEST_DB} AND wait_event_type = 'Lock'`;
    return rows.map((r) => r.pid);
  };

  async function waitBlocked(count: number) {
    for (let i = 0; i < 100; i++) {
      if ((await blockedPids()).length >= count) return;
      await sleep(50);
    }
    throw new Error(`menos de ${count} consulta(s) presa(s) no bloqueio`);
  }

  const get = async (url: string) => {
    const res = await server.inject({ method: 'GET', url, headers: HEADERS });
    return { status: res.statusCode as number, code: res.json().error?.code as string | undefined };
  };

  const settledWithin = (requests: Promise<unknown>[], ms: number) => Promise.race([Promise.all(requests), sleep(ms)]);

  beforeAll(async () => {
    expect(API_KEY, 'API_KEY/API_KEYS precisa estar configurada para os testes').toBeTruthy();
    root = new PrismaClient({ datasources: { db: { url: BASE_URL } } });
    await root.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
    dbCreated = true;
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'ignore' });
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });

    process.env.DATABASE_URL = testUrl;
    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    baseUrl = await server.listen({ port: 0, host: '127.0.0.1' });

    await db.user.create({ data: { id: 'econ_lim_1', name: 'Limite 1', kakera: 100 } });
    await db.kakeraTransaction.create({
      data: { userId: 'econ_lim_1', amount: 100, reason: 'DAILY_REWARD', createdAt: new Date(FROM + 1000) },
    });
  }, 120_000);

  afterEach(async () => {
    await Promise.all(releases.splice(0).map((release) => release()));
  });

  afterAll(async () => {
    await server?.close();
    await db?.$disconnect();
    if (dbCreated) await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await root?.$disconnect();
  });

  describe.each([
    ['summary', SUMMARY],
    ['players', PLAYERS],
  ])('um pedido por vez em /internal/economy/%s', (_name, url) => {
    it('de seis pedidos simultâneos, um roda e cinco são recusados sem prender conexão', async () => {
      const release = await lockTable('kakera_transactions');
      const requests = Array.from({ length: 6 }, () => get(url));
      await waitBlocked(1);
      await settledWithin(requests.slice(1), 2000);
      const blocked = (await blockedPids()).length;
      await release();

      const results = await Promise.all(requests);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 429 && r.code === 'ECONOMY_BUSY')).toHaveLength(5);
      expect(blocked).toBe(1);

      expect((await get(url)).status).toBe(200);
    });

    it('pedidos em sequência são todos atendidos', async () => {
      for (let i = 0; i < 4; i++) expect((await get(url)).status).toBe(200);
    });

    it('a consulta cancelada no Postgres libera a vaga', async () => {
      const release = await lockTable('kakera_transactions');
      const first = get(url);
      await waitBlocked(1);
      for (const pid of await blockedPids()) await db.$queryRaw`SELECT pg_cancel_backend(${pid}::int)`;
      expect((await first).status).toBe(500);
      await release();

      expect((await get(url)).status).toBe(200);
    });

    it('cliente que desiste mantém a vaga só enquanto a consulta dele roda', async () => {
      const release = await lockTable('kakera_transactions');
      const abort = new AbortController();
      const first = fetch(`${baseUrl}${url}`, { headers: HEADERS, signal: abort.signal }).catch((err) => err.name);
      await waitBlocked(1);
      abort.abort();
      expect(await first).toBe('AbortError');

      const second = get(url);
      await settledWithin([second], 2000);
      await release();
      expect(await second).toEqual({ status: 429, code: 'ECONOMY_BUSY' });

      await expect.poll(async () => (await get(url)).status, { timeout: 5000 }).toBe(200);
    });
  });

  it('resumo e recorte por jogador não disputam a mesma vaga', async () => {
    const release = await lockTable('kakera_transactions');
    const requests = [get(SUMMARY), get(PLAYERS)];
    await waitBlocked(2);
    await release();

    expect((await Promise.all(requests)).map((r) => r.status)).toEqual([200, 200]);
  });

  it('janela inválida e parâmetros continuam respondendo com um resumo em andamento', async () => {
    const release = await lockTable('kakera_transactions');
    const running = get(SUMMARY);
    await waitBlocked(1);
    expect(await get(`/internal/economy/summary?from=${TO}&to=${FROM}`)).toEqual({ status: 400, code: 'INVALID_WINDOW' });
    expect((await get('/internal/economy/params')).status).toBe(200);
    await release();

    expect((await running).status).toBe(200);
  });

  it('o teto vale para o pedido inteiro, não por consulta, e libera a vaga', async () => {
    const { EconomySummaryService } = await import('../src/services/EconomySummaryService.js');
    const service = new EconomySummaryService(server.prisma, 3000);
    const releaseLedger = await lockTable('kakera_transactions');
    const releaseUsers = await lockTable('users');
    const outcome = service.getSummary(FROM, TO).then(
      () => 'concluído',
      (err) => err.meta?.code
    );
    await waitBlocked(1);
    await sleep(2000);
    await releaseLedger();
    await settledWithin([outcome], 2000);
    await releaseUsers();

    expect(await outcome).toBe('57014');
    expect((await service.getSummary(FROM, TO)).balances?.accounts).toBe(1);
  });
});
