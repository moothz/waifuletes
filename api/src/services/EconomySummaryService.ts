import { Prisma, PrismaClient } from '@prisma/client';
import { DomainError } from '../errors/DomainError.js';

/**
 * Economia de Zinthos (tabela `users.kakera` + extrato `kakera_transactions`) para o painel da economia
 * da Ravena. `getSummary` traz só totais, contagens e faixas (quintos); `getPlayers` traz o recorte por
 * jogador (saldo e fluxos por motivo na janela), para a rota interna /internal/economy/players. As faixas saem sempre
 * preenchidas, mesmo com poucos membros: é moeda de jogo e identificar jogadores não é problema (decisão
 * do dono do produto). Toda a agregação é feita no Postgres.
 */

export const ECONOMY_SCHEMA_VERSION = 1;

/** `receivedByQuintile` só é calculado quando pedido (`received=1`) e para janelas de até 8 dias. */
export const RECEIVED_MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

/** Maior janela aceita em /internal/economy/players (8 dias). */
export const PLAYERS_MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

/** Tolerância de relógio para `to` no futuro. */
export const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Teto de cada pedido das rotas da economia (soma das consultas, por `statement_timeout` decrescente), abaixo
 * do timeout de 60 s da ravena: um pedido que passe disso é cancelado no Postgres em vez de seguir rodando depois
 * que a ravena desistiu. Não há teto de janela: a carga inicial da ravena pede [0, início do backfill) de uma vez.
 */
export const ECONOMY_STATEMENT_TIMEOUT_MS = 50_000;

/**
 * Confere a janela [from, to) das rotas da economia. Devolve a mensagem de erro (código INVALID_WINDOW) ou
 * null se a janela é válida. `maxWindowMs` limita o tamanho (rota por jogador).
 */
export function windowError(from: number, to: number, now: number, maxWindowMs?: number): string | null {
  if (!(to > from)) return '`to` deve ser maior que `from`.';
  if (to > now + FUTURE_TOLERANCE_MS) return '`to` não pode estar no futuro.';
  if (maxWindowMs !== undefined && to - from > maxWindowMs) return `A janela não pode passar de ${maxWindowMs / 86_400_000} dias.`;
  return null;
}

/**
 * O ADMIN_GRANT junta coisas diferentes (câmbio do banco da Ravena, bônus de doador, prêmio do caça-níquel,
 * edição no painel, concessão manual). Quem chama distingue pelo metadata: `metadata.reason` (banco da
 * Ravena: bank_withdraw_zinthos, bank_deposit_runas, ...) ou, na falta dele, `metadata.source`
 * (grantZinthos da Ravena: DONOR_BONUS, SLOTS_PRIZE; painel: admin_panel_edit). Nos fluxos o motivo vira
 * `ADMIN_GRANT:<valor em minúsculas>`; valor fora de [a-z0-9_]{1,64} vira `ADMIN_GRANT:other`, para que texto
 * livre do chamador não exploda a cardinalidade. Sem reason/source em texto, fica `ADMIN_GRANT`.
 */
export const ADMIN_GRANT_SUFFIX_MAX = 64;
const reasonKeySql = Prisma.sql`(
  CASE
    WHEN reason = 'ADMIN_GRANT' AND (
      (jsonb_typeof(metadata->'reason') = 'string' AND metadata->>'reason' <> '')
      OR (jsonb_typeof(metadata->'source') = 'string' AND metadata->>'source' <> '')
    ) THEN
      CASE
        WHEN lower(COALESCE(NULLIF(
               CASE WHEN jsonb_typeof(metadata->'reason') = 'string' THEN metadata->>'reason' END, ''),
               metadata->>'source')) ~ ${`^[a-z0-9_]{1,${ADMIN_GRANT_SUFFIX_MAX}}$`}
        THEN 'ADMIN_GRANT:' || lower(COALESCE(NULLIF(
               CASE WHEN jsonb_typeof(metadata->'reason') = 'string' THEN metadata->>'reason' END, ''),
               metadata->>'source'))
        ELSE 'ADMIN_GRANT:other'
      END
    ELSE reason::text
  END
)`;

