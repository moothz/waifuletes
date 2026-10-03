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

  DATABASE_URL: z.string().default('postgresql://waifu_user:change_me@localhost:5432/waifuletes_db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  CURRENCY_NAME: z.string().default('Kakera'),
  CURRENCY_EMOJI: z.string().default('💎'),
  DAILY_KAKERA_AMOUNT: z.coerce.number().default(300),
  DAILY_KAKERA_VARIANCE: z.coerce.number().default(150),

  COOLDOWN_ROLL_SECONDS: z.coerce.number().default(600), // 10 min
  COOLDOWN_CLAIM_SECONDS: z.coerce.number().default(10800), // 3 horas
  COOLDOWN_DAILY_SECONDS: z.coerce.number().default(72000), // 20 horas
  CLAIM_LOCK_SECONDS: z.coerce.number().default(300), // 5 min

  ROLL_MAX_BASE: z.coerce.number().default(10),
  ROLL_REGEN_SECONDS: z.coerce.number().default(300), // 5 min

  SOULMATE_KEYS_REQUIRED: z.coerce.number().default(10),
  WISHLIST_MAX_ITEMS: z.coerce.number().default(100),

  INTERNAL_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  MEDIA_DIR: z.string().default(
    process.env.MEDIA_DIR ||
      (fs.existsSync('/app/media') ? '/app/media' : path.resolve(process.cwd(), '../media'))
  ),
  CORS_ORIGINS: z.string().default('*'),
  ENABLE_SWAGGER: z.preprocess(
    (val) => val === 'true' || val === true || (process.env.NODE_ENV !== 'production' && val !== 'false'),
    z.boolean()
  ).default(process.env.NODE_ENV !== 'production'),
});

export const config = envSchema.parse(process.env);

const rawKeys = config.API_KEYS || config.API_KEY || '';
export const apiKeys = rawKeys
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production') {
  if (apiKeys.length === 0 || apiKeys.every((k) => k.length < 16)) {
    console.warn('⚠️ AVISO DE SEGURANÇA: Chaves de API ausentes ou muito curtas em ambiente de produção!');
  }
}

export type Config = typeof config;
