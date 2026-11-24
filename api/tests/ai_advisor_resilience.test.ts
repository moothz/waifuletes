import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { RarityAdvisorService } from '../src/services/RarityAdvisorService.js';
import { adminWebRoutes } from '../src/routes/web/adminWebRoutes.js';
import { DomainError } from '../src/errors/DomainError.js';

describe('🤖 RarityAdvisorService — Resiliência com tool_calls, modelos thinking e timeout', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deve enviar tools + tool_choice: "none" e instrução final na 2ª chamada após tool_calls e limpar tags <think>', async () => {
    const advisor = new RarityAdvisorService();
    const llmRequests: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/chat/completions')) {
        const body = JSON.parse(opts.body);
        llmRequests.push(body);

        if (llmRequests.length === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model: 'qwen3.8:27b-uncensored',
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    reasoning: 'Preciso pesquisar o rank Mudae.',
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'web_search',
                          arguments: JSON.stringify({ query: 'Frieren mudae rank' }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 500, completion_tokens: 80 },
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'qwen3.8:27b-uncensored',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: '<think>Raciocínio residual</think>🤖 <b>Parecer da IA</b>:\n🎯 <b>Veredito:</b> PROCEDENTE\n💡 <b>Raridade Recomendada:</b> LEGENDARY',
                },
              },
            ],
            usage: { prompt_tokens: 700, completion_tokens: 180 },
          }),
        };
      }

      if (urlStr.includes('html.duckduckgo.com')) {
        // Simula HTTP 202 (anti-bot challenge) -> deve cair no fallback da Wikipedia
        return { ok: true, status: 202, text: async () => '<html>challenge</html>' };
      }

      if (urlStr.includes('wikipedia.org')) {
        return {
          ok: true,
          status: 200,
          json: async () => ['Frieren', ['Frieren'], ['Protagonista de Sousou no Frieren']],
        };
      }

      return { ok: false, status: 404, text: async () => 'not found' };
    });

    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
    };

    const result = await advisor.evaluateRaritySuggestionDetailed(
      {
        id: 'sug_qwen_tool_1',
        type: 'RARITY',
        characterName: 'Frieren',
        series: 'Sousou no Frieren',
        currentRarity: 'RARE',
        suggestedRarity: 'LEGENDARY',
        reason: 'Protagonista muito popular',
      },
      mockRedis as any
    );

    expect(result.error).toBeUndefined();
    expect(result.evaluation).not.toBeNull();
    expect(result.evaluation?.model).toBe('qwen3.8:27b-uncensored');
    expect(result.evaluation?.response).not.toContain('<think>');
    expect(result.evaluation?.response).toContain('PROCEDENTE');
    expect(result.evaluation?.searchedQueries).toEqual(['[Web] Frieren mudae rank']);

    expect(llmRequests).toHaveLength(2);
    expect(llmRequests[0].tool_choice).toBe('auto');
    expect(llmRequests[0].tools).toHaveLength(5);
    // 2ª chamada DEVE manter tools e travar tool_choice em 'none' para impedir tool call oculta no vLLM
    expect(llmRequests[1].tools).toHaveLength(5);
    expect(llmRequests[1].tool_choice).toBe('none');
    expect(llmRequests[1].messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('sem chamar novas ferramentas'),
    });
  });

  it('deve suportar as novas tools search_character_info e search_anime_info via AniList GraphQL em paralelo', async () => {
    const advisor = new RarityAdvisorService();
    const llmRequests: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/chat/completions')) {
        const body = JSON.parse(opts.body);
        llmRequests.push(body);
        if (llmRequests.length === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model: 'qwen3.8:27b-uncensored',
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'tc_char',
                        type: 'function',
                        function: {
                          name: 'search_character_info',
                          arguments: JSON.stringify({ name: 'Frieren', series: 'Sousou no Frieren' }),
                        },
                      },
                      {
                        id: 'tc_anime',
                        type: 'function',
                        function: {
                          name: 'search_anime_info',
                          arguments: JSON.stringify({ query: 'Sousou no Frieren' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'qwen3.8:27b-uncensored',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: '🤖 <b>Parecer da IA</b>:\n🎯 <b>Veredito:</b> PROCEDENTE\n💡 <b>Raridade Recomendada:</b> LEGENDARY',
                },
              },
            ],
          }),
        };
      }

      if (urlStr.includes('graphql.anilist.co')) {
        const gqlBody = JSON.parse(opts.body);
        if (gqlBody.query.includes('characters(')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                Page: {
                  characters: [
                    {
                      name: { full: 'Frieren', alternative: ['Frieren the Slayer'] },
                      favourites: 22768,
                      description: 'Maga elfa protagonista. ~!spoiler oculto!~',
                      media: {
                        edges: [
                          {
                            characterRole: 'MAIN',
                            node: {
                              title: { romaji: 'Sousou no Frieren', english: 'Frieren' },
                              type: 'ANIME',
                              seasonYear: 2023,
                              popularity: 501354,
                              favourites: 57298,
                              averageScore: 90,
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              Page: {
                media: [
                  {
                    title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End" },
                    type: 'ANIME',
                    format: 'TV',
                    seasonYear: 2023,
                    episodes: 28,
                    averageScore: 90,
                    popularity: 501354,
                    favourites: 57298,
                    genres: ['Adventure', 'Drama', 'Fantasy'],
                    studios: { nodes: [{ name: 'MADHOUSE' }] },
                    description: 'Uma jornada após derrotar o Rei Demônio.',
                  },
                ],
              },
            },
          }),
        };
      }

      return { ok: false, status: 404, text: async () => '' };
    });

    const result = await advisor.evaluateRaritySuggestionDetailed({
      id: 'sug_anilist_1',
      type: 'RARITY',
      characterName: 'Frieren',
      series: 'Sousou no Frieren',
      currentRarity: 'RARE',
      suggestedRarity: 'LEGENDARY',
      reason: 'Anime mais bem avaliado e protagonista icônica',
    });

    expect(result.error).toBeUndefined();
    expect(result.evaluation?.searchedQueries).toEqual([
      '[AniList Personagem] Frieren (Sousou no Frieren)',
      '[AniList Obra] Sousou no Frieren',
    ]);
    const toolMsgs = llmRequests[1].messages.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0].content).toContain('MAIN em "Sousou no Frieren"');
    expect(toolMsgs[0].content).toContain('22,768');
    expect(toolMsgs[0].content).not.toContain('spoiler oculto');
    expect(toolMsgs[1].content).toContain('MADHOUSE');
    expect(toolMsgs[1].content).toContain('Nota 90/100');
  });

  it('deve fazer 1 retry direto quando a 2ª chamada ainda devolver content null (comportamento vLLM/Qwen)', async () => {
    const advisor = new RarityAdvisorService();
    let callCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/chat/completions')) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model: 'qwen3.8:27b-uncensored',
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_retry_1',
                        type: 'function',
                        function: { name: 'web_search', arguments: '{"query":"Rem Re:Zero"}' },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        if (callCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model: 'qwen3.8:27b-uncensored',
              choices: [
                {
                  finish_reason: 'stop',
                  message: { role: 'assistant', content: null, reasoning: 'Tentando outra busca...' },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'qwen3.8:27b-uncensored',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: '🤖 <b>Parecer da IA</b>:\n🎯 <b>Veredito:</b> PROCEDENTE\n💡 <b>Raridade Recomendada:</b> LEGENDARY',
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 500, text: async () => '' };
    });

    const result = await advisor.evaluateRaritySuggestionDetailed({
      id: 'sug_qwen_retry_1',
      type: 'RARITY',
      characterName: 'Rem',
      series: 'Re:Zero',
      currentRarity: 'RARE',
      suggestedRarity: 'LEGENDARY',
    });

    expect(callCount).toBe(3);
    expect(result.evaluation?.response).toContain('LEGENDARY');
    expect(result.error).toBeUndefined();
  });

  it('deve classificar corretamente TimeoutError como AI_ADVISOR_TIMEOUT (504)', async () => {
    const advisor = new RarityAdvisorService();

    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );

    const result = await advisor.evaluateRaritySuggestionDetailed({
      id: 'sug_timeout_1',
      type: 'RARITY',
      characterName: 'Goku',
      series: 'Dragon Ball',
      currentRarity: 'COMMON',
      suggestedRarity: 'LEGENDARY',
    });

    expect(result.evaluation).toBeNull();
    expect(result.error).toMatchObject({
      code: 'AI_ADVISOR_TIMEOUT',
      statusCode: 504,
    });
  });
});

