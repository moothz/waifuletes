import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { publicCalculatorRoutes } from '../src/routes/public/calculator.js';

function createMockApp() {
  const app = Fastify();
  app.decorate('prisma', {
    user: {
      aggregate: async () => ({ _sum: { kakera: 100_000_000 } }),
    },
    marketOffer: {
      findMany: async () => [],
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('GROUP BY gender')) {
        return [
          { gender: 'FEMALE', count: 120n },
          { gender: 'MALE', count: 70n },
          { gender: 'OTHER', count: 10n },
        ];
      }
      return [
        { baseRarity: 'COMMON', total: 100n, claimed: 10n },
        { baseRarity: 'UNCOMMON', total: 50n, claimed: 5n },
        { baseRarity: 'RARE', total: 30n, claimed: 3n },
        { baseRarity: 'EPIC', total: 15n, claimed: 2n },
        { baseRarity: 'LEGENDARY', total: 5n, claimed: 1n },
      ];
    },
  } as any);
  app.decorate('redis', {
    get: async () => null,
    set: async () => 'OK',
  } as any);

  const publicDir = path.resolve(process.cwd(), 'public');
  app.register(fastifyStatic, { root: publicDir, prefix: '/', decorateReply: true });
  app.register(publicCalculatorRoutes);
  app.get('/calculadora-chances', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return reply.sendFile('calculadora-chances.html');
  });

  return app;
}

describe('🧮 Rota pública /public/calculator/constants e página /calculadora-chances', () => {
  it('deve retornar constantes públicas e macroeconomia sem PII', async () => {
    const app = createMockApp();
    const res = await app.inject({ method: 'GET', url: '/public/calculator/constants' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.pool.totalActive).toBe(200);
    expect(body.data.pool.byRarity.LEGENDARY.total).toBe(5);
    expect(body.data.macro.inflationMultiplier).toBeGreaterThan(1);
    expect(body.data.constants.legendaryChanceCap).toBeGreaterThan(0);
    expect(Array.isArray(body.data.constants.marriedKeyProgressionWeights)).toBe(true);
  });

  it('deve ignorar/sanitizar query params extras em /public/calculator/constants', async () => {
    const app = createMockApp();
    const res = await app.inject({ method: 'GET', url: '/public/calculator/constants?extra=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('deve servir a página /calculadora-chances com no-cache', async () => {
    const app = createMockApp();
    const res = await app.inject({ method: 'GET', url: '/calculadora-chances' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.body).toContain('Calculadora de Chances');
  });
});
