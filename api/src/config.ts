import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// Load .env from workspace root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  API_KEY: z.string().optional(),
  API_KEYS: z.string().optional(),
  ADMIN_PASSWORD: z.string().default('admin123456'),

  DATABASE_URL: z.string().default('postgresql://waifu_user:change_me@localhost:5432/waifuletes_db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  CURRENCY_NAME: z.string().default('Kakera'),
  CURRENCY_EMOJI: z.string().default('💎'),
  DAILY_KAKERA_AMOUNT: z.coerce.number().default(300),
  DAILY_KAKERA_VARIANCE: z.coerce.number().default(150),

  COOLDOWN_ROLL_SECONDS: z.coerce.number().default(600), // 10 min
  COOLDOWN_CLAIM_SECONDS: z.coerce.number().default(7200), // Fallback legado (2 horas)
  COOLDOWN_CLAIM_SECONDS_COMMON: z.coerce.number().default(1800), // 30 min
  COOLDOWN_CLAIM_SECONDS_UNCOMMON: z.coerce.number().default(2700), // 45 min
  COOLDOWN_CLAIM_SECONDS_RARE: z.coerce.number().default(3600), // 60 min (1 hora)
  COOLDOWN_CLAIM_SECONDS_EPIC: z.coerce.number().default(5400), // 90 min (1h30min)
  COOLDOWN_CLAIM_SECONDS_LEGENDARY: z.coerce.number().default(21600), // 360 min (6 horas)
  COOLDOWN_DAILY_SECONDS: z.coerce.number().default(72000), // Fallback legado
  DAILY_RESET_HOUR_UTC: z.coerce.number().default(7), // 07:00 UTC = 04:00 BRT (Horário de Brasília)
  DAILY_RESET_MINUTE_UTC: z.coerce.number().default(0),
  CLAIM_LOCK_SECONDS: z.coerce.number().default(300), // 5 min

  ROLL_MAX_BASE: z.coerce.number().default(9),
  ROLL_REGEN_SECONDS: z.coerce.number().default(300), // 5 min
  ROLL_REGEN_ACCEL_FACTOR: z.coerce.number().default(20), // Dividido por 1000 (20 = 0.020)
  ROLL_LEGENDARY_CHANCE_CAP: z.coerce.number().default(80), // 0 a 10000 (80 = 0.80%, 1 = 0.01%, 10000 = 10%)
  WEEKLY_LEGENDARY_HARD_CAP: z.coerce.number().default(8), // Teto semanal de Lendárias obtidas por jogador no roll (8 = 0% de chance após a 8ª)
  ROLL_SCRAP_BONUS_FACTOR: z.coerce.number().default(0.3), // Bônus por rolls disponíveis (~15% do valor original de 2.0)
  ROLL_SCRAP_BONUS_CAP: z.coerce.number().default(150), // Teto máximo do bônus de rolls disponíveis
  ROLL_RANK_MAX_DIFFICULTY: z.coerce.number().default(7.0),
  ROLL_RANK_REF_CUTOFF: z.coerce.number().default(20000),
  ROLL_MARRIED_REFUND_CHANCE: z.coerce.number().min(0).max(1).default(0.75), // Chance de devolução do roll ao sortear casado de outro jogador
  ROLL_SOULMATE_BONUS_ROLLS: z.coerce.number().int().min(0).default(5), // Rolls grátis ganhos ao sortear próprio soulmate (sem gerar chave)

  SOULMATE_KEYS_REQUIRED: z.coerce.number().default(10),
  WISHLIST_MAX_ITEMS: z.coerce.number().default(1000).transform((val) => Math.max(val, 1000)),

  INTERNAL_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  RAVENA_API_URL: z.string().default(process.env.RAVENA_API_URL || 'http://172.22.0.1:5001'),
  // Segredo compartilhado com a Ravena para as rotas internas /api/market/* (header X-Market-Secret).
  // Deve ter o MESMO valor de MARKET_API_SECRET no .env da Ravena; sem ele a Ravena recusa (503).
  MARKET_API_SECRET: z.string().optional(),
  JARDIM_API_URL: z.string().default(process.env.JARDIM_API_URL || 'http://172.22.0.1:3040'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() !== '' ? val.trim() : undefined),
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/, {
        message: 'TELEGRAM_WEBHOOK_SECRET deve conter de 1 a 256 caracteres [A-Za-z0-9_-]',
      })
      .optional()
  ),
  TELEGRAM_WEBHOOK_ALLOW_UNSIGNED: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(false),

  HYPERION_LLM_URL: z.string().default(process.env.HYPERION_LLM_URL || 'http://192.168.195.212:16001/v1'),
  // Sem valor padrão: segredos nunca ficam no código. Configure HYPERION_LLM_KEY no .env.
  HYPERION_LLM_KEY: z.string().default(process.env.HYPERION_LLM_KEY || ''),
  HYPERION_LLM_MODEL: z.string().default(process.env.HYPERION_LLM_MODEL || 'gemma4:12b-uncensored'),
  HYPERION_LLM_FALLBACK_URL: z.string().default(process.env.HYPERION_LLM_FALLBACK_URL || 'https://lucia.ctg.ufsm.br/v1'),
  HYPERION_LLM_FALLBACK_KEY: z.string().default(process.env.HYPERION_LLM_FALLBACK_KEY || 'ic6YUME9beTBTVQZDRoHPbCXqWr2lT'),
  HYPERION_LLM_FALLBACK_MODEL: z.string().default(process.env.HYPERION_LLM_FALLBACK_MODEL || 'gemma4'),
  HYPERION_LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(60000),
  HYPERION_LLM_MAX_TOKENS: z.coerce.number().int().min(512).max(16384).default(4096),

  OMDB_API_KEY: z.string().default(process.env.OMDB_API_KEY || ''),
  TWITCH_CLIENT_ID: z.string().default(process.env.TWITCH_CLIENT_ID || ''),
  TWITCH_CLIENT_SECRET: z.string().default(process.env.TWITCH_CLIENT_SECRET || ''),

  MEDIA_DIR: z.string().default(
    process.env.MEDIA_DIR ||
      (fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../media'))
  ),
  CORS_ORIGINS: z.string().default('*'),
  ENABLE_SWAGGER: z.preprocess(
    (val) => val === 'true' || val === true || (process.env.NODE_ENV !== 'production' && val !== 'false'),
    z.boolean()
  ).default(process.env.NODE_ENV !== 'production'),

  // Configurações de API Externa e Catálogo Remoto
  EXTERNAL_USAGE_API: z.string().optional(),
  EXTERNAL_USAGE_API_KEYS: z.string().optional(),
  UPSTREAM_API_URL: z.string().optional(),
  UPSTREAM_API_KEY: z.string().optional(),
  REMOTE_MEDIA_BASE_URL: z.string().optional(),

  // Taxa de Hospedagem e Inatividade
  HOSTING_CONFISCO_PERMILLE: z.coerce.number().default(3000),
  HOSTING_TAXAS_INATIVAS: z.string().default('20,120,400,700,2000'),
  HOSTING_TAXAS_ATIVAS: z.string().default('1,3,8,15,40'),
  HOSTING_GRACE_HOURS: z.coerce.number().default(72),
  HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT: z.coerce.number().default(10),
  HOSTING_INACTIVE_MAX_MULTIPLIER: z.coerce.number().default(5),

  // Cotas de Mercado e Soulmate
  COTA_BASE_DAILY_ZINTHOS: z.coerce.number().default(21000),
  COTA_RARITY_DAYS: z.string().default('50,65,80,100,210'),
  COTA_DAYS_COMMON: z.coerce.number().optional(),
  COTA_DAYS_UNCOMMON: z.coerce.number().optional(),
  COTA_DAYS_RARE: z.coerce.number().optional(),
  COTA_DAYS_EPIC: z.coerce.number().optional(),
  COTA_DAYS_LEGENDARY: z.coerce.number().optional(),
  COTA_MARRIED_PROGRESSION_WEIGHTS: z.string().default('0.35,0.40,0.50,0.55,0.65,0.75,0.85,0.95,1.00'),
  COTA_INFLATION_ALPHA: z.coerce.number().min(0).default(0.25),
  COTA_SCARCITY_BETAS: z.string().default('1.0,1.0,1.5,1.5,2.5'),
  RANK_MULTIPLIER_MAX: z.coerce.number().min(1).default(5.0),
  DIVORCE_PAYOUT_MULTIPLIER: z.coerce.number().min(0.1).default(1.0),
  SOULMATE_RANKING_SCORE: z.coerce.number().default(2100),
});

