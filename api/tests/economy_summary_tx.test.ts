import { describe, it, expect } from 'vitest';
import {
  ECONOMY_STATEMENT_TIMEOUT_MS,
  EconomySummaryService,
  PLAYERS_MAX_WINDOW_MS,
  windowError,
} from '../src/services/EconomySummaryService.js';

// Sem banco: um Prisma falso registra o que a rota manda para a transação.
function fakePrisma() {
  const calls: { setup: string[]; isolationLevel?: string; size?: number } = { setup: [] };
  const prisma: any = {
    $executeRawUnsafe: (sql: string) => {
      calls.setup.push(sql);
      return { setup: sql };
    },
    $queryRaw: () => ({ query: true }),
    $transaction: async (ops: any[], opts: any) => {
      calls.isolationLevel = opts?.isolationLevel;
      calls.size = ops.length;
      // A ordem importa: SET TRANSACTION só vale antes de qualquer consulta.
      expect(ops.slice(0, 2).every((o) => o.setup)).toBe(true);
      return ops.map((o) => (o.setup ? 0 : []));
    },
  };
  return { prisma, calls };
}

describe('rotas da economia: transação somente leitura e com teto de tempo', () => {
  it('o teto fica abaixo do timeout de 60 s da ravena', () => {
    expect(ECONOMY_STATEMENT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ECONOMY_STATEMENT_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it.each([
    ['getSummary', (s: EconomySummaryService) => s.getSummary(0, 1000, 1000, { received: true }), 2 + 6 + 5],
    ['getSummary balances=0', (s: EconomySummaryService) => s.getSummary(0, 1000, 1000, { balances: false }), 2 + 2 + 1],
    ['getPlayers', (s: EconomySummaryService) => s.getPlayers(0, 1000, 1000), 2 + 2 + 1],
  ])('%s abre READ ONLY + statement_timeout antes das consultas, em REPEATABLE READ', async (_label, run, size) => {
    const { prisma, calls } = fakePrisma();
    await run(new EconomySummaryService(prisma));
    expect(calls.setup).toEqual(['SET TRANSACTION READ ONLY', `SET LOCAL statement_timeout = ${ECONOMY_STATEMENT_TIMEOUT_MS}`]);
    expect(calls.isolationLevel).toBe('RepeatableRead');
    expect(calls.size).toBe(size);
  });
});

describe('windowError', () => {
  const NOW = 1_763_400_000_000;
  it('aceita janela válida (inclusive from=0 sem teto) e to até agora + 60 s', () => {
    expect(windowError(0, NOW, NOW)).toBeNull();
    expect(windowError(NOW - 1, NOW + 60_000, NOW)).toBeNull();
    expect(windowError(NOW - PLAYERS_MAX_WINDOW_MS, NOW, NOW, PLAYERS_MAX_WINDOW_MS)).toBeNull();
  });
  it('recusa to <= from, to no futuro e janela acima do teto', () => {
    expect(windowError(10, 10, NOW)).toMatch(/maior que/);
    expect(windowError(11, 10, NOW)).toMatch(/maior que/);
    expect(windowError(0, NOW + 60_001, NOW)).toMatch(/futuro/);
    expect(windowError(NOW - PLAYERS_MAX_WINDOW_MS - 1, NOW, NOW, PLAYERS_MAX_WINDOW_MS)).toBe('A janela não pode passar de 8 dias.');
  });
});
