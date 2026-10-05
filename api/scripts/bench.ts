import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.BENCH_API_URL || 'http://127.0.0.1:3030';
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runBenchmark() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           WAIFULETES API — BENCHMARK DE PERFORMANCE        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`🎯 Alvo: ${BASE_URL}\n`);

  // 1. Benchmark de busca (/characters?search=)
  console.log('📊 [1/3] Medindo latência de busca (/characters?search=rem)...');
  const searchLatencies: number[] = [];
  const SEARCH_ITERATIONS = 30;

  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/characters?search=rem&limit=10`);
    const duration = performance.now() - start;
    if (res.status === 200) {
      searchLatencies.push(duration);
    }
  }

  const searchP50 = percentile(searchLatencies, 50);
  const searchP95 = percentile(searchLatencies, 95);
  const searchAvg = searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length;

  console.log(`   • Média: ${searchAvg.toFixed(2)}ms | p50: ${searchP50.toFixed(2)}ms | p95: ${searchP95.toFixed(2)}ms`);
  console.log(`   • Meta: < 30ms -> ${searchP95 < 30 ? '✅ APROVADO' : '⚠️ ATENÇÃO'}\n`);

  // 2. Benchmark de Roll sequencial (/roll)
  console.log('📊 [2/3] Medindo latência de sorteio (/roll) com pool em memória...');
  const rollLatencies: number[] = [];
  const ROLL_ITERATIONS = 20;

  for (let i = 0; i < ROLL_ITERATIONS; i++) {
    const testUser = `bench_seq_user_${i}_${Date.now()}`;
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/roll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUser,
        groupId: 'bench_group',
        name: 'Bench User',
      }),
    });
    const duration = performance.now() - start;
    if (res.status === 200) {
      rollLatencies.push(duration);
    }
  }

  const rollP50 = percentile(rollLatencies, 50);
  const rollP95 = percentile(rollLatencies, 95);
  const rollAvg = rollLatencies.reduce((a, b) => a + b, 0) / rollLatencies.length;

  console.log(`   • Média: ${rollAvg.toFixed(2)}ms | p50: ${rollP50.toFixed(2)}ms | p95: ${rollP95.toFixed(2)}ms`);
  console.log(`   • Meta: p95 < 60ms -> ${rollP95 < 60 ? '✅ APROVADO' : '⚠️ ATENÇÃO'}\n`);

  // 3. Concorrência de 10 rolls simultâneos
  console.log('📊 [3/3] Medindo 10 rolls disparados em paralelo...');
  const parallelStart = performance.now();

  const parallelPromises = Array.from({ length: 10 }, (_, i) =>
    fetch(`${BASE_URL}/roll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: `bench_par_user_${i}_${Date.now()}`,
        groupId: 'bench_group',
        name: `Parallel User ${i}`,
      }),
    })
  );

  const parallelResponses = await Promise.all(parallelPromises);
  const parallelDuration = performance.now() - parallelStart;
  const all200 = parallelResponses.every((r) => r.status === 200);

  console.log(`   • Tempo total para 10 rolls simultâneos: ${parallelDuration.toFixed(2)}ms (Todos HTTP 200: ${all200})`);
  console.log(`   • Meta: < 300ms -> ${parallelDuration < 300 ? '✅ APROVADO' : '⚠️ ATENÇÃO'}\n`);

  console.log('════════════════════════════════════════════════════════════');
  console.log('🎉 BENCHMARK CONCLUÍDO!');
  console.log('════════════════════════════════════════════════════════════\n');
}

runBenchmark().catch((err) => {
  console.error('Erro durante benchmark:', err);
  process.exit(1);
});
