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
  COOLDOWN_CLAIM_SECONDS: z.coerce.number().default(7200), // 2 horas
  COOLDOWN_DAILY_SECONDS: z.coerce.number().default(72000), // Fallback legado
  DAILY_RESET_HOUR_UTC: z.coerce.number().default(7), // 07:00 UTC = 04:00 BRT (Horário de Brasília)
  DAILY_RESET_MINUTE_UTC: z.coerce.number().default(0),
  CLAIM_LOCK_SECONDS: z.coerce.number().default(300), // 5 min

  ROLL_MAX_BASE: z.coerce.number().default(9),
  ROLL_REGEN_SECONDS: z.coerce.number().default(300), // 5 min

  SOULMATE_KEYS_REQUIRED: z.coerce.number().default(10),
  WISHLIST_MAX_ITEMS: z.coerce.number().default(1000).transform((val) => Math.max(val, 1000)),

  INTERNAL_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  RAVENA_API_URL: z.string().default(process.env.RAVENA_API_URL || 'http://172.22.0.1:5001'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  HYPERION_LLM_URL: z.string().default(process.env.HYPERION_LLM_URL || 'http://192.168.195.212:16001/v1'),
  HYPERION_LLM_KEY: z.string().default(process.env.HYPERION_LLM_KEY || '2orQzPoPJ1WDr6Ffv0gaBwcC'),
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
});

export const config = envSchema.parse(process.env);

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

export type Config = typeof config;
