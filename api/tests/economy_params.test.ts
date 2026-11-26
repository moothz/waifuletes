import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance } from 'fastify';

// A rota não toca no banco: o servidor de teste registra só o plugin de economia (com a mesma autenticação
// por API key da rota de resumo). A chave precisa existir antes de config.ts ser importado.
if (!process.env.API_KEYS && !process.env.API_KEY) {
  process.env.API_KEYS = 'test_key_economy_params_0123456789abcdef';
}
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

const { privateEconomyRoutes } = await import('../src/routes/private/economy.js');
const { buildEconomyParams } = await import('../src/utils/economyParams.js');
const { config, activeHostingRates, inactiveHostingRates } = await import('../src/config.js');
const rarity = await import('../src/utils/rarityCalculator.js');
const cooldown = await import('../src/services/CooldownService.js');
const market = await import('../src/services/MarketInvestmentService.js');
const marketplace = await import('../src/services/MarketService.js');
const kakera = await import('../src/services/KakeraService.js');

const ROUTE = '/internal/economy/params';
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Arquivos de onde saem as constantes de balanceamento. Toda `export const NOME_EM_MAIUSCULAS` deles, e toda
 * `const NOME_EM_MAIUSCULAS = <número>` sem export, precisa estar na rota ou em IGNORED_CONSTANTS; toda chave
 * de config.ts, na rota ou em IGNORED_CONFIG_KEYS.
 */
const SOURCE_FILES = [
  'src/utils/rarityCalculator.ts',
  'src/services/CooldownService.ts',
  'src/services/MarketInvestmentService.ts',
  'src/services/HostingFeeService.ts',
  'src/services/MarketService.ts',
  'src/services/RollService.ts',
  'src/services/MarryService.ts',
  'src/services/KakeraService.ts',
  'src/config.ts',
];

const IGNORED_CONSTANTS: Record<string, string> = {
  ALL_RARITIES: 'lista das raridades (enum), não é valor de balanceamento',
  SOULMATE_RANKING_SCORES: 'pontuação de ranking de soulmates por raridade',
  UNLISTED_OFFER_REJECTION_REASON: 'texto do motivo de recusa de oferta',
  UNLISTED_OFFER_REJECTION_DATA: 'campos gravados na oferta recusada, sem valor de moeda',
  RUN_LOCK_TTL_SECONDS: 'trava de execução da taxa de hospedagem (infraestrutura)',
  DONE_LOCK_TTL_SECONDS: 'marca de "já executado hoje" da taxa de hospedagem (infraestrutura)',
  TX_TIMEOUT_MS: 'timeout da transação da taxa de hospedagem (infraestrutura)',
};