export const config = envSchema.parse(process.env);

/**
 * Headers para chamadas às rotas internas de mercado da Ravena (/api/market/*).
 */
export function ravenaMarketHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    ...(config.MARKET_API_SECRET ? { 'X-Market-Secret': config.MARKET_API_SECRET } : {}),
  };
}

const rawKeys = config.API_KEYS || config.API_KEY || '';
export const apiKeys = rawKeys
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

const rawExternalKeys = config.EXTERNAL_USAGE_API || config.EXTERNAL_USAGE_API_KEYS || '';
export const externalApiKeys = rawExternalKeys
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production') {
  if (apiKeys.length === 0 || apiKeys.every((k) => k.length < 16)) {
    console.warn('⚠️ AVISO DE SEGURANÇA: Chaves de API ausentes ou muito curtas em ambiente de produção!');
  }
}

/**
 * Retorna a fração decimal correspondente ao cap máximo de chance de Lendários no roll (0.0 a 1.0).
 * Escala configurável de 0 a 10000:
 * - 0: Desativado (1.0 = 100%)
 * - 1 a 100: interpreta 1 = 0.01% (ex: 80 = 0.80% = 0.008)
 * - 101 a 10000: interpreta escala onde 10000 = 10% (ex: 800 = 0.80% = 0.008, 10000 = 10% = 0.10)
 */
