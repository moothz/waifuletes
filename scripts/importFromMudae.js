import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  slugifyCharacter,
  cleanSeriesTitle,
  calculateRarityFromMudaeRank,
  normalizeName,
  normalizeSeries,
  seriesMatch,
  pickHigherRarity,
} from './characterUtils.js';
import { translateToPtBr } from './translateUtils.js';

const execFileAsync = promisify(execFile);

/**
 * 📥 Importador & Atualizador Oficial Waifuletes via Mudae.net (Modo Resiliente / Overnight)
 * 
 * Atualiza e complementa o catálogo local:
 * - Se já existe a combinação (personagem + anime normalizados):
 *     -> Atualiza a base local: rank real, descrição (se faltante/solicitada) e adiciona a foto como adicional.
 * - Se for novo:
 *     -> Complementa o catálogo com raridade calculada pelo rank, aliases e imagens.
 * - Suporta Checkpointing automático (.mudae_checkpoint.json), retries exponenciais e sincronização contínua no PostgreSQL.
 * 
 * Uso:
 *   node scripts/importFromMudae.js [quantidade|all] [apenas_waifus: true|false] [categoria: all|anime|games|manga|visualnovels] [--sync-db] [--fetch-details] [--reset-checkpoint] [--start-page <N>]
 * 
 * Exemplos:
 *   node scripts/importFromMudae.js all false all --sync-db
 *   DATABASE_URL="postgresql://user:pass@localhost:5432/waifuletes" nohup node scripts/importFromMudae.js all false all --sync-db > mudae_overnight.log 2>&1 &
 */

const rawArg2 = process.argv[2] || '5000';
const QUANTITY_TO_ADD = rawArg2.toLowerCase() === 'all' ? Infinity : parseInt(rawArg2, 10);
const ONLY_FEMALE = process.argv[3] === 'true'; // false = todos os gêneros
const CATEGORY = (process.argv[4] && !process.argv[4].startsWith('--')) ? process.argv[4].toLowerCase() : 'all';

const SYNC_DB = process.argv.includes('--sync-db');
const FETCH_DETAILS = process.argv.includes('--fetch-details');
const UPDATE_DESCRIPTIONS = process.argv.includes('--update-descriptions');
const RESET_CHECKPOINT = process.argv.includes('--reset-checkpoint');

// Argumento opcional --start-page <N>
let customStartPage = null;
const startPageIdx = process.argv.indexOf('--start-page');
if (startPageIdx !== -1 && process.argv[startPageIdx + 1]) {
  customStartPage = parseInt(process.argv[startPageIdx + 1], 10);
}

const MANIFEST_PATH = path.resolve(process.cwd(), 'media/manifests/characters.json');
const BACKUP_PATH = path.resolve(process.cwd(), 'media/manifests/characters.backup.json');
const CHECKPOINT_PATH = path.resolve(process.cwd(), 'media/manifests/.mudae_checkpoint.json');

const USER_AGENT = 'Waifuletes-OpenSource/1.0 (+https://github.com/moothz/waifuletes; character-sync)';

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCheckpoint() {
  if (RESET_CHECKPOINT) {
    console.log('🔄 Flag --reset-checkpoint detectada. Checkpoint anterior será ignorado.');
    return null;
  }
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      const raw = readFileSync(CHECKPOINT_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data.lastPage === 'number') {
        return data;
      }
    } catch (e) {
      console.warn('⚠️ Falha ao ler checkpoint:', e.message);
    }
  }
  return null;
}

function saveCheckpoint(page, stats = {}) {
  try {
    const data = {
      lastPage: page,
      timestamp: getTimestamp(),
      ...stats,
    };
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ Falha ao salvar checkpoint:', e.message);
  }
}

/**
 * Faz requisição HTTP à API do Mudae via curl com tratamento robusto de retries e cabeçalhos de navegador.
 */