describe('🌐 Rota HTTP GET /api/admin/suggestions/:id/ai-advisor — Tratamento de erros reais', () => {
  const originalFetch = globalThis.fetch;
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof DomainError) {
        return reply.status(error.statusCode).send({
          success: false,
          error: { code: error.code, message: error.message },
        });
      }
      return reply.status(error.statusCode || 500).send({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message },
      });
    });

    const mockRedis: any = {
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'admin:session:valid_admin_token') return 'admin';
        return null;
      }),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const mockPrisma: any = {
      characterSuggestion: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sug_http_1',
          type: 'RARITY',
          characterId: 'char_1',
          characterName: 'Frieren',
          series: 'Sousou no Frieren',
          currentRarity: 'RARE',
          suggestedRarity: 'LEGENDARY',
          reason: 'Protagonista muito famosa',
          userId: 'user_1',
          user: { name: 'Tester' },
          character: {
            id: 'char_1',
            name: 'Frieren',
            series: 'Sousou no Frieren',
            baseRarity: 'RARE',
            gender: 'FEMALE',
            description: '',
            tags: [],
            imageUrls: [],
            rank: 42,
            waifuRank: 15,
          },
        }),
      },
      haremEntry: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    app.decorate('redis', mockRedis);
    app.decorate('prisma', mockPrisma);
    await app.register(adminWebRoutes);
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
  });

  it('deve retornar HTTP 504 (success: false) em vez de 200 { success: true, data: null } quando a IA der timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/suggestions/sug_http_1/ai-advisor',
      headers: { authorization: 'Bearer valid_admin_token' },
    });

    expect(res.statusCode).toBe(504);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AI_ADVISOR_TIMEOUT');
    expect(body.error?.message).toContain('Tempo limite');
  });

  it('deve retornar HTTP 502 (success: false) quando a IA devolver resposta vazia mesmo após retry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'qwen3.8:27b-uncensored',
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null, reasoning: '...' } }],
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/suggestions/sug_http_1/ai-advisor',
      headers: { authorization: 'Bearer valid_admin_token' },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AI_ADVISOR_EMPTY_RESPONSE');
  });

  it('deve retornar HTTP 200 com data.response e data.model quando a IA responder normalmente', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'qwen3.8:27b-uncensored',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: '🤖 <b>Parecer da IA</b>:\n🎯 <b>Veredito:</b> PROCEDENTE\n💡 <b>Raridade Recomendada:</b> LEGENDARY',
            },
          },
        ],
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/suggestions/sug_http_1/ai-advisor',
      headers: { authorization: 'Bearer valid_admin_token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data?.response).toContain('PROCEDENTE');
    expect(body.data?.model).toBe('qwen3.8:27b-uncensored');
  });
});

