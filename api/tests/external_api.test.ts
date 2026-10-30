import { describe, it, expect } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3030';
const EXTERNAL_KEY = (process.env.EXTERNAL_USAGE_API || '').split(',')[0].trim();

describe('🌐 API Externa de Catálogo & Storage Remoto', () => {
  it('deve rejeitar chamadas sem chave com 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/characters/pool`);
    expect(res.status).toBe(401);

    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('deve rejeitar chamadas com chave externa inválida com 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/characters/pool`, {
      headers: {
        Authorization: 'Bearer chave_invalida_totalmente_incorreta_123456',
      },
    });
    expect(res.status).toBe(401);
  });

  it('deve autenticar com sucesso usando Authorization: Bearer <key>', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/characters/pool`, {
      headers: {
        Authorization: `Bearer ${EXTERNAL_KEY}`,
      },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.pool)).toBe(true);
    expect(json.pool.length).toBeGreaterThan(0);

    // Valida que o pool contém apenas metadados leves e nenhum dado relacional
    const first = json.pool[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('baseRarity');
    expect(first).toHaveProperty('gender');
    expect(first).not.toHaveProperty('haremEntries');
    expect(first).not.toHaveProperty('wishlists');
    expect(first).not.toHaveProperty('users');
  });

  it('deve autenticar com sucesso usando query param ?key=<key>', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/characters/pool?key=${EXTERNAL_KEY}`);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
  });

  it('GET /api/v1/external/characters deve retornar lista de personagens crus com paginação', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/characters?limit=5`, {
      headers: {
        Authorization: `Bearer ${EXTERNAL_KEY}`,
      },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.characters)).toBe(true);
    expect(json.data.characters.length).toBeLessThanOrEqual(5);
    expect(json.data.pagination).toHaveProperty('total');
    expect(json.data.pagination).toHaveProperty('page', 1);

    for (const char of json.data.characters) {
      expect(char).toHaveProperty('id');
      expect(char).toHaveProperty('name');
      expect(char).toHaveProperty('series');
      expect(char).toHaveProperty('baseRarity');
      expect(char).not.toHaveProperty('haremEntries');
      expect(char).not.toHaveProperty('wishlist');
      expect(char).not.toHaveProperty('likeCount');
    }
  });

  it('GET /api/v1/external/characters/:id deve retornar detalhes de personagem existente e 404 para inexistente', async () => {
    // 1. Busca primeiro personagem do pool
    const poolRes = await fetch(`${BASE_URL}/api/v1/external/characters/pool?key=${EXTERNAL_KEY}`);
    const poolJson = (await poolRes.json()) as any;
    const testId = poolJson.pool[0].id;

    // 2. Busca por ID
    const charRes = await fetch(`${BASE_URL}/api/v1/external/characters/${testId}?key=${EXTERNAL_KEY}`);
    expect(charRes.status).toBe(200);

    const charJson = (await charRes.json()) as any;
    expect(charJson.success).toBe(true);
    expect(charJson.data.id).toBe(testId);
    expect(charJson.data).toHaveProperty('name');
    expect(charJson.data).toHaveProperty('series');
    expect(charJson.data).toHaveProperty('tags');
    expect(charJson.data).not.toHaveProperty('haremEntries');

    // 3. ID inexistente
    const notFoundRes = await fetch(`${BASE_URL}/api/v1/external/characters/id_completamente_inexistente_99999?key=${EXTERNAL_KEY}`);
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /api/v1/external/media/* deve servir mídia com headers de cache apropriados', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/external/media/default.jpg?key=${EXTERNAL_KEY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/');
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });
});