async function fetchMudaeSearch(page, category = 'all', onlyFemale = false, maxRetries = 5) {
  let url = `https://mudae.net/api/search?currentPage=${page}&type=character`;
  if (onlyFemale) {
    url += '&genders[]=female';
  }
  if (category && category !== 'all') {
    url += `&category=${encodeURIComponent(category)}`;
  }

  const args = [
    '-s',
    url,
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', 'Accept: application/json, text/plain, */*',
    '-H', 'Referer: https://mudae.net/search?type=character',
    '-H', 'Sec-Fetch-Dest: empty',
    '-H', 'Sec-Fetch-Mode: cors',
    '-H', 'Sec-Fetch-Site: same-origin',
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024, timeout: 20000 });
      const trimmed = stdout.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        throw new Error(`Resposta não é JSON: ${trimmed.slice(0, 150)}`);
      }
      return JSON.parse(trimmed);
    } catch (err) {
      const backoff = Math.min(attempt * 3000, 30000);
      console.warn(`[${getTimestamp()}] ⚠️ [Página ${page}] Tentativa ${attempt}/${maxRetries} falhou: ${err.message}. Aguardando ${backoff / 1000}s...`);
      await sleep(backoff);
      if (attempt === maxRetries) {
        // Último fallback: espera 45s e tenta uma última vez antes de abortar
        console.warn(`[${getTimestamp()}] 🚨 Espera prolongada de 45s antes da tentativa final para página ${page}...`);
        await sleep(45000);
        const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
        return JSON.parse(stdout.trim());
      }
    }
  }
}

/**
 * Busca página HTML do personagem no Mudae para extrair descrição personalizada (se existente).
 */
async function fetchCharacterDescription(idChar, name) {
  try {
    const slug = encodeURIComponent(name.trim());
    const url = `https://mudae.net/character/${idChar}/${slug}`;
    const args = [
      '-s',
      url,
      '-H', `User-Agent: ${USER_AGENT}`,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Referer: https://mudae.net/search?type=character',
    ];
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 5 * 1024 * 1024, timeout: 15000 });

    const descSectionMatch = stdout.match(/Description\s+\[Clear\]\s*<\/span>([\s\S]*?)<\/div>/i) ||
                             stdout.match(/Description\s+update\s+source\s*<\/span>([\s\S]*?)<\/div>/i);
    let desc = null;
    if (descSectionMatch) {
      desc = descSectionMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!desc || desc.length < 15) {
      const metaMatch = stdout.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      if (metaMatch && !metaMatch[1].startsWith('Information about') && !metaMatch[1].includes('biography, related characters and more')) {
        desc = metaMatch[1].trim();
      }
    }

    if (desc && desc.length > 20) {
      return await translateToPtBr(desc);
    }
  } catch (e) {
    // Silencioso em caso de falha de scraping
  }
  return null;
}

async function saveManifest(characterMap) {
  const characters = Array.from(characterMap.values());
  const tempPath = `${MANIFEST_PATH}.tmp`;
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(
    tempPath,
    JSON.stringify({ version: '1.0', characters }, null, 2),
    'utf-8'
  );
  await fs.rename(tempPath, MANIFEST_PATH);
  return characters.length;
}

/**
 * Descarrega lotes pendentes diretamente no PostgreSQL
 */