const IGNORED_CONFIG_KEYS: Record<string, string> = {
  COOLDOWN_CLAIM_SECONDS_COMMON: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.COMMON',
  COOLDOWN_CLAIM_SECONDS_UNCOMMON: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.UNCOMMON',
  COOLDOWN_CLAIM_SECONDS_RARE: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.RARE',
  COOLDOWN_CLAIM_SECONDS_EPIC: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.EPIC',
  COOLDOWN_CLAIM_SECONDS_LEGENDARY: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.LEGENDARY',
  PORT: 'infraestrutura',
  HOST: 'infraestrutura',
  API_KEY: 'segredo',
  API_KEYS: 'segredo',
  ADMIN_PASSWORD: 'segredo',
  DATABASE_URL: 'URL com credencial',
  REDIS_URL: 'URL com credencial',
  CURRENCY_NAME: 'rótulo de exibição, não muda a economia',
  CURRENCY_EMOJI: 'rótulo de exibição, não muda a economia',
  INTERNAL_BASE_URL: 'URL',
  PUBLIC_BASE_URL: 'URL',
  RAVENA_API_URL: 'URL',
  MARKET_API_SECRET: 'segredo',
  JARDIM_API_URL: 'URL',
  TELEGRAM_BOT_TOKEN: 'segredo',
  TELEGRAM_CHAT_ID: 'identificador privado',
  TELEGRAM_WEBHOOK_SECRET: 'segredo',
  TELEGRAM_WEBHOOK_ALLOW_UNSIGNED: 'segurança do webhook, não muda a economia',
  HYPERION_LLM_URL: 'URL',
  HYPERION_LLM_KEY: 'segredo',
  HYPERION_LLM_MODEL: 'modelo do conselheiro de IA, não muda a economia',
  HYPERION_LLM_TIMEOUT_MS: 'timeout HTTP do conselheiro de IA (infraestrutura)',
  HYPERION_LLM_MAX_TOKENS: 'limite de tokens do conselheiro de IA (infraestrutura)',
  HYPERION_LLM_FALLBACK_URL: 'URL de fallback do conselheiro de IA (infraestrutura)',
  HYPERION_LLM_FALLBACK_KEY: 'segredo do fallback do conselheiro de IA',
  HYPERION_LLM_FALLBACK_MODEL: 'modelo de fallback do conselheiro de IA, não muda a economia',
  OMDB_API_KEY: 'segredo da API do IMDb/OMDb',
  TWITCH_CLIENT_ID: 'segredo da API do Twitch/IGDB',
  TWITCH_CLIENT_SECRET: 'segredo da API do Twitch/IGDB',
  MEDIA_DIR: 'caminho local',
  CORS_ORIGINS: 'infraestrutura',
  ENABLE_SWAGGER: 'infraestrutura',
  EXTERNAL_USAGE_API: 'segredo (chaves da API externa)',
  EXTERNAL_USAGE_API_KEYS: 'segredo',
  UPSTREAM_API_URL: 'URL',
  UPSTREAM_API_KEY: 'segredo',
  REMOTE_MEDIA_BASE_URL: 'URL',
  COTA_BASE_DAILY_ZINTHOS: 'já exposto como market.BASE_DAILY_ZINTHOS',
  COTA_RARITY_DAYS: 'já exposto como market.RARITY_DAYS',
  COTA_DAYS_COMMON: 'já exposto como market.RARITY_DAYS.COMMON',
  COTA_DAYS_UNCOMMON: 'já exposto como market.RARITY_DAYS.UNCOMMON',
  COTA_DAYS_RARE: 'já exposto como market.RARITY_DAYS.RARE',
  COTA_DAYS_EPIC: 'já exposto como market.RARITY_DAYS.EPIC',
  COTA_DAYS_LEGENDARY: 'já exposto como market.RARITY_DAYS.LEGENDARY',
  COTA_MARRIED_PROGRESSION_WEIGHTS: 'já exposto como market.MARRIED_KEY_PROGRESSION_WEIGHTS',
  SOULMATE_RANKING_SCORE: 'pontuação de ranking de soulmates',
};

/** Achata como a rota: objetos viram NOME.CHAVE, arrays NOME.0, null vira "none". */
function flat(prefix: string, value: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null) out[prefix] = 'none';
  else if (Array.isArray(value)) value.forEach((v, i) => flat(`${prefix}.${i}`, v, out));
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value as object)) flat(`${prefix}.${k}`, v, out);
  else out[prefix] = value;
  return out;
}

/** Nomes expostos: segundo segmento de `<grupo>.<NOME>[.<chave>]`. */
function exposedNames(params: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(params).map((k) => k.split('.')[1]));
}