describe('📋 Parecer estruturado via JSON Schema e consenso com usuário', () => {
  it('deve parsear JSON estruturado retornado pelo LLM e calcular agreesWithUser corretamente', () => {
    const advisor = new RarityAdvisorService();

    const jsonOutput = JSON.stringify({
      verdict: 'PROCEDENTE',
      recommendedRarity: 'RARE',
      balizadorMudae: '#25000 (Faixa Raro)',
      popCultureStatus: 'Protagonista de série cult com grande alcance',
      factsChecked: 'Personagem principal da animação',
      claimAnalysis: 'Motivo do usuário é totalmente condizente com a obra',
      justification: 'A raridade RARE reflete perfeitamente a estatura da personagem.',
    });

    // Caso 1: usuário sugeriu RARE e IA recomenda RARE -> agreesWithUser = true
    const parsedAgreed = advisor.parseEvaluationOutput(jsonOutput, 'RARE');
    expect(parsedAgreed.structured).not.toBeNull();
    expect(parsedAgreed.structured?.verdict).toBe('PROCEDENTE');
    expect(parsedAgreed.structured?.recommendedRarity).toBe('RARE');
    expect(parsedAgreed.structured?.agreesWithUser).toBe(true);
    expect(parsedAgreed.html).toContain('Parecer da IA');
    expect(parsedAgreed.html).toContain('Aprovado automaticamente');

    // Caso 2: usuário sugeriu LEGENDARY e IA recomenda RARE -> agreesWithUser = false
    const parsedDiverged = advisor.parseEvaluationOutput(jsonOutput, 'LEGENDARY');
    expect(parsedDiverged.structured?.agreesWithUser).toBe(false);
    expect(parsedDiverged.html).not.toContain('Aprovado automaticamente');
  });
});

