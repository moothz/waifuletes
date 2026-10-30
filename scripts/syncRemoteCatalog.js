import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const UPSTREAM_URL = (process.env.UPSTREAM_API_URL || '').replace(/\/+$/, '');
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || '';

if (!UPSTREAM_URL) {
  console.error('❌ UPSTREAM_API_URL não configurada no .env!');
  console.error('Exemplo: UPSTREAM_API_URL=https://waifuletes.upstream.example');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`🚀 Conectando ao Hub remoto em: ${UPSTREAM_URL}`);
  const authHeader = UPSTREAM_KEY ? { Authorization: `Bearer ${UPSTREAM_KEY}` } : {};

  let page = 1;
  const limit = 500;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalRecords = 0;

  try {
    // 1. Primeira requisição para descobrir total
    const firstRes = await fetch(`${UPSTREAM_URL}/api/v1/external/characters?page=1&limit=${limit}`, {
      headers: authHeader,
    });

    if (!firstRes.ok) {
      const errText = await firstRes.text();
      throw new Error(`Falha na requisição HTTP (${firstRes.status}): ${errText}`);
    }

    const firstJson = (await firstRes.json()) as any;
    if (!firstJson.success) {
      throw new Error(`Erro na resposta do Hub: ${JSON.stringify(firstJson.error)}`);
    }

    totalRecords = firstJson.data.pagination.total;
    const totalPages = firstJson.data.pagination.totalPages;
    console.log(`📦 Encontrados ${totalRecords} personagens no acervo do Hub (${totalPages} páginas de ${limit}). Iniciando sincronização...`);

    while (page <= totalPages) {
      const res = page === 1 ? firstRes : await fetch(`${UPSTREAM_URL}/api/v1/external/characters?page=${page}&limit=${limit}`, {
        headers: authHeader,
      });

      if (!res.ok) {
        throw new Error(`Erro ao baixar página ${page}: HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      const chars = json.data.characters || [];

      if (chars.length === 0) break;

      const batch = chars.map((c: any) => ({
        id: c.id,
        name: c.name,
        series: c.series,
        description: c.description ?? null,
        baseRarity: c.baseRarity,
        rank: c.rank ?? null,
        gender: c.gender,
        tags: Array.isArray(c.tags) ? c.tags : [],
        imageUrls: Array.isArray(c.imageUrls) ? c.imageUrls : [],
      }));

      const inserted = await prisma.character.createMany({
        data: batch,
        skipDuplicates: true,
      });

      totalProcessed += chars.length;
      totalInserted += inserted.count;

      const pct = ((totalProcessed / totalRecords) * 100).toFixed(1);
      console.log(`⚡ [${pct}%] Processados ${totalProcessed}/${totalRecords} (+${inserted.count} novos inseridos)...`);

      page++;
    }

    console.log(`\n🎉 Sincronização concluída com sucesso! Total sincronizado: ${totalProcessed} personagens (+${totalInserted} novos gravados no PostgreSQL local).`);
  } catch (err: any) {
    console.error('❌ Erro durante a sincronização:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