describe('📐 GET /internal/economy/params — parâmetros de balanceamento (Zinthos)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    // EconomySummaryService só guarda o client; a rota de parâmetros não consulta o banco.
    app.decorate('prisma', {} as any);
    await app.register(privateEconomyRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (headers: Record<string, string> = { authorization: `Bearer ${API_KEY}` }) =>
    app.inject({ method: 'GET', url: ROUTE, headers });

  it('exige a API key (401 sem cabeçalho ou com chave errada)', async () => {
    expect((await get({})).statusCode).toBe(401);
    expect((await get({ authorization: 'Bearer chave_errada_000000000000000000' })).statusCode).toBe(401);
  });

  it('devolve o formato do contrato', async () => {
    const before = Date.now();
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['currency', 'generatedAt', 'params', 'schemaVersion', 'startedAt', 'version']);
    expect(body.currency).toBe('zinthos');
    expect(body.schemaVersion).toBe(1);
    expect(body.generatedAt).toBeGreaterThanOrEqual(before);
    expect(body.generatedAt).toBeLessThanOrEqual(Date.now());
    expect(Number.isInteger(body.startedAt)).toBe(true);
    expect(body.startedAt).toBeLessThanOrEqual(body.generatedAt);
    expect(body.version).toBe(process.env.GIT_SHA || process.env.APP_VERSION || null);

    const keys = Object.keys(body.params);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(body.params)) {
      expect(k).toMatch(/^[a-z]+\.[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)?$/);
      expect(['number', 'string', 'boolean']).toContain(typeof v);
      // Nada de segredo ou URL.
      expect(k).not.toMatch(/API_KEY|SECRET|TOKEN|PASSWORD|_URL/);
      if (typeof v === 'string') expect(v).not.toMatch(/:\/\//);
    }
  });

  it('valores iguais às constantes do código e ao config efetivo', async () => {
    const { params } = (await get()).json();
    const expected = {
      ...flat('roll.RARITY_BASE_WEIGHTS', rarity.RARITY_BASE_WEIGHTS),
      ...flat('roll.KAKERA_CRYSTAL_BASE', rarity.KAKERA_CRYSTAL_BASE),
      'roll.KAKERA_CRYSTAL_KEY_BONUS': rarity.KAKERA_CRYSTAL_KEY_BONUS,
      'roll.ROLL_MAX_BASE': config.ROLL_MAX_BASE,
      'roll.ROLL_REGEN_SECONDS': config.ROLL_REGEN_SECONDS,
      'roll.ROLL_REGEN_ACCEL_FACTOR': config.ROLL_REGEN_ACCEL_FACTOR,
      'roll.ROLL_LEGENDARY_CHANCE_CAP': config.ROLL_LEGENDARY_CHANCE_CAP,
      'roll.WEEKLY_LEGENDARY_HARD_CAP': config.WEEKLY_LEGENDARY_HARD_CAP,
      'roll.COOLDOWN_ROLL_SECONDS': config.COOLDOWN_ROLL_SECONDS,
      'roll.ROLL_SCRAP_BONUS_FACTOR': config.ROLL_SCRAP_BONUS_FACTOR,
      'roll.ROLL_SCRAP_BONUS_CAP': config.ROLL_SCRAP_BONUS_CAP,
      'roll.ROLL_RANK_MAX_DIFFICULTY': config.ROLL_RANK_MAX_DIFFICULTY,
      'roll.ROLL_RANK_REF_CUTOFF': config.ROLL_RANK_REF_CUTOFF,
      ...flat('claim.RARITY_CLAIM_COOLDOWNS', cooldown.RARITY_CLAIM_COOLDOWNS),
      'claim.COOLDOWN_CLAIM_SECONDS': config.COOLDOWN_CLAIM_SECONDS,
      'claim.CLAIM_LOCK_SECONDS': config.CLAIM_LOCK_SECONDS,
      'claim.SOULMATE_KEYS_REQUIRED': config.SOULMATE_KEYS_REQUIRED,
      'claim.WISHLIST_MAX_ITEMS': config.WISHLIST_MAX_ITEMS,
      'daily.DAILY_KAKERA_AMOUNT': config.DAILY_KAKERA_AMOUNT,
      'daily.DAILY_KAKERA_VARIANCE': config.DAILY_KAKERA_VARIANCE,
      'daily.DAILY_RESET_HOUR_UTC': config.DAILY_RESET_HOUR_UTC,
      'daily.DAILY_RESET_MINUTE_UTC': config.DAILY_RESET_MINUTE_UTC,
      'claim.COTA_INFLATION_ALPHA': config.COTA_INFLATION_ALPHA,
      'claim.COTA_SCARCITY_BETAS': config.COTA_SCARCITY_BETAS,
      'daily.COOLDOWN_DAILY_SECONDS': config.COOLDOWN_DAILY_SECONDS,
      'daily.DAILY_STREAK_MAX_DAYS': kakera.DAILY_STREAK_MAX_DAYS,
      ...flat('daily.DAILY_STREAK_BONUS_PERCENT', kakera.DAILY_STREAK_BONUS_PERCENT),
      'daily.DAILY_MIN_BASE_AMOUNT': kakera.DAILY_MIN_BASE_AMOUNT,
      'daily.WISHLIST_DAILY_BONUS_DIVISOR': kakera.WISHLIST_DAILY_BONUS_DIVISOR,
      'daily.WISHLIST_DAILY_MULTIPLIER_CAP': kakera.WISHLIST_DAILY_MULTIPLIER_CAP,
      ...flat('limits.RARITY_DAILY_MARRY_LIMITS', cooldown.RARITY_DAILY_MARRY_LIMITS),
      ...flat('limits.RARITY_DAILY_TRADE_LIMITS', cooldown.RARITY_DAILY_TRADE_LIMITS),
      ...flat('divorce.RARITY_DIVORCE_VALUES', rarity.RARITY_DIVORCE_VALUES),
      ...flat('divorce.RARITY_KEY_DIVORCE_BONUS', rarity.RARITY_KEY_DIVORCE_BONUS),
      ...flat('divorce.SOULMATE_DIVORCE_VALUES', rarity.SOULMATE_DIVORCE_VALUES),
      'divorce.SOULMATE_KEY_KAKERA_BONUS': rarity.SOULMATE_KEY_KAKERA_BONUS,
      'divorce.KEY_KAKERA_BONUS': rarity.KEY_KAKERA_BONUS,
      'divorce.DIVORCE_PENALTY_RATE': rarity.DIVORCE_PENALTY_RATE,
      ...flat('divorce.DAILY_DIVORCE_TIER_RATES', rarity.DAILY_DIVORCE_TIER_RATES),
      'divorce.DAILY_DIVORCE_MIN_RATE': rarity.DAILY_DIVORCE_MIN_RATE,
      'divorce.RANK_MULTIPLIER_MAX': rarity.RANK_MULTIPLIER_MAX,
      'divorce.RANK_MULTIPLIER_EXPONENT': rarity.RANK_MULTIPLIER_EXPONENT,
      'divorce.DIVORCE_PAYOUT_MULTIPLIER': config.DIVORCE_PAYOUT_MULTIPLIER,
      'market.BASE_DAILY_ZINTHOS': market.BASE_DAILY_ZINTHOS,
      ...flat('market.RARITY_DAYS', market.RARITY_DAYS),
      'market.BASE_MONEY_SUPPLY': market.BASE_MONEY_SUPPLY,
      'market.INFLATION_ALPHA': market.INFLATION_ALPHA,
      ...flat('market.SCARCITY_BETA', market.SCARCITY_BETA),
      ...flat('market.MARRIED_KEY_PROGRESSION_WEIGHTS', rarity.MARRIED_KEY_PROGRESSION_WEIGHTS),
      'market.COMPETITOR_INVESTMENT_REFUND_RATE': market.COMPETITOR_INVESTMENT_REFUND_RATE,
      'market.MARKET_SELLER_NET_RATE': marketplace.MARKET_SELLER_NET_RATE,
      'hosting.HOSTING_CONFISCO_PERMILLE': config.HOSTING_CONFISCO_PERMILLE,
      'hosting.HOSTING_GRACE_HOURS': config.HOSTING_GRACE_HOURS,
      'hosting.HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT': config.HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT,
      'hosting.HOSTING_INACTIVE_MAX_MULTIPLIER': config.HOSTING_INACTIVE_MAX_MULTIPLIER,
      ...flat('hosting.HOSTING_TAXAS_ATIVAS', activeHostingRates),
      ...flat('hosting.HOSTING_TAXAS_INATIVAS', inactiveHostingRates),
    };
    expect(params).toEqual(expected);
    // Amostras do formato pedido pelo painel.
    expect(params['divorce.DIVORCE_PENALTY_RATE']).toBe(rarity.DIVORCE_PENALTY_RATE);
    expect(params['divorce.DAILY_DIVORCE_TIER_RATES.0']).toBe(rarity.DAILY_DIVORCE_TIER_RATES[0]);
    expect(params['market.INFLATION_ALPHA']).toBe(market.INFLATION_ALPHA);
    expect(params['limits.RARITY_DAILY_MARRY_LIMITS.LEGENDARY']).toBe('none');
  });

  it('guarda: toda constante exportada dos arquivos de origem está na rota ou na lista de ignoradas', () => {
    const exposed = exposedNames(buildEconomyParams());
    const found = new Set<string>();
    for (const file of SOURCE_FILES) {
      const src = readFileSync(path.join(API_DIR, file), 'utf8');
      for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]+)/g)) found.add(m[1]);
      // Constante numérica sem export (também dentro de função): exporte e exponha, ou ignore com o motivo.
      for (const m of src.matchAll(/^\s*const ([A-Z][A-Z0-9_]+)\s*(?::\s*number\s*)?=\s*[-+(]?\d/gm)) found.add(m[1]);
    }
    const missing = [...found].filter((n) => !exposed.has(n) && !(n in IGNORED_CONSTANTS));
    expect(missing, 'constante nova: exponha em utils/economyParams.ts ou ignore aqui com o motivo').toEqual([]);
    // Lista de ignoradas sem entradas velhas.
    expect(Object.keys(IGNORED_CONSTANTS).filter((n) => !found.has(n))).toEqual([]);
  });

  it('valores das constantes extraídas de números soltos (iguais aos de antes)', async () => {
    const { params } = (await get()).json();
    expect(params['market.MARKET_SELLER_NET_RATE']).toBe(0.95);
    expect(params['market.COMPETITOR_INVESTMENT_REFUND_RATE']).toBe(0.5);
    expect(params['roll.KAKERA_CRYSTAL_KEY_BONUS']).toBe(5);
    expect(params['daily.DAILY_STREAK_MAX_DAYS']).toBe(7);
    expect(kakera.DAILY_STREAK_BONUS_PERCENT).toEqual({ 1: 0, 2: 10, 3: 20, 4: 30, 5: 40, 6: 50, 7: 100 });
    expect(params['daily.DAILY_MIN_BASE_AMOUNT']).toBe(100);
    expect(params['daily.WISHLIST_DAILY_BONUS_DIVISOR']).toBe(1000);
    expect(params['daily.WISHLIST_DAILY_MULTIPLIER_CAP']).toBe(2);
    expect(params['divorce.RANK_MULTIPLIER_MAX']).toBe(5);
    expect(params['divorce.RANK_MULTIPLIER_EXPONENT']).toBe(3);
    // Curva do multiplicador de rank igual à fórmula parametrizada (1 + 4 · ratio³, piso 1, posição 1 = 5).
    const old = (position: number, total: number) => {
      if (!total || total <= 1 || !position || position < 1) return 1.0;
      if (position === 1) return 5.0;
      if (position >= total) return 1.0;
      const ratio = Math.max(0, 1.0 - (position - 1) / total);
      return Number(Math.max(1.0, 1.0 + 4.0 * Math.pow(ratio, 3)).toFixed(4));
    };
    for (const total of [0, 1, 2, 10, 137, 1000]) {
      for (let p = 0; p <= total + 1; p++) expect(rarity.calculateRankMultiplier(p, total)).toBe(old(p, total));
    }
  });

  it('guarda: a regra também pega constante numérica sem export', () => {
    const re = /^\s*const ([A-Z][A-Z0-9_]+)\s*(?::\s*number\s*)?=\s*[-+(]?\d/gm;
    const src = 'const A_B = 5;\n  const RATE: number = 0.5;\nconst NAME = "x";\nconst lower = 3;\nconst OBJ = { a: 1 };';
    expect([...src.matchAll(re)].map((m) => m[1])).toEqual(['A_B', 'RATE']);
  });

  it('guarda: toda chave de config.ts está na rota ou na lista de ignoradas', () => {
    const exposed = exposedNames(buildEconomyParams());
    // Chaves do envSchema (opcionais sem valor não aparecem em Object.keys(config)).
    const src = readFileSync(path.join(API_DIR, 'src/config.ts'), 'utf8');
    const keys = [...src.matchAll(/^ {2}([A-Z][A-Z0-9_]+): z\./gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(30);
    const missing = keys.filter((k) => !exposed.has(k) && !(k in IGNORED_CONFIG_KEYS));
    expect(missing, 'variável nova em config.ts: exponha em utils/economyParams.ts ou ignore aqui com o motivo').toEqual([]);
    expect(Object.keys(IGNORED_CONFIG_KEYS).filter((k) => exposed.has(k))).toEqual([]);
  });
});
