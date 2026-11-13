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
  COOLDOWN_CLAIM_SECONDS_LEGENDARY: z.coerce.number().default(7200), // 120 min (2 horas)
  COOLDOWN_DAILY_SECONDS: z.coerce.number().default(72000), // Fallback legado
  DAILY_RESET_HOUR_UTC: z.coerce.number().default(7), // 07:00 UTC = 04:00 BRT (Horário de Brasília)
  DAILY_RESET_MINUTE_UTC: z.coerce.number().default(0),
  CLAIM_LOCK_SECONDS: z.coerce.number().default(300), // 5 min

  ROLL_MAX_BASE: z.coerce.number().default(9),
  ROLL_REGEN_SECONDS: z.coerce.number().default(300), // 5 min
  ROLL_REGEN_ACCEL_FACTOR: z.coerce.number().default(20), // Dividido por 1000 (20 = 0.020)
  ROLL_LEGENDARY_CHANCE_CAP: z.coerce.number().default(80), // 0 a 10000 (80 = 0.80%, 1 = 0.01%, 10000 = 10%)

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

  HYPERION_LLM_URL: z.string().default(process.env.HYPERION_LLM_URL || 'http://192.168.195.212:16001/v1'),
  // Sem valor padrão: segredos nunca ficam no código. Configure HYPERION_LLM_KEY no .env.
  HYPERION_LLM_KEY: z.string().default(process.env.HYPERION_LLM_KEY || ''),
  HYPERION_LLM_MODEL: z.string().default(process.env.HYPERION_LLM_MODEL || 'gemma4:12b-uncensored'),

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
  HOSTING_TAXAS_INATIVAS: z.string().default('10,60,200,350,1000'),
  HOSTING_TAXAS_ATIVAS: z.string().default('1,3,8,15,40'),
  HOSTING_GRACE_HOURS: z.coerce.number().default(72),
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
  COMMON: 10,
  UNCOMMON: 60,
  RARE: 200,
  EPIC: 350,
  LEGENDARY: 1000,
});

export type Config = typeof config;
