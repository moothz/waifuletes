import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

export const ManifestCharacterSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-_]+$/, 'ID do personagem deve conter apenas caracteres alfanuméricos minúsculos, hífens ou underscores'),
  name: z.string().min(1),
  series: z.string().min(1),
  description: z.string().optional().nullable(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER']).default('FEMALE'),
  baseRarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']).default('COMMON'),
  rank: z.number().optional().nullable(),
  aliases: z.array(z.string()).optional().nullable(),
  tags: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
}).passthrough();

export const ManifestSchema = z.object({
  version: z.string().default('1.0'),
  characters: z.array(ManifestCharacterSchema),
});

export type ManifestCharacter = z.infer<typeof ManifestCharacterSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

export async function loadManifestFromFile(filePath: string): Promise<Manifest> {
  const content = await fs.readFile(filePath, 'utf-8');
  const json = JSON.parse(content);
  return ManifestSchema.parse(json);
}

export function parseManifestString(content: string): Manifest {
  const json = JSON.parse(content);
  return ManifestSchema.parse(json);
}
