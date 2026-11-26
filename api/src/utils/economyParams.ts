import { performance } from 'node:perf_hooks';
import { config, activeHostingRates, inactiveHostingRates } from '../config.js';
import {
  RARITY_BASE_WEIGHTS,
  KAKERA_CRYSTAL_BASE,
  KAKERA_CRYSTAL_KEY_BONUS,
  RANK_MULTIPLIER_MAX,
  RANK_MULTIPLIER_EXPONENT,
  RARITY_DIVORCE_VALUES,
  RARITY_KEY_DIVORCE_BONUS,
  SOULMATE_DIVORCE_VALUES,
  SOULMATE_KEY_KAKERA_BONUS,
  KEY_KAKERA_BONUS,
  DIVORCE_PENALTY_RATE,
  DAILY_DIVORCE_TIER_RATES,
  DAILY_DIVORCE_MIN_RATE,
  MARRIED_KEY_PROGRESSION_WEIGHTS,
} from './rarityCalculator.js';
import { RARITY_CLAIM_COOLDOWNS, RARITY_DAILY_MARRY_LIMITS, RARITY_DAILY_TRADE_LIMITS } from '../services/CooldownService.js';
import {
  BASE_DAILY_ZINTHOS,
  RARITY_DAYS,
  BASE_MONEY_SUPPLY,
  INFLATION_ALPHA,
  SCARCITY_BETA,
  COMPETITOR_INVESTMENT_REFUND_RATE,
} from '../services/MarketInvestmentService.js';
import { MARKET_SELLER_NET_RATE } from '../services/MarketService.js';
import {
  DAILY_STREAK_MAX_DAYS,
  DAILY_STREAK_BONUS_PERCENT,
  DAILY_MIN_BASE_AMOUNT,
  WISHLIST_DAILY_BONUS_DIVISOR,
  WISHLIST_DAILY_MULTIPLIER_CAP,
} from '../services/KakeraService.js';

/**
 * Parâmetros de balanceamento da economia de Zinthos para o painel da Ravena (GET /internal/economy/params).
 * O painel lê a rota de hora em hora e anota sozinho uma "mudança de balanceamento" quando algum valor muda.
 *
 * Chave: `<grupo>.<NOME>` e, para objetos e arrays, `<grupo>.<NOME>.<CHAVE>` / `<grupo>.<NOME>.<índice>`.
 * Valores de env (config.ts) entram com o valor efetivo (já com default e parse). `null` no código
 * (ex.: raridade sem limite diário) vira a string `"none"`. Nada de segredo, URL ou dado de jogador.
 *
 * Constante nova nos arquivos de origem precisa entrar aqui ou na lista de ignoradas de
 * tests/economy_params.test.ts (o teste de guarda falha caso contrário).
 */

export const ECONOMY_PARAMS_SCHEMA_VERSION = 1;

export type EconomyParamValue = number | string | boolean;

type Source = number | string | boolean | null | readonly Source[] | { readonly [key: string]: Source };

/** Momento (ms) em que o processo subiu. */
export const PROCESS_STARTED_AT = Math.round(performance.timeOrigin);

