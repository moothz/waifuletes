import fs from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * 🖼️ Script de Download Local de Imagens de Personagens do Waifuletes (Otimizado / Alta Performance)
 * 
 * Funcionalidades:
 *  - Suporta múltiplas imagens por personagem (default.*, image_1.*, image_2.*, etc.)
 *  - Pula arquivos existentes válidos (> 0 bytes)
 *  - Baixa imagens concorrentemente com pool de workers ajustável
 *  - Suporta retry automático com backoff exponencial
 *  - Gravação atômica do manifest para evitar corrupção de arquivos grandes
 *  - Sincronização contínua e em lote com PostgreSQL (--sync-db)
 *  - Encerramento gracioso em SIGINT/SIGTERM preservando todo o progresso
 * 
 * Uso:
 *   node scripts/downloadCharacterImages.js [limite|all] [concorrencia] [filtro_tag_ou_serie] [--sync-db]
 * 
 * Exemplos:
 *   node scripts/downloadCharacterImages.js all 10 all --sync-db
 *   DATABASE_URL="postgresql://user:pass@localhost:5432/waifuletes" nohup node scripts/downloadCharacterImages.js all 10 all --sync-db > download_images.log 2>&1 &
 */

const MANIFEST_PATH = process.env.MANIFEST_PATH || path.resolve(process.cwd(), 'media/manifests/characters.json');
const CHARACTERS_DIR = process.env.CHARACTERS_DIR || path.resolve(process.cwd(), 'media/characters');

const args = process.argv.slice(2);
const SYNC_DB = args.includes('--sync-db');
const cleanArgs = args.filter((a) => a !== '--sync-db');

const LIMIT_ARG = cleanArgs[0] || 'all';
const MAX_DOWNLOADS = LIMIT_ARG.toLowerCase() === 'all' ? Infinity : parseInt(LIMIT_ARG, 10);
const CONCURRENCY = parseInt(cleanArgs[1] || '8', 10);
const rawFilter = (cleanArgs[2] || '').toLowerCase().trim();
const FILTER_TAG = (rawFilter === 'all' || rawFilter === '*' || rawFilter === 'none' || rawFilter === '') ? '' : rawFilter;
const MIN_FREE_DISK_GB = 12;

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

function formatEtaGmt3(remainingSeconds) {
  if (!isFinite(remainingSeconds) || remainingSeconds < 0) return 'calculando...';
  const etaDate = new Date(Date.now() + remainingSeconds * 1000);
  const options = {
    timeZone: 'America/Sao_Paulo',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  };
  const parts = new Intl.DateTimeFormat('pt-BR', options).format(etaDate);
  const remMinutes = Math.floor(remainingSeconds / 60);
  const remHours = (remainingSeconds / 3600).toFixed(1);
  return `${parts} (~${remHours}h / ${remMinutes} min restantes)`;
}

async function checkFreeDiskSpaceGb(targetDir) {
  try {
    const stats = await fs.statfs(targetDir);
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes / (1024 * 1024 * 1024);
  } catch (err) {
    return 999;
  }
}