/**
 * Motivos (já com o sufixo do ADMIN_GRANT) que criam moeda nova e entram em `receivedByQuintile`.
 * Ficam de fora:
 * - ADMIN_GRANT e os demais ADMIN_GRANT:*: câmbio do banco (bank_*), edição do painel, concessões manuais e
 *   valores desconhecidos não são criação clara;
 * - MARKET_TRADE: transferência entre jogadores;
 * - MARKET_BUY e HOSTING_FEE: saídas;
 * - HOSTING_FEE_WAIFU: registra o valor de waifus confiscadas abatido da dívida, não é crédito no saldo.
 */
export const CREATION_REASONS = [
  'DAILY_REWARD',
  'ROLL_CRYSTAL',
  'DIVORCE',
  'EVENT_REWARD',
  'WISHLIST_BONUS',
  'SOULMATE_BONUS',
  'MARKET_REFUND',
  'ADMIN_GRANT:donor_bonus',
  'ADMIN_GRANT:slots_prize',
] as const;

export interface EconomyFlow {
  hour: number;
  reason: string;
  amountIn: number;
  amountOut: number;
  count: number;
  users: number;
}

export interface EconomyQuintile {
  q: number;
  n: number;
  min: number | null;
  max: number | null;
  sum: number | null;
}

export interface EconomyReceivedQuintile {
  q: number;
  n: number;
  receivedSum: number | null;
  receivedMedian: number | null;
}

/**
 * Ciclo da alma gêmea por hora (UTC): divórcios de almas gêmeas na janela e quanto o jogador gastou
 * comprando as próprias cotas daquele personagem (MARKET_BUY com metadata.type = MARRIED_SHARE_PURCHASE)
 * desde o divórcio anterior do mesmo personagem (ou desde sempre, no primeiro ciclo).
 * - paid: soma do que os divórcios pagaram;
 * - quotaCost: soma do custo das cotas do ciclo de cada divórcio;
 * - aboveCost: divórcios com custo de cotas > 0 que pagaram MAIS que esse custo (o ciclo deu lucro);
 * - withoutQuota: divórcios sem cotas compradas no ciclo (custo 0): não entram em aboveCost nem em maxReturn;
 * - maxReturn: maior paid/quotaCost entre os divórcios com custo > 0 (null se nenhum).
 * Fora da conta (o custo sai menor que o real ou o ciclo não aparece):
 * - cotas compradas como investimento (MARKET_BUY com metadata.type = INVESTMENT_SHARE_PURCHASE) antes de casar
 *   com o personagem, que viram cotas do casamento;
 * - divórcio feito pelo admin, que não gera linha DIVORCE no extrato;
 * - waifu confiscada pela taxa de hospedagem (HOSTING_FEE_WAIFU), que encerra o ciclo sem divórcio.
 */
export interface EconomySoulmateCycleHour {
  hour: number;
  divorces: number;
  paid: number;
  quotaCost: number;
  aboveCost: number;
  withoutQuota: number;
  maxReturn: number | null;
}

export interface EconomySummary {
  currency: 'zinthos';
  schemaVersion: number;
  generatedAt: number;
  window: { from: number; to: number };
  ledger: { available: boolean; flows: EconomyFlow[] };
  /** null quando pedido com balances=0 (pedaços históricos da carga inicial). */
  balances: {
    total: number;
    totalAtWindowEnd: number;
    holders: number;
    accounts: number;
    p50: number | null;
    p90: number | null;
    top10Share: number | null;
    quintiles: EconomyQuintile[];
  } | null;
  receivedByQuintile: EconomyReceivedQuintile[];
  /** Sempre presente (também com balances=0); [] quando não há divórcio de alma gêmea na janela. */
  soulmateCycle: EconomySoulmateCycleHour[];
}

export interface EconomyPlayer {
  id: string;
  name: string;
  platform: string;
  balance: number;
  /** Saldo reconstruído no instante `to` (mesma regra de balances.totalAtWindowEnd). */
  balanceAtWindowEnd: number;
  lastActiveAt: number | null;
}

/** Fluxo de um jogador num motivo (mesma chave de motivo de ledger.flows), somado na janela inteira. */
export interface EconomyPlayerFlow {
  id: string;
  reason: string;
  amountIn: number;
  amountOut: number;
  count: number;
}

