import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { loadManifestFromFile } from '../utils/manifestLoader.js';
import { CharacterService } from '../services/CharacterService.js';
import { config } from '../config.js';

const prisma = new PrismaClient();
const characterService = new CharacterService(prisma);

async function main() {
  // Permite passar caminho personalizado como argumento: node importManifest.js [caminho]
  const customArg = process.argv[2];

  let manifestPath = customArg
    ? path.resolve(customArg)
    : path.resolve(config.MEDIA_DIR, 'manifests', 'characters.json');

  if (!fs.existsSync(manifestPath)) {
    const examplePath = path.resolve(config.MEDIA_DIR, 'manifests', 'characters.example.json');
    if (fs.existsSync(examplePath)) {
      console.log(`ℹ️ '${manifestPath}' não encontrado. Utilizando fallback: '${examplePath}'`);
      manifestPath = examplePath;
    } else {
      console.error(`❌ Nenhum manifest encontrado em: ${manifestPath}`);
      process.exit(1);
    }
  }

  console.log(`Carregando manifest de personagens em: ${manifestPath}`);

  try {
    const manifest = await loadManifestFromFile(manifestPath);
    console.log(`Encontrados ${manifest.characters.length} personagens no manifest. Sincronizando...`);

    const characters = manifest.characters;
    const CHUNK_SIZE = 1000;
    let count = 0;

    for (let i = 0; i < characters.length; i += CHUNK_SIZE) {
      const chunk = characters.slice(i, i + CHUNK_SIZE).map((char) => ({
        id: char.id,
        name: char.name,
        series: char.series,
        description: char.description,
        gender: char.gender,
        baseRarity: char.baseRarity,
        rank: (char as any).rank ?? null,
        tags: char.tags,
        imageUrls: char.images,
      }));

      const res = await prisma.character.createMany({
        data: chunk,
        skipDuplicates: true,
      });

      count += res.count;
      console.log(`⚡ Sincronizados ${Math.min(i + CHUNK_SIZE, characters.length)}/${characters.length} (+${res.count} novos inseridos)...`);
    }

    console.log(`✅ Sucesso: ${count} novos personagens inseridos no banco de dados (Total no catálogo: ${characters.length}).`);
  } catch (err: any) {
    console.error(`❌ Erro ao carregar manifest: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