function getExistingLocalImages(slug) {
  const dir = path.join(CHARACTERS_DIR, slug);
  if (!existsSync(dir)) return [];

  const validPaths = [];
  try {
    const files = readdirSync(dir);
    files.sort((a, b) => {
      if (a.startsWith('default.')) return -1;
      if (b.startsWith('default.')) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    for (const file of files) {
      if (file.startsWith('default.') || file.startsWith('image_')) {
        const fullPath = path.join(dir, file);
        const stat = statSync(fullPath);
        if (stat.size > 0) {
          validPaths.push(`characters/${slug}/${file}`);
        }
      }
    }
  } catch (err) {}
  return validPaths;
}

function determineExtension(contentType, url) {
  if (contentType) {
    if (contentType.includes('image/png')) return 'png';
    if (contentType.includes('image/webp')) return 'webp';
    if (contentType.includes('image/gif')) return 'gif';
    if (contentType.includes('image/jpeg')) return 'jpg';
  }
  if (url) {
    const match = url.match(/\.(png|jpe?g|webp|gif)(\?.*)?$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }
  return 'jpg';
}

async function fetchImageWithRetry(url, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryHeader = parseInt(response.headers.get('Retry-After') || '5', 10);
        await new Promise((r) => setTimeout(r, (retryHeader || 5) * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error('Buffer vazio recebido do servidor.');
      }

      return { buffer, contentType };
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw new Error('Falha após múltiplas tentativas.');
}

async function syncDbBatch(prisma, updates) {
  if (!prisma || updates.length === 0) return;
  try {
    const SUB_CHUNK = 25;
    for (let i = 0; i < updates.length; i += SUB_CHUNK) {
      const chunk = updates.slice(i, i + SUB_CHUNK);
      await Promise.all(
        chunk.map((u) =>
          prisma.character.update({
            where: { id: u.id },
            data: { imageUrls: u.imageUrls },
          }).catch(() => null)
        )
      );
    }
  } catch (err) {
    console.warn(`[${getTimestamp()}] ⚠️ Falha ao sincronizar lote com PostgreSQL: ${err.message}`);
  }
}

async function saveManifestAtomic(manifest) {
  const tmpPath = `${MANIFEST_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.rename(tmpPath, MANIFEST_PATH);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       WAIFULETES - DOWNLOAD DE IMAGENS DE PERSONAGENS      ║');
  console.log('║               (MODO ALTA PERFORMANCE)                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (!existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest não encontrado em: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  console.log(`[${getTimestamp()}] 📖 Lendo manifest: ${MANIFEST_PATH}...`);
  const rawData = await fs.readFile(MANIFEST_PATH, 'utf-8');
  const manifest = JSON.parse(rawData);

  if (!Array.isArray(manifest.characters)) {
    console.error('❌ Formato de manifest inválido: esperado array "characters".');
    process.exit(1);
  }

  const totalCharacters = manifest.characters.length;
  console.log(`[${getTimestamp()}] 📦 Total de personagens no manifest: ${totalCharacters}`);
  console.log(`[${getTimestamp()}] ⚙️  Configurações:`);
  console.log(`   - Limite de downloads: ${MAX_DOWNLOADS === Infinity ? 'Sem limite (ALL)' : MAX_DOWNLOADS}`);
  console.log(`   - Workers concorrentes: ${CONCURRENCY}`);
  console.log(`   - Filtro ativo: ${FILTER_TAG || 'Nenhum (todos os personagens)'}`);
  console.log(`   - Sincronização contínua PostgreSQL: ${SYNC_DB ? 'Ativa (--sync-db)' : 'Desativada'}\n`);

  let prisma = null;
  if (SYNC_DB) {
    try {
      if (!process.env.DATABASE_URL) {
        throw new Error('A variável de ambiente DATABASE_URL é obrigatória para usar a flag --sync-db');
      }
      const { PrismaClient } = await import('../api/node_modules/@prisma/client/default.js');
      prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
      console.log(`[${getTimestamp()}] 🗄️  Conectado ao PostgreSQL com sucesso.`);
    } catch (dbErr) {
      console.warn(`[${getTimestamp()}] ⚠️ Falha ao conectar ao PostgreSQL: ${dbErr.message}`);
      prisma = null;
    }
  }

  let alreadyDownloadedCount = 0;
  let manifestUpdatedCount = 0;
  const downloadTasks = [];
  const dbBatchUpdates = [];

  console.log(`[${getTimestamp()}] 🔍 Analisando catálogo e mapeando arquivos locais existentes...`);
  for (const char of manifest.characters) {
    if (FILTER_TAG) {
      const matchTag = Array.isArray(char.tags) && char.tags.some((t) => t.toLowerCase().includes(FILTER_TAG));
      const matchSeries = typeof char.series === 'string' && char.series.toLowerCase().includes(FILTER_TAG);
      if (!matchTag && !matchSeries) continue;
    }

    const localImages = getExistingLocalImages(char.id);
    const remoteUrls = (char.images || []).filter(
      (img) => typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))
    );

    if (localImages.length > 0) {
      alreadyDownloadedCount += localImages.length;
      const combined = [...localImages, ...remoteUrls];
      if (JSON.stringify(char.images) !== JSON.stringify(combined)) {
        char.images = combined;
        manifestUpdatedCount++;
      }
      if (prisma) {
        dbBatchUpdates.push({ id: char.id, imageUrls: localImages });
      }
    }

    for (let i = 0; i < remoteUrls.length; i++) {
      const remoteUrl = remoteUrls[i];
      const slotIndex = localImages.length + i;
      const baseName = slotIndex === 0 ? 'default' : `image_${slotIndex}`;
      downloadTasks.push({ char, remoteUrl, baseName });
    }
  }

  if (prisma && dbBatchUpdates.length > 0) {
    console.log(`[${getTimestamp()}] 🗄️ Sincronizando ${dbBatchUpdates.length} imagens locais previamente detectadas com o banco...`);
    const initialSync = dbBatchUpdates.splice(0, dbBatchUpdates.length);
    await syncDbBatch(prisma, initialSync);
  }

  console.log(`[${getTimestamp()}] ✅ Imagens já baixadas locais: ${alreadyDownloadedCount}`);
  if (manifestUpdatedCount > 0) {
    console.log(`[${getTimestamp()}] 🔄 Manifest atualizado com ${manifestUpdatedCount} caminhos locais detectados.`);
    await saveManifestAtomic(manifest);
  }

  const toDownload = downloadTasks.slice(0, MAX_DOWNLOADS);
  console.log(`[${getTimestamp()}] 📥 Imagens pendentes para download: ${toDownload.length}\n`);

  if (toDownload.length === 0) {
    console.log(`[${getTimestamp()}] 🎉 Todas as imagens selecionadas já estão baixadas localmente!`);
    if (prisma) await prisma.$disconnect();
    return;
  }

  let downloadedCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  let isStopping = false;
  let unsavedChanges = false;

  // Auto-save a cada 60 segundos
  const saveInterval = setInterval(async () => {
    if (unsavedChanges && !isStopping) {
      unsavedChanges = false;
      await saveManifestAtomic(manifest).catch(() => null);
    }
  }, 60000);

  // Encerramento gracioso
  async function gracefulExit(signal) {
    if (isStopping) return;
    isStopping = true;
    clearInterval(saveInterval);
    console.log(`\n[${getTimestamp()}] 🛑 Sinal ${signal} recebido. Salvando manifest e banco com segurança...`);
    await saveManifestAtomic(manifest).catch(() => null);
    if (prisma && dbBatchUpdates.length > 0) {
      const remaining = dbBatchUpdates.splice(0, dbBatchUpdates.length);
      await syncDbBatch(prisma, remaining);
      await prisma.$disconnect();
    }
    console.log(`[${getTimestamp()}] ✅ Progresso preservado. Baixadas: ${downloadedCount} | Falhas: ${failedCount}`);
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulExit('SIGINT'));
  process.on('SIGTERM', () => gracefulExit('SIGTERM'));

  let currentIndex = 0;
  async function worker(workerId) {
    while (currentIndex < toDownload.length && !isStopping) {
      const index = currentIndex++;
      const item = toDownload[index];
      const { char, remoteUrl, baseName } = item;

      try {
        const { buffer, contentType } = await fetchImageWithRetry(remoteUrl);
        const ext = determineExtension(contentType, remoteUrl);
        const charDir = path.join(CHARACTERS_DIR, char.id);
        const localFileName = `${baseName}.${ext}`;
        const localRelativePath = `characters/${char.id}/${localFileName}`;
        const targetPath = path.join(charDir, localFileName);

        await fs.mkdir(charDir, { recursive: true });
        await fs.writeFile(targetPath, buffer);

        const urlIndex = char.images.indexOf(remoteUrl);
        if (urlIndex !== -1) {
          char.images[urlIndex] = localRelativePath;
        } else {
          char.images.push(localRelativePath);
        }

        unsavedChanges = true;
        downloadedCount++;

        // Guardião de segurança: suspender se disco <= 12GB livres
        if (downloadedCount % 50 === 0) {
          const freeGb = await checkFreeDiskSpaceGb(CHARACTERS_DIR);
          if (freeGb <= MIN_FREE_DISK_GB) {
            console.warn(
              `\n[${getTimestamp()}] ⚠️ PAUSA DE SEGURANÇA: Espaço em disco baixo (< ${MIN_FREE_DISK_GB} GB livres: ${freeGb.toFixed(2)} GB). Suspendendo downloads graciosamente.`
            );
            isStopping = true;
            break;
          }
        }

        if (prisma) {
          const onlyLocal = char.images.filter((img) => !img.startsWith('http'));
          dbBatchUpdates.push({ id: char.id, imageUrls: onlyLocal });
          if (dbBatchUpdates.length >= 100) {
            const batch = dbBatchUpdates.splice(0, dbBatchUpdates.length);
            await syncDbBatch(prisma, batch);
          }
        }

        if ((index + 1) % 100 === 0 || index + 1 === toDownload.length) {
          const elapsedSec = (Date.now() - startTime) / 1000;
          const speed = (downloadedCount / (elapsedSec || 1)).toFixed(1);
          const pct = (((index + 1) / toDownload.length) * 100).toFixed(1);
          const remainingSec = ((toDownload.length - (index + 1)) / (parseFloat(speed) || 1)).toFixed(0);
          const remMin = Math.floor(remainingSec / 60);

          console.log(
            `[${getTimestamp()}] 🚀 [${index + 1}/${toDownload.length}] (${pct}%) ` +
            `| Baixadas: ${downloadedCount} | Falhas: ${failedCount} | ${speed} img/s ` +
            `| ETA (GMT-3): ${formatEtaGmt3(remainingSec)} -> ${char.name} (${localFileName})`
          );

          // Salvar manifest a cada 500 imagens
          if (downloadedCount % 500 === 0) {
            await saveManifestAtomic(manifest).catch(() => null);
          }
        }
      } catch (err) {
        failedCount++;
        if (failedCount <= 10 || failedCount % 50 === 0) {
          console.warn(`[${getTimestamp()}] ⚠️ [Falha #${failedCount}] ${char.name} (${char.id}): ${err.message}`);
        }
      }
    }
  }

  console.log(`[${getTimestamp()}] 🚀 Iniciando ${CONCURRENCY} workers concorrentes...\n`);
  const workers = Array.from({ length: Math.min(CONCURRENCY, toDownload.length) }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  clearInterval(saveInterval);

  console.log(`[${getTimestamp()}] 💾 Salvando manifest final no disco...`);
  await saveManifestAtomic(manifest);
  console.log(`[${getTimestamp()}] 💾 Manifest salvo com sucesso.`);

  if (prisma && dbBatchUpdates.length > 0) {
    console.log(`[${getTimestamp()}] 🗄️ Sincronizando últimos ${dbBatchUpdates.length} registros no PostgreSQL...`);
    const finalBatch = dbBatchUpdates.splice(0, dbBatchUpdates.length);
    await syncDbBatch(prisma, finalBatch);
    await prisma.$disconnect();
    console.log(`[${getTimestamp()}] ✅ Banco de dados atualizado com sucesso.`);
  }

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTimeMin = (totalTimeSec / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`🎉 [${getTimestamp()}] DOWNLOADS FINALIZADOS COM SUCESSO!`);
  console.log(`⏱️  Tempo total: ${totalTimeMin} minutos (${totalTimeSec}s)`);
  console.log(`✅ Novas imagens salvas: ${downloadedCount}`);
  console.log(`⚡ Imagens já existentes puladas: ${alreadyDownloadedCount}`);
  console.log(`❌ Falhas: ${failedCount}`);
  console.log(`📁 Diretório local: ${CHARACTERS_DIR}`);
  console.log('════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(`❌ Erro fatal:`, err);
  process.exit(1);
});