async function flushToDatabase(prisma, toInsertSet, toUpdateSet) {
  if (!prisma) return;

  const toInsert = Array.from(toInsertSet);
  const toUpdate = Array.from(toUpdateSet);

  try {
    if (toInsert.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const chunk = toInsert.slice(i, i + BATCH);
        await prisma.character.createMany({
          data: chunk.map((c) => ({
            id: c.id,
            name: c.name,
            series: c.series,
            description: c.description,
            gender: c.gender,
            baseRarity: c.baseRarity,
            rank: c.rank ?? null,
            tags: c.tags,
            imageUrls: c.images,
          })),
          skipDuplicates: true,
        });
      }
      toInsertSet.clear();
    }

    if (toUpdate.length > 0) {
      for (const c of toUpdate) {
        await prisma.character.updateMany({
          where: { id: c.id },
          data: {
            series: c.series,
            description: c.description,
            baseRarity: c.baseRarity,
            rank: c.rank ?? null,
            tags: c.tags,
            imageUrls: c.images,
          },
        });
      }
      toUpdateSet.clear();
    }
  } catch (err) {
    console.warn(`[${getTimestamp()}] ⚠️ Erro ao descarregar no PostgreSQL: ${err.message}. Os dados continuam salvos no manifest JSON.`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        WAIFULETES - IMPORTAÇÃO OFICIAL MUDAE.NET           ║');
  console.log('║               (MODO RESILIENTE / OVERNIGHT)                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`[${getTimestamp()}] 🎯 Meta de novos personagens: ${QUANTITY_TO_ADD === Infinity ? 'Sem limite (ALL)' : QUANTITY_TO_ADD}`);
  console.log(`[${getTimestamp()}] 👥 Filtro de gênero: ${ONLY_FEMALE ? 'Apenas Waifus (FEMALE)' : 'Todos os gêneros (Waifus, Husbandos e Outros)'}`);
  console.log(`[${getTimestamp()}] 📁 Categoria Mudae: ${CATEGORY}`);
  if (SYNC_DB) console.log(`[${getTimestamp()}] 🔄 Sincronização contínua com PostgreSQL: ATIVA (--sync-db)`);
  if (FETCH_DETAILS) console.log(`[${getTimestamp()}] 📖 Busca profunda de descrições: ATIVA (--fetch-details)`);

  const characterMap = new Map(); // id (slug) -> character object
  const exactMap = new Map();     // `${normName}::${normSeries}` -> character object
  const nameMap = new Map();      // `${normName}` -> Array<character object>

  // 1. Carregar manifest atual
  if (existsSync(MANIFEST_PATH)) {
    try {
      const content = await fs.readFile(MANIFEST_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.characters)) {
        for (const c of parsed.characters) {
          characterMap.set(c.id, c);

          const nName = normalizeName(c.name);
          const nSeries = normalizeSeries(c.series);
          const key = `${nName}::${nSeries}`;
          exactMap.set(key, c);

          if (!nameMap.has(nName)) {
            nameMap.set(nName, []);
          }
          nameMap.get(nName).push(c);
        }
        console.log(`[${getTimestamp()}] 📦 Catálogo local carregado: ${characterMap.size} personagens em cache.`);

        // Salvar backup se não existir
        if (!existsSync(BACKUP_PATH)) {
          await fs.writeFile(BACKUP_PATH, content, 'utf-8');
          console.log(`[${getTimestamp()}] 💾 Backup de segurança criado em: ${BACKUP_PATH}`);
        }
      }
    } catch (e) {
      console.warn(`[${getTimestamp()}] ⚠️ Não foi possível carregar o manifest atual. Iniciando novo catálogo.`);
    }
  }

  // 2. Determinar página inicial (Checkpoint ou CLI)
  let currentPage = 0;
  let processedTotal = 0;
  let newlyAdded = 0;
  let updatedExisting = 0;
  let imagesAdded = 0;

  if (customStartPage !== null) {
    currentPage = customStartPage;
    console.log(`[${getTimestamp()}] ⏩ Início forçado na página ${currentPage} via argumento --start-page.`);
  } else {
    const cp = loadCheckpoint();
    if (cp && typeof cp.lastPage === 'number') {
      currentPage = cp.lastPage + 1;
      processedTotal = cp.processedTotal || 0;
      newlyAdded = cp.newlyAdded || 0;
      updatedExisting = cp.updatedExisting || 0;
      imagesAdded = cp.imagesAdded || 0;
      console.log(`[${getTimestamp()}] 🔄 CHECKPOINT ENCONTRADO! Retomando automaticamente da página ${currentPage} (Última salva: ${cp.lastPage} em ${cp.timestamp}).`);
    }
  }

  // 3. Inicializar Prisma se SYNC_DB ativo
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
    } catch (dbInitErr) {
      console.warn(`[${getTimestamp()}] ⚠️ Falha ao conectar ao PostgreSQL: ${dbInitErr.message}. Continuando em modo arquivo.`);
      prisma = null;
    }
  }

  const charactersToDbUpdate = new Set();
  const charactersToDbInsert = new Set();

  // Tratamento de encerramento gracioso (Ctrl+C / SIGTERM)
  let isShuttingDown = false;
  async function gracefulExit(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${getTimestamp()}] 🛑 Sinal ${signal} recebido. Salvando checkpoint e manifest com segurança...`);
    try {
      await saveManifest(characterMap);
      saveCheckpoint(Math.max(0, currentPage - 1), {
        processedTotal,
        newlyAdded,
        updatedExisting,
        imagesAdded,
      });
      if (prisma) {
        console.log(`[${getTimestamp()}] 🗄️  Descarregando alterações pendentes no PostgreSQL...`);
        await flushToDatabase(prisma, charactersToDbInsert, charactersToDbUpdate);
        await prisma.$disconnect();
      }
      console.log(`[${getTimestamp()}] ✅ Progresso preservado com sucesso. Até logo!`);
    } catch (saveErr) {
      console.error(`[${getTimestamp()}] ❌ Erro ao salvar durante saída:`, saveErr.message);
    }
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulExit('SIGINT'));
  process.on('SIGTERM', () => gracefulExit('SIGTERM'));

  let hasMore = true;
  console.log(`\n[${getTimestamp()}] 🚀 Iniciando varredura a partir da página ${currentPage}...\n`);

  while (hasMore && newlyAdded < QUANTITY_TO_ADD && !isShuttingDown) {
    let data;
    try {
      data = await fetchMudaeSearch(currentPage, CATEGORY, ONLY_FEMALE);
    } catch (e) {
      console.error(`[${getTimestamp()}] ❌ Erro fatal persistente na página ${currentPage}: ${e.message}`);
      // Salva progresso e interrompe com segurança
      await saveManifest(characterMap);
      saveCheckpoint(Math.max(0, currentPage - 1), { processedTotal, newlyAdded, updatedExisting, imagesAdded });
      break;
    }

    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      console.log(`[${getTimestamp()}] 🏁 Nenhum resultado retornado na página ${currentPage}. Fim do catálogo do Mudae atingido!`);
      break;
    }

    hasMore = Boolean(data.more);

    for (const m of data.results) {
      processedTotal++;

      const mNameNorm = normalizeName(m.name);
      const mSeriesNorm = normalizeSeries(m.series);
      const exactKey = `${mNameNorm}::${mSeriesNorm}`;

      // Localizar se já existe combinação Personagem + Anime normalizados
      let match = exactMap.get(exactKey);

      if (!match && nameMap.has(mNameNorm)) {
        const candidates = nameMap.get(mNameNorm);
        match = candidates.find((c) =>
          seriesMatch(m.series, c.series, c.description || '', (c.tags || []).join(' '))
        );

        if (!match && candidates.length === 1) {
          const only = candidates[0];
          if (seriesMatch(m.series, only.series, only.description || '')) {
            match = only;
          }
        }
      }

      // Checagem de fallback por slug ID
      if (!match) {
        const candidateSlug = slugifyCharacter(m.name);
        if (characterMap.has(candidateSlug)) {
          const c = characterMap.get(candidateSlug);
          if (seriesMatch(m.series, c.series, c.description || '')) {
            match = c;
          }
        }
      }

      // =========================================================================
      // CASO 1: PERSONAGEM + ANIME JÁ EXISTE -> APENAS ATUALIZAR A BASE LOCAL
      // =========================================================================
      if (match) {
        let changed = false;

        // A. Rank Real & Raridade Canônica
        if (m.rank && (!match.rank || match.rank > m.rank)) {
          match.rank = m.rank;
          match.mudaeId = m.idChar;
          const mudaeRarity = calculateRarityFromMudaeRank(m.rank);
          match.baseRarity = pickHigherRarity(match.baseRarity, mudaeRarity);
          changed = true;
        }

        if (m.rank) {
          if (!Array.isArray(match.tags)) match.tags = [];
          const rankTag = `mudae-rank:${m.rank}`;
          if (!match.tags.includes(rankTag)) {
            match.tags = match.tags.filter((t) => !t.startsWith('mudae-rank:'));
            match.tags.push(rankTag);
            changed = true;
          }
        }

        // B. Foto como Adicional
        if (m.image) {
          if (!Array.isArray(match.images)) match.images = [];
          if (!match.images.includes(m.image)) {
            match.images.push(m.image);
            imagesAdded++;
            changed = true;
          }
        }

        // C. Aliases oficiais do Mudae
        if (m.aliases) {
          const aliasList = m.aliases.split('|').map((a) => a.trim()).filter(Boolean);
          if (!Array.isArray(match.aliases)) match.aliases = [];
          for (const alias of aliasList) {
            if (!match.aliases.includes(alias)) {
              match.aliases.push(alias);
              changed = true;
            }
          }
        }

        // D. Descrição
        const isDescEmpty = !match.description || match.description.trim().length < 40;
        if (isDescEmpty || UPDATE_DESCRIPTIONS) {
          if (FETCH_DETAILS) {
            const fetchedDesc = await fetchCharacterDescription(m.idChar, m.name);
            if (fetchedDesc) {
              match.description = fetchedDesc;
              changed = true;
            }
          }
          if (!match.description) {
            const art = (match.gender === 'MALE') ? 'um' : 'uma';
            match.description = `${match.name} é ${art} personagem de ${cleanSeriesTitle(m.series)}.`;
            changed = true;
          }
        }

        // E. Corrigir título canônico de série se o anterior era genérico/crossover
        const cleanMSeries = cleanSeriesTitle(m.series);
        if (match.series !== cleanMSeries && normalizeSeries(match.series) === mSeriesNorm) {
          match.series = cleanMSeries;
          changed = true;
        }

        if (changed) {
          updatedExisting++;
          charactersToDbUpdate.add(match);
        }
        continue;
      }

      // =========================================================================
      // CASO 2: NOVO PERSONAGEM -> COMPLEMENTAR A BASE DE DADOS
      // =========================================================================
      if (newlyAdded >= QUANTITY_TO_ADD) break;

      let slug = slugifyCharacter(m.name);
      if (!slug) slug = `mudae-${m.idChar}`;

      if (characterMap.has(slug)) {
        slug = slugifyCharacter(`${m.name}-${cleanSeriesTitle(m.series)}`);
      }
      if (characterMap.has(slug)) {
        slug = `${slug}-${m.idChar}`;
      }

      let gender = 'FEMALE';
      const rawG = (m.gender || '').toLowerCase();
      if (rawG === 'male') gender = 'MALE';
      else if (rawG === 'both' || rawG === 'other') gender = 'OTHER';

      const cleanSeries = cleanSeriesTitle(m.series);
      const mudaeRarity = calculateRarityFromMudaeRank(m.rank);

      let description = null;
      if (FETCH_DETAILS) {
        description = await fetchCharacterDescription(m.idChar, m.name);
      }
      if (!description) {
        const art = (gender === 'MALE') ? 'um' : 'uma';
        description = `${m.name.trim()} é ${art} personagem de ${cleanSeries}.`;
      }

      const aliases = m.aliases ? m.aliases.split('|').map((a) => a.trim()).filter(Boolean) : [];
      const tags = [];
      if (CATEGORY === 'games') tags.push('game', 'gacha');
      else tags.push('anime');
      if (m.rank) tags.push(`mudae-rank:${m.rank}`);

      const newChar = {
        id: slug,
        name: m.name.trim(),
        series: cleanSeries,
        description,
        gender,
        baseRarity: mudaeRarity,
        rank: m.rank,
        mudaeId: m.idChar,
        aliases,
        tags,
        images: m.image ? [m.image] : [],
      };

      characterMap.set(slug, newChar);

      const nName = normalizeName(newChar.name);
      const nSeries = normalizeSeries(newChar.series);
      exactMap.set(`${nName}::${nSeries}`, newChar);
      if (!nameMap.has(nName)) nameMap.set(nName, []);
      nameMap.get(nName).push(newChar);

      newlyAdded++;
      charactersToDbInsert.add(newChar);
    }

    // Gravação periódica de Checkpoint e Manifest a cada 10 páginas
    if (currentPage % 10 === 0 || currentPage === 0) {
      await saveManifest(characterMap);
      saveCheckpoint(currentPage, {
        processedTotal,
        newlyAdded,
        updatedExisting,
        imagesAdded,
      });

      // Se conectado ao PostgreSQL, descarrega lotes acumulados
      if (prisma && (charactersToDbInsert.size >= 300 || charactersToDbUpdate.size >= 300)) {
        await flushToDatabase(prisma, charactersToDbInsert, charactersToDbUpdate);
      }

      console.log(
        `[${getTimestamp()}] 📄 [Página ${currentPage.toString().padStart(4, ' ')}] Processados: ${processedTotal.toString().padStart(6, ' ')} | Atualizados: ${updatedExisting.toString().padStart(6, ' ')} | Novos: ${newlyAdded.toString().padStart(5, ' ')} | Fotos adicionadas: ${imagesAdded.toString().padStart(5, ' ')}`
      );
    }

    currentPage++;
    await sleep(350); // Delay seguro contra Cloudflare rate-limits
  }

  // Descarregamento final
  console.log(`\n[${getTimestamp()}] 💾 Salvando manifest final consolidado...`);
  const totalInCatalog = await saveManifest(characterMap);
  saveCheckpoint(Math.max(0, currentPage - 1), {
    processedTotal,
    newlyAdded,
    updatedExisting,
    imagesAdded,
  });

  if (prisma) {
    console.log(`[${getTimestamp()}] 🗄️  Descarregando lote final no PostgreSQL...`);
    await flushToDatabase(prisma, charactersToDbInsert, charactersToDbUpdate);
    await prisma.$disconnect();
    console.log(`[${getTimestamp()}] ✅ PostgreSQL sincronizado com sucesso.`);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`🎉 [${getTimestamp()}] IMPORTAÇÃO & ATUALIZAÇÃO FINALIZADAS!`);
  console.log(`   • Total de personagens processados do Mudae: ${processedTotal}`);
  console.log(`   • Personagens locais existentes atualizados: ${updatedExisting}`);
  console.log(`   • Fotos adicionais inseridas: ${imagesAdded}`);
  console.log(`   • Novos personagens complementados: ${newlyAdded}`);
  console.log(`   • Total geral no catálogo Waifuletes: ${totalInCatalog}`);
  console.log(`   • Última página varrida: ${currentPage - 1}`);
  console.log('════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(`[${getTimestamp()}] ❌ Falha fatal no importador:`, err);
  process.exit(1);
});