const GROUPS: Record<string, Record<string, Source>> = {
  roll: {
    RARITY_BASE_WEIGHTS,
    KAKERA_CRYSTAL_BASE,
    KAKERA_CRYSTAL_KEY_BONUS,
    ROLL_MAX_BASE: config.ROLL_MAX_BASE,
    ROLL_REGEN_SECONDS: config.ROLL_REGEN_SECONDS,
    ROLL_REGEN_ACCEL_FACTOR: config.ROLL_REGEN_ACCEL_FACTOR,
    ROLL_LEGENDARY_CHANCE_CAP: config.ROLL_LEGENDARY_CHANCE_CAP,
    WEEKLY_LEGENDARY_HARD_CAP: config.WEEKLY_LEGENDARY_HARD_CAP,
    COOLDOWN_ROLL_SECONDS: config.COOLDOWN_ROLL_SECONDS,
    ROLL_SCRAP_BONUS_FACTOR: config.ROLL_SCRAP_BONUS_FACTOR,
    ROLL_SCRAP_BONUS_CAP: config.ROLL_SCRAP_BONUS_CAP,
    ROLL_RANK_MAX_DIFFICULTY: config.ROLL_RANK_MAX_DIFFICULTY,
    ROLL_RANK_REF_CUTOFF: config.ROLL_RANK_REF_CUTOFF,
  },
  claim: {
    RARITY_CLAIM_COOLDOWNS,
    COOLDOWN_CLAIM_SECONDS: config.COOLDOWN_CLAIM_SECONDS,
    CLAIM_LOCK_SECONDS: config.CLAIM_LOCK_SECONDS,
    SOULMATE_KEYS_REQUIRED: config.SOULMATE_KEYS_REQUIRED,
    WISHLIST_MAX_ITEMS: config.WISHLIST_MAX_ITEMS,
    COTA_INFLATION_ALPHA: config.COTA_INFLATION_ALPHA,
    COTA_SCARCITY_BETAS: config.COTA_SCARCITY_BETAS,
  },
  daily: {
    DAILY_KAKERA_AMOUNT: config.DAILY_KAKERA_AMOUNT,
    DAILY_KAKERA_VARIANCE: config.DAILY_KAKERA_VARIANCE,
    DAILY_RESET_HOUR_UTC: config.DAILY_RESET_HOUR_UTC,
    DAILY_RESET_MINUTE_UTC: config.DAILY_RESET_MINUTE_UTC,
    COOLDOWN_DAILY_SECONDS: config.COOLDOWN_DAILY_SECONDS,
    DAILY_STREAK_MAX_DAYS,
    DAILY_STREAK_BONUS_PERCENT,
    DAILY_MIN_BASE_AMOUNT,
    WISHLIST_DAILY_BONUS_DIVISOR,
    WISHLIST_DAILY_MULTIPLIER_CAP,
  },
  limits: {
    RARITY_DAILY_MARRY_LIMITS,
    RARITY_DAILY_TRADE_LIMITS,
  },
  divorce: {
    RARITY_DIVORCE_VALUES,
    RARITY_KEY_DIVORCE_BONUS,
    SOULMATE_DIVORCE_VALUES,
    SOULMATE_KEY_KAKERA_BONUS,
    KEY_KAKERA_BONUS,
    DIVORCE_PENALTY_RATE,
    DAILY_DIVORCE_TIER_RATES,
    DAILY_DIVORCE_MIN_RATE,
    RANK_MULTIPLIER_MAX,
    RANK_MULTIPLIER_EXPONENT,
    DIVORCE_PAYOUT_MULTIPLIER: config.DIVORCE_PAYOUT_MULTIPLIER,
  },
  market: {
    BASE_DAILY_ZINTHOS,
    RARITY_DAYS,
    BASE_MONEY_SUPPLY,
    INFLATION_ALPHA,
    SCARCITY_BETA,
    MARRIED_KEY_PROGRESSION_WEIGHTS,
    COMPETITOR_INVESTMENT_REFUND_RATE,
    MARKET_SELLER_NET_RATE,
  },
  hosting: {
    HOSTING_CONFISCO_PERMILLE: config.HOSTING_CONFISCO_PERMILLE,
    HOSTING_GRACE_HOURS: config.HOSTING_GRACE_HOURS,
    HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT: config.HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT,
    HOSTING_INACTIVE_MAX_MULTIPLIER: config.HOSTING_INACTIVE_MAX_MULTIPLIER,
    // Taxas efetivas (CSV do env já convertido; CSV inválido cai no padrão de config.ts).
    HOSTING_TAXAS_ATIVAS: activeHostingRates,
    HOSTING_TAXAS_INATIVAS: inactiveHostingRates,
  },
};

function flatten(prefix: string, value: Source, out: Record<string, EconomyParamValue>): void {
  if (value === null) {
    out[prefix] = 'none';
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(`${prefix}.${i}`, v, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as { readonly [key: string]: Source })) flatten(`${prefix}.${k}`, v, out);
  } else {
    out[prefix] = value as EconomyParamValue;
  }
}

/** Mapa plano e ordenado por chave com todos os parâmetros de balanceamento. */
export function buildEconomyParams(): Record<string, EconomyParamValue> {
  const flat: Record<string, EconomyParamValue> = {};
  for (const [group, entries] of Object.entries(GROUPS)) {
    for (const [name, value] of Object.entries(entries)) flatten(`${group}.${name}`, value, flat);
  }
  const sorted: Record<string, EconomyParamValue> = {};
  for (const key of Object.keys(flat).sort()) sorted[key] = flat[key];
  return sorted;
}

export interface EconomyParamsResponse {
  currency: 'zinthos';
  schemaVersion: number;
  generatedAt: number;
  startedAt: number;
  version: string | null;
  params: Record<string, EconomyParamValue>;
}

export function getEconomyParams(now: number = Date.now()): EconomyParamsResponse {
  return {
    currency: 'zinthos',
    schemaVersion: ECONOMY_PARAMS_SCHEMA_VERSION,
    generatedAt: now,
    startedAt: PROCESS_STARTED_AT,
    version: process.env.GIT_SHA || process.env.APP_VERSION || null,
    params: buildEconomyParams(),
  };
}