describe('🛡️ Fallback automático de LLM contra erro 502 / Bad Gateway', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deve alternar para o provedor de fallback quando o provedor primário responder HTTP 502', async () => {
    const advisor = new RarityAdvisorService();
    // Força URLs distintas para teste de chaveamento de fallback
    (advisor as any).url = 'https://ai.moothz.com/vllm/v1';
    (advisor as any).fallbackUrl = 'https://lucia.ctg.ufsm.br/v1';

    const calledUrls: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      calledUrls.push(urlStr);

      if (urlStr.startsWith('https://ai.moothz.com')) {
        // Simula Cloudflare 502 Bad Gateway
        return {
          ok: false,
          status: 502,
          text: async () => '502 Bad Gateway (Cloudflare)',
        };
      }

      if (urlStr.startsWith('https://lucia.ctg.ufsm.br')) {
        // Fallback responde com sucesso
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'gemma4',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    verdict: 'PROCEDENTE',
                    recommendedRarity: 'EPIC',
                    justification: 'Personagem muito popular e influente.',
                  }),
                },
              },
            ],
          }),
        };
      }

      return { ok: false, status: 404, text: async () => 'not found' };
    });

    const result = await advisor.evaluateRaritySuggestionDetailed({
      id: 'sug_test_fallback_502',
      type: 'RARITY',
      characterName: 'Zoro',
      series: 'One Piece',
      currentRarity: 'RARE',
      suggestedRarity: 'EPIC',
    });

    expect(result.error).toBeUndefined();
    expect(result.evaluation).not.toBeNull();
    expect(result.evaluation?.usedFallback).toBe(true);
    expect(result.evaluation?.structured?.recommendedRarity).toBe('EPIC');
    expect(result.evaluation?.structured?.agreesWithUser).toBe(true);

    // Garante que tentou o primário primeiro e depois o fallback
    expect(calledUrls.some((u) => u.startsWith('https://ai.moothz.com'))).toBe(true);
    expect(calledUrls.some((u) => u.startsWith('https://lucia.ctg.ufsm.br'))).toBe(true);
  });
});

describe('🎬 Ferramentas de contexto para mídias não-anime (IMDb e IGDB)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('deve consultar e formatar informações de filmes/séries no IMDb via OMDb', async () => {
    const advisor = new RarityAdvisorService();
    (advisor as any).omdbApiKey = 'mock_omdb_key';

    globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('omdbapi.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Title: 'The Matrix',
            Year: '1999',
            Type: 'movie',
            Genre: 'Action, Sci-Fi',
            Director: 'Lana Wachowski, Lilly Wachowski',
            Actors: 'Keanu Reeves, Laurence Fishburne',
            imdbRating: '8.7',
            imdbVotes: '2,000,000',
            Plot: 'A computer programmer discovers a dystopian world.',
            Response: 'True',
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const res = await advisor.searchImdbInfo('The Matrix');
    expect(res).toContain('[IMDb] The Matrix (1999, movie)');
    expect(res).toContain('8.7/10');
    expect(res).toContain('Keanu Reeves');
  });

  it('deve consultar e formatar métricas de jogos eletrônicos no IGDB com token OAuth', async () => {
    const advisor = new RarityAdvisorService();
    (advisor as any).twitchClientId = 'mock_client_id';
    (advisor as any).twitchClientSecret = 'mock_client_secret';

    globalThis.fetch = vi.fn().mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('id.twitch.tv/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock_token_abc',
            expires_in: 3600,
          }),
        };
      }
      if (urlStr.includes('api.igdb.com/v4/games')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              name: 'The Witcher 3: Wild Hunt',
              first_release_date: 1431993600,
              total_rating: 92.8,
              total_rating_count: 5500,
              genres: [{ name: 'Role-playing (RPG)' }],
              platforms: [{ name: 'PC' }, { name: 'PlayStation 4' }],
              summary: 'Open world action RPG with Geralt of Rivia.',
            },
          ],
        };
      }
      return { ok: false, status: 404 };
    });

    const res = await advisor.searchGameInfo('The Witcher 3');
    expect(res).toContain('The Witcher 3: Wild Hunt (2015)');
    expect(res).toContain('93/100');
    expect(res).toContain('Role-playing (RPG)');
  });
});
