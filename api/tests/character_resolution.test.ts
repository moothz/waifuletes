import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CharacterService } from '../src/services/CharacterService.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

// Sem fallback com credenciais: o teste só roda quando DATABASE_URL está configurada.
const DATABASE_URL = process.env.DATABASE_URL?.replace('postgres:5432', '127.0.0.1:5433');

describe.skipIf(!DATABASE_URL)('🔍 Resolução de Personagens e Desambiguação de IDs Homônimos', () => {
  let prisma: PrismaClient;
  let characterService: CharacterService;

  const TEST_ID_1 = 'test_char_resolution_homonym';
  const TEST_ID_2 = 'test_char_resolution_homonym_other';
  const HOMONYM_NAME = 'Test Homonym Character';

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_URL } },
    });
    characterService = new CharacterService(prisma);

    // Limpa quaisquer resíduos anteriores
    await prisma.character.deleteMany({
      where: { id: { in: [TEST_ID_1, TEST_ID_2] } },
    });

    // Cria dois personagens com o MESMO nome, onde o ID de um é exatamente parte da busca
    // Ex: TEST_ID_1 tem id "test_char_resolution_homonym", e TEST_ID_2 tem outro id, mas ambos chamam "Test Homonym Character"
    await prisma.character.create({
      data: {
        id: TEST_ID_1,
        name: HOMONYM_NAME,
        series: 'Test Series 1',
        baseRarity: 'RARE',
        isActive: true,
      },
    });

    await prisma.character.create({
      data: {
        id: TEST_ID_2,
        name: HOMONYM_NAME,
        series: 'Test Series 2',
        baseRarity: 'LEGENDARY',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    // Tolerância zero para resíduos de teste
    await prisma.character.deleteMany({
      where: { id: { in: [TEST_ID_1, TEST_ID_2] } },
    });
    await prisma.$disconnect();
  });

  it('findCharacter deve priorizar ID exato sobre busca por nome, evitando retornar homônimo', async () => {
    const resolved = await characterService.findCharacter(TEST_ID_1);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(TEST_ID_1);
    expect(resolved?.baseRarity).toBe('RARE');

    const resolved2 = await characterService.findCharacter(TEST_ID_2);
    expect(resolved2).not.toBeNull();
    expect(resolved2?.id).toBe(TEST_ID_2);
    expect(resolved2?.baseRarity).toBe('LEGENDARY');
  });

  it('getCharacterById deve priorizar ID exato sobre busca por nome', async () => {
    const char1 = await characterService.getCharacterById(TEST_ID_1);
    expect(char1).not.toBeNull();
    expect(char1?.id).toBe(TEST_ID_1);
    expect(char1?.baseRarity).toBe('RARE');

    const char2 = await characterService.getCharacterById(TEST_ID_2);
    expect(char2).not.toBeNull();
    expect(char2?.id).toBe(TEST_ID_2);
    expect(char2?.baseRarity).toBe('LEGENDARY');
  });

  it('findCharacter deve retornar personagem ativo por nome quando não encontrar por ID', async () => {
    const byName = await characterService.findCharacter(HOMONYM_NAME);
    expect(byName).not.toBeNull();
    expect([TEST_ID_1, TEST_ID_2]).toContain(byName?.id);
  });
});
