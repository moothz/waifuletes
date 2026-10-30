#!/usr/bin/env node

/**
 * Script de conveniência para reencaminhar todas as sugestões pendentes ao Telegram.
 * Pode ser executado da raiz do projeto via:
 *   node scripts/forwardPendingSuggestionsToTelegram.js
 * Ou pelo container Docker:
 *   docker compose exec api npm run forward:suggestions
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..', 'api');
const scriptPath = path.resolve(apiDir, 'scripts', 'forwardPendingSuggestionsToTelegram.ts');

console.log('🚀 Iniciando script de reencaminhamento de sugestões ao Telegram...\n');

const child = spawn('npx', ['tsx', scriptPath], {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
  },
});

child.on('close', (code) => {
  process.exit(code || 0);
});
