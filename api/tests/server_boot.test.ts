import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

// Se estiver executando fora do container Docker (no host local), adapta endpoints expostos
if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

describe('Server Boot & Route Integrity', () => {
  let server: any;

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  it('buildServer deve inicializar sem rotas duplicadas ou erros de plugins', async () => {
    expect(server).toBeDefined();
  });

  it('deve aceitar parâmetros de rota com mais de 100 caracteres sem retornar 404 de rota inexistente (maxParamLength)', async () => {
    // Slug real com 145 caracteres (ex.: Alucia Citrus de Katainaka no Ossan Kensei ni Naru)
    const longCharId = 'allucia-citrus-katainaka-no-ossan-kensei-ni-naru-tada-no-inaka-no-kenjutsu-shihan-datta-noni-taisei-shita-deshitachi-ga-ore-wo-hanattekurenai-ken';
    expect(longCharId.length).toBeGreaterThan(100);

    const res = await server.inject({
      method: 'GET',
      url: `/api/web/user/55657800-0c2f-4bed-a2fa-d81f21169c52/divorce/preview/${longCharId}?token=invalid-token`,
    });

    // Não deve ser 404 (Route not found); deve alcançar a rota e retornar 401 por token inválido
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});