export function getLegendaryChanceCap(): number {
  const val = config.ROLL_LEGENDARY_CHANCE_CAP;
  if (!val || val <= 0) return 1.0;
  let percent: number;
  if (val <= 100) {
    percent = val * 0.01;
  } else if (val <= 10000) {
    percent = val / 1000;
  } else {
    percent = 10.0;
  }
  return Math.min(0.10, Math.max(0.0001, percent / 100));
}

import { Rarity } from '@prisma/client';

export interface HostingRates {
  [key: string]: number;
  COMMON: number;
  UNCOMMON: number;
  RARE: number;
  EPIC: number;
  LEGENDARY: number;
}

/**
 * Converte a string CSV de taxas (COMMON,UNCOMMON,RARE,EPIC,LEGENDARY) em um objeto tipado
 */
export function parseHostingRates(csv: string, defaultRates: HostingRates): HostingRates {
  if (!csv || typeof csv !== 'string') return defaultRates;
  const parts = csv.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length < 5 || parts.some((n) => isNaN(n) || n < 0)) {
    return defaultRates;
  }
  return {
    COMMON: parts[0],
    UNCOMMON: parts[1],
    RARE: parts[2],
    EPIC: parts[3],
    LEGENDARY: parts[4],
  };
}

export const activeHostingRates = parseHostingRates(config.HOSTING_TAXAS_ATIVAS, {
  COMMON: 1,
  UNCOMMON: 3,
  RARE: 8,
  EPIC: 15,
  LEGENDARY: 40,
});

export const inactiveHostingRates = parseHostingRates(config.HOSTING_TAXAS_INATIVAS, {
  COMMON: 20,
  UNCOMMON: 120,
  RARE: 400,
  EPIC: 700,
  LEGENDARY: 2000,
});

export interface RarityDays {
  [key: string]: number;
  COMMON: number;
  UNCOMMON: number;
  RARE: number;
  EPIC: number;
  LEGENDARY: number;
}

export function parseRarityDays(csv: string, defaultDays: RarityDays): RarityDays {
  if (!csv || typeof csv !== 'string') return defaultDays;
  const parts = csv.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length < 5 || parts.some((n) => isNaN(n) || n < 0)) {
    return defaultDays;
  }
  return {
    COMMON: parts[0],
    UNCOMMON: parts[1],
    RARE: parts[2],
    EPIC: parts[3],
    LEGENDARY: parts[4],
  };
}

const defaultCotaRarityDays: RarityDays = {
  COMMON: 50,
  UNCOMMON: 65,
  RARE: 80,
  EPIC: 100,
  LEGENDARY: 210,
};

const defaultMarriedProgressionWeights: number[] = [
  0.35, 0.40, 0.50, 0.55, 0.65, 0.75, 0.85, 0.95, 1.00,
];

export function parseMarriedProgressionWeights(
  csv: string,
  defaultWeights: number[] = defaultMarriedProgressionWeights
): number[] {
  if (!csv || typeof csv !== 'string') return defaultWeights;
  const parts = csv.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 9 || parts.some((n) => isNaN(n) || n <= 0)) {
    return defaultWeights;
  }
  return parts.slice(0, 9);
}

const baseDays = parseRarityDays(config.COTA_RARITY_DAYS, defaultCotaRarityDays);

export const cotaRarityDays: Record<Rarity, number> = {
  COMMON: config.COTA_DAYS_COMMON ?? baseDays.COMMON,
  UNCOMMON: config.COTA_DAYS_UNCOMMON ?? baseDays.UNCOMMON,
  RARE: config.COTA_DAYS_RARE ?? baseDays.RARE,
  EPIC: config.COTA_DAYS_EPIC ?? baseDays.EPIC,
  LEGENDARY: config.COTA_DAYS_LEGENDARY ?? baseDays.LEGENDARY,
};

export const marriedProgressionWeights: number[] = parseMarriedProgressionWeights(
  config.COTA_MARRIED_PROGRESSION_WEIGHTS,
  defaultMarriedProgressionWeights
);

export function parseScarcityBetas(csv: string): Record<Rarity, number> {
  const defaults: Record<Rarity, number> = {
    COMMON: 1.0,
    UNCOMMON: 1.0,
    RARE: 1.5,
    EPIC: 1.5,
    LEGENDARY: 2.5,
  };
  if (!csv || typeof csv !== 'string') return defaults;
  const parts = csv.split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 5 || parts.some((n) => isNaN(n) || n < 0)) {
    return defaults;
  }
  return {
    COMMON: parts[0],
    UNCOMMON: parts[1],
    RARE: parts[2],
    EPIC: parts[3],
    LEGENDARY: parts[4],
  };
}

export const cotaScarcityBetas: Record<Rarity, number> = parseScarcityBetas(config.COTA_SCARCITY_BETAS);

export type Config = typeof config;