export interface EconomyPlayers {
  currency: 'zinthos';
  schemaVersion: number;
  generatedAt: number;
  window: { from: number; to: number };
  ledger: { available: true };
  players: EconomyPlayer[];
  flows: EconomyPlayerFlow[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Converte epoch em ms para `timestamp` (sem fuso, em UTC) com aritmética inteira, sem depender do fuso da sessão. */
const tsFromMs = (ms: number) => Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + (${BigInt(ms)}::bigint * INTERVAL '1 millisecond'))`;

export class EconomySummaryService {
  private readonly running = new Set<'summary' | 'players'>();

  constructor(
    private prisma: PrismaClient,
    private timeoutMs: number = ECONOMY_STATEMENT_TIMEOUT_MS
  ) {}

  /**
   * Roda as consultas num único retrato (REPEATABLE READ), em transação somente leitura, uma transação por
   * rota de cada vez (senão ECONOMY_BUSY) e com teto de `timeoutMs` para a soma das consultas. Devolve só os
   * resultados das consultas.
   */
  private async readOnlySnapshot(route: 'summary' | 'players', queries: any[]): Promise<any[][]> {
    if (this.running.has(route)) {
      throw new DomainError('ECONOMY_BUSY', 'Já há um pedido desta rota em andamento. Tente de novo em instantes.', 429);
    }
    this.running.add(route);
    try {
      const setup = [
        this.prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
        this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(this.timeoutMs)}`),
      ];
      const steps = queries.flatMap((query, i) => (i === 0 ? [query] : [this.useRemainingTimeout(), query]));
      const results = (await this.prisma.$transaction([...setup, ...steps] as any, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      })) as any[];
      return results.slice(setup.length).filter((_, i) => i % 2 === 0) as any[][];
    } finally {
      this.running.delete(route);
    }
  }

  private useRemainingTimeout() {
    return this.prisma.$queryRaw`
      SELECT set_config(
        'statement_timeout',
        GREATEST(1, ${Math.trunc(this.timeoutMs)}::int
          - (EXTRACT(EPOCH FROM clock_timestamp() - transaction_timestamp()) * 1000)::int)::text,
        true
      )
    `;
  }

  async getSummary(
    from: number,
    to: number,
    now: number = Date.now(),
    opts: { received?: boolean; balances?: boolean } = {}
  ): Promise<EconomySummary> {
    // balances=false pula o retrato (saldos, quintos, totalAtWindowEnd) e, como as faixas de
    // receivedByQuintile vêm do mesmo retrato, também receivedByQuintile (vem []).
    const includeBalances = opts.balances !== false;
    const fromTs = tsFromMs(from);
    const toTs = tsFromMs(to);
    const includeReceived = includeBalances && Boolean(opts.received) && to - from <= RECEIVED_MAX_WINDOW_MS;

    // Fluxos do extrato por hora (UTC) e motivo.
    const flowsQuery = this.prisma.$queryRaw<
      Array<{ hour: bigint; reason: string; amount_in: bigint; amount_out: bigint; tx_count: bigint; users: bigint }>
    >`
      SELECT
        (EXTRACT(EPOCH FROM date_trunc('hour', "createdAt"))::bigint * 1000) AS hour,
        ${reasonKeySql} AS reason,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::bigint AS amount_in,
        COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::bigint AS amount_out,
        COUNT(*)::bigint AS tx_count,
        COUNT(DISTINCT "userId")::bigint AS users
      FROM kakera_transactions
      WHERE "createdAt" >= ${fromTs} AND "createdAt" < ${toTs}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    // Retrato dos saldos: total e contas (todas), estatísticas entre quem tem saldo > 0.
    // totalAtWindowEnd: massa no instante `to`, reconstruída pelo extrato = total atual − Σ amount com
    // createdAt >= to (usa o índice de createdAt). Alinha a massa com o corte dos fluxos na hora exata.
    // HOSTING_FEE_WAIFU fica de fora da soma: registra o valor da waifu confiscada abatido da dívida e nunca
    // creditou o saldo.
    // Ressalva: só desconta o que tem linha no extrato. Mudanças de saldo sem extrato feitas depois de `to`
    // (ex.: /admin/kakera/give-all, exclusão de usuário, sobra do confisco da taxa de hospedagem) aparecem
    // como se já existissem em `to`, ou seja, caem no período anterior ao corte.
    const totalsQuery = this.prisma.$queryRaw<Array<{ total: bigint; accounts: bigint; after_to: bigint }>>`
      SELECT
        COALESCE(SUM(kakera), 0)::bigint AS total,
        COUNT(*)::bigint AS accounts,
        (SELECT COALESCE(SUM(amount), 0)::bigint FROM kakera_transactions
         WHERE "createdAt" >= ${toTs} AND reason <> 'HOSTING_FEE_WAIFU') AS after_to
      FROM users
    `;
    const holdersQuery = this.prisma.$queryRaw<
      Array<{ holders: bigint; mass: bigint; top_mass: bigint; p50: number | null; p90: number | null }>
    >`
      WITH h AS (
        SELECT kakera,
               row_number() OVER (ORDER BY kakera DESC, id) AS rn,
               COUNT(*) OVER () AS cnt
        FROM users WHERE kakera > 0
      )
      SELECT
        COUNT(*)::bigint AS holders,
        COALESCE(SUM(kakera), 0)::bigint AS mass,
        COALESCE(SUM(kakera) FILTER (WHERE rn <= CEIL(cnt * 0.1)), 0)::bigint AS top_mass,
        percentile_disc(0.5) WITHIN GROUP (ORDER BY kakera) AS p50,
        percentile_disc(0.9) WITHIN GROUP (ORDER BY kakera) AS p90
      FROM h
    `;
    // Quintos por saldo, da menor para a maior faixa. O desempate por id deixa as faixas determinísticas
    // e iguais às usadas em receivedByQuintile.
    const quintilesQuery = this.prisma.$queryRaw<
      Array<{ q: number; n: bigint; min: number; max: number; sum: bigint }>
    >`
      WITH h AS (
        SELECT kakera, ntile(5) OVER (ORDER BY kakera, id) AS q FROM users WHERE kakera > 0
      )
      SELECT q::int AS q, COUNT(*)::bigint AS n, MIN(kakera) AS min, MAX(kakera) AS max, SUM(kakera)::bigint AS sum
      FROM h GROUP BY q ORDER BY q
    `;
    // Entradas de motivos de criação na janela, por faixa de saldo atual. A mediana considera todos os
    // membros da faixa (quem não recebeu nada conta como 0).
    const receivedQuery = this.prisma.$queryRaw<
      Array<{ q: number; n: bigint; received_sum: bigint; received_median: bigint | null }>
    >`
      WITH h AS (
        SELECT id, ntile(5) OVER (ORDER BY kakera, id) AS q FROM users WHERE kakera > 0
      ),
      r AS (
        SELECT "userId", SUM(amount)::bigint AS received
        FROM kakera_transactions
        WHERE "createdAt" >= ${fromTs} AND "createdAt" < ${toTs}
          AND amount > 0
          AND ${reasonKeySql} IN (${Prisma.join([...CREATION_REASONS])})
        GROUP BY "userId"
      ),
      m AS (
        SELECT h.q, COALESCE(r.received, 0)::bigint AS received FROM h LEFT JOIN r ON r."userId" = h.id
      )
      SELECT q::int AS q, COUNT(*)::bigint AS n, SUM(received)::bigint AS received_sum,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY received) AS received_median
      FROM m GROUP BY q ORDER BY q
    `;

    // Ciclo da alma gêmea: cada divórcio de alma gêmea na janela, com o custo das cotas compradas pelo
    // próprio dono daquele personagem desde o divórcio anterior dele (mesmo usuário e personagem, de alma
    // gêmea ou não). Os dois LATERAL usam o índice (userId, createdAt) do extrato.
    const soulmateQuery = this.prisma.$queryRaw<
      Array<{
        hour: bigint;
        divorces: bigint;
        paid: bigint;
        quota_cost: bigint;
        above_cost: bigint;
        without_quota: bigint;
        max_return: number | null;
      }>
    >`
      SELECT
        (EXTRACT(EPOCH FROM date_trunc('hour', d."createdAt"))::bigint * 1000) AS hour,
        COUNT(*)::bigint AS divorces,
        COALESCE(SUM(d.amount), 0)::bigint AS paid,
        COALESCE(SUM(c.cost), 0)::bigint AS quota_cost,
        COUNT(*) FILTER (WHERE c.cost > 0 AND d.amount > c.cost)::bigint AS above_cost,
        COUNT(*) FILTER (WHERE c.cost <= 0)::bigint AS without_quota,
        MAX(d.amount::float8 / NULLIF(c.cost, 0)) FILTER (WHERE c.cost > 0) AS max_return
      FROM kakera_transactions d
      CROSS JOIN LATERAL (
        SELECT MAX(p."createdAt") AS at
        FROM kakera_transactions p
        WHERE p."userId" = d."userId"
          AND p."createdAt" < d."createdAt"
          AND p.reason = 'DIVORCE'
          AND p.metadata->>'characterId' = d.metadata->>'characterId'
      ) prev
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(-b.amount), 0)::bigint AS cost
        FROM kakera_transactions b
        WHERE b."userId" = d."userId"
          AND b."createdAt" < d."createdAt"
          AND b."createdAt" > COALESCE(prev.at, '-infinity'::timestamp)
          AND b.reason = 'MARKET_BUY'
          AND b.metadata->>'type' = 'MARRIED_SHARE_PURCHASE'
          AND b.metadata->>'characterId' = d.metadata->>'characterId'
      ) c
      WHERE d."createdAt" >= ${fromTs} AND d."createdAt" < ${toTs}
        AND d.reason = 'DIVORCE'
        AND d.metadata->>'isSoulmate' = 'true'
      GROUP BY 1
      ORDER BY 1
    `;

    // Um único retrato (REPEATABLE READ): as faixas de balances e de receivedByQuintile batem entre si.
    // Sem o retrato, só as consultas do extrato (fluxos e ciclo da alma gêmea) rodam (os demais $queryRaw não
    // executados nunca vão ao banco).
    const queries: any[] = [flowsQuery, soulmateQuery];
    if (includeBalances) queries.push(totalsQuery, holdersQuery, quintilesQuery);
    if (includeReceived) queries.push(receivedQuery);
    const results = await this.readOnlySnapshot('summary', queries);
    const [flowRows, soulmateRows, totalsRows = [], holdersRows = [], quintileRows = [], receivedRows = []] = results;

    const flows: EconomyFlow[] = flowRows.map((r) => ({
      hour: num(r.hour),
      reason: r.reason,
      amountIn: num(r.amount_in),
      amountOut: num(r.amount_out),
      count: num(r.tx_count),
      users: num(r.users),
    }));

    const soulmateCycle: EconomySoulmateCycleHour[] = soulmateRows.map((r) => ({
      hour: num(r.hour),
      divorces: num(r.divorces),
      paid: num(r.paid),
      quotaCost: num(r.quota_cost),
      aboveCost: num(r.above_cost),
      withoutQuota: num(r.without_quota),
      maxReturn: numOrNull(r.max_return),
    }));

    const totals = totalsRows[0] || {};
    const hs = holdersRows[0] || {};
    const holders = num(hs.holders);
    const mass = num(hs.mass);

    const quintiles: EconomyQuintile[] = [1, 2, 3, 4, 5].map((q) => {
      const row = quintileRows.find((r) => Number(r.q) === q);
      // Faixa sem membros (menos de 5 holders) vem com n=0 e valores nulos.
      return {
        q,
        n: row ? num(row.n) : 0,
        min: row ? numOrNull(row.min) : null,
        max: row ? numOrNull(row.max) : null,
        sum: row ? numOrNull(row.sum) : null,
      };
    });

    const receivedByQuintile: EconomyReceivedQuintile[] = includeReceived
      ? [1, 2, 3, 4, 5].map((q) => {
          const row = receivedRows.find((r) => Number(r.q) === q);
          return {
            q,
            n: row ? num(row.n) : 0,
            receivedSum: row ? numOrNull(row.received_sum) : null,
            receivedMedian: row ? numOrNull(row.received_median) : null,
          };
        })
      : [];

    return {
      currency: 'zinthos',
      schemaVersion: ECONOMY_SCHEMA_VERSION,
      generatedAt: now,
      window: { from, to },
      ledger: { available: true, flows },
      balances: includeBalances
        ? {
            total: num(totals.total),
            totalAtWindowEnd: num(totals.total) - num(totals.after_to),
            holders,
            accounts: num(totals.accounts),
            p50: holders > 0 ? numOrNull(hs.p50) : null,
            p90: holders > 0 ? numOrNull(hs.p90) : null,
            top10Share: mass > 0 ? num(hs.top_mass) / mass : null,
            quintiles,
          }
        : null,
      receivedByQuintile,
      soulmateCycle,
    };
  }

  /**
   * Recorte por jogador para o painel: todo usuário com saldo atual diferente de zero, com saldo no fim da
   * janela (balanceAtWindowEnd) diferente de zero ou com pelo menos uma linha do extrato em [from, to), e os fluxos de cada um por motivo na janela. A soma dos fluxos de todos os
   * jogadores bate com a soma de ledger.flows do resumo na mesma janela (mesma chave de motivo).
   */
  async getPlayers(from: number, to: number, now: number = Date.now()): Promise<EconomyPlayers> {
    const fromTs = tsFromMs(from);
    const toTs = tsFromMs(to);

    // balanceAtWindowEnd: saldo atual − Σ amount do jogador com createdAt >= to, sem HOSTING_FEE_WAIFU
    // (mesma regra e mesma ressalva de balances.totalAtWindowEnd).
    const playersQuery = this.prisma.$queryRaw<
      Array<{ id: string; name: string; platform: string; balance: bigint; balance_at_end: bigint; last_active_at: bigint | null }>
    >`
      SELECT
        u.id,
        u.name,
        u.platform::text AS platform,
        u.kakera::bigint AS balance,
        (u.kakera - COALESCE(a.after_to, 0))::bigint AS balance_at_end,
        (EXTRACT(EPOCH FROM u.last_active_at) * 1000)::bigint AS last_active_at
      FROM users u
      LEFT JOIN (
        SELECT "userId", SUM(amount)::bigint AS after_to
        FROM kakera_transactions
        WHERE "createdAt" >= ${toTs} AND reason <> 'HOSTING_FEE_WAIFU'
        GROUP BY "userId"
      ) a ON a."userId" = u.id
      WHERE u.kakera <> 0
         -- Tinha saldo no fim da janela e gastou tudo depois: entra no dia mesmo sem movimento nele.
         OR u.kakera - COALESCE(a.after_to, 0) <> 0
         OR EXISTS (
           SELECT 1 FROM kakera_transactions t
           WHERE t."userId" = u.id AND t."createdAt" >= ${fromTs} AND t."createdAt" < ${toTs}
         )
      ORDER BY u.id
    `;
    const flowsQuery = this.prisma.$queryRaw<
      Array<{ id: string; reason: string; amount_in: bigint; amount_out: bigint; tx_count: bigint }>
    >`
      SELECT
        "userId" AS id,
        ${reasonKeySql} AS reason,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::bigint AS amount_in,
        COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::bigint AS amount_out,
        COUNT(*)::bigint AS tx_count
      FROM kakera_transactions
      WHERE "createdAt" >= ${fromTs} AND "createdAt" < ${toTs}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    // Um único retrato (REPEATABLE READ): todo jogador com fluxo na janela está em players.
    const [playerRows, flowRows] = await this.readOnlySnapshot('players', [playersQuery, flowsQuery]);

    return {
      currency: 'zinthos',
      schemaVersion: ECONOMY_SCHEMA_VERSION,
      generatedAt: now,
      window: { from, to },
      ledger: { available: true },
      players: playerRows.map((r) => ({
        id: r.id,
        name: r.name,
        platform: r.platform,
        balance: num(r.balance),
        balanceAtWindowEnd: num(r.balance_at_end),
        lastActiveAt: numOrNull(r.last_active_at),
      })),
      flows: flowRows.map((r) => ({
        id: r.id,
        reason: r.reason,
        amountIn: num(r.amount_in),
        amountOut: num(r.amount_out),
        count: num(r.tx_count),
      })),
    };
  }
}
