import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      COTA_BASE_DAILY_ZINTHOS: '21000',
      COTA_RARITY_DAYS: '50,65,80,100,210',
      COTA_DAYS_COMMON: '50',
      COTA_DAYS_UNCOMMON: '65',
      COTA_DAYS_RARE: '80',
      COTA_DAYS_EPIC: '100',
      COTA_DAYS_LEGENDARY: '210',
    },
    // As suítes de integração compartilham o mesmo banco/API e várias chamam POST /admin/cleanup-test-data
    // no afterAll, que remove TODOS os usuários test_* — em paralelo, isso apagava dados de outras suítes
    // no meio da execução (falhas intermitentes com FK violada / 404). Arquivos rodam em sequência.
    fileParallelism: false,
    globalTeardown: ['./tests/helpers/globalTeardown.ts'],
  },
});
