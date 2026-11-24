import { config } from '../config.js';
import type { SuggestionNotifyData } from './TelegramNotificationService.js';
import type { Redis } from 'ioredis';
import { withBusinessSpan, setAttrs, setOutcome, recordError, activeSpan } from '../telemetry.js';

export type RarityAdvisorVerdict =
  | 'PROCEDENTE'
  | 'PARCIALMENTE_PROCEDENTE'
  | 'EXAGERO'
  | 'FALSO_MENTIRA';

export interface RarityAdvisorStructuredResult {
  verdict: RarityAdvisorVerdict;
  recommendedRarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  balizadorMudae?: string;
  popCultureStatus?: string;
  factsChecked?: string;
  claimAnalysis?: string;
  justification: string;
  agreesWithUser: boolean;
}

export interface RarityAdvisorEvaluation {
  response: string;
  structured?: RarityAdvisorStructuredResult | null;
  systemPrompt: string;
  userPrompt: string;
  searchedQueries: string[];
  evaluatedAt: string;
  mudaeRank?: number | null;
  model?: string;
  usedFallback?: boolean;
}

export type RarityAdvisorFailureCode =
  | 'AI_ADVISOR_NOT_CONFIGURED'
  | 'AI_ADVISOR_TIMEOUT'
  | 'AI_ADVISOR_EMPTY_RESPONSE'
  | 'AI_ADVISOR_HTTP_ERROR'
  | 'AI_ADVISOR_NETWORK_ERROR';

export interface RarityAdvisorError {
  code: RarityAdvisorFailureCode;
  message: string;
  statusCode: number;
}

export interface RarityAdvisorResult {
  evaluation: RarityAdvisorEvaluation | null;
  error?: RarityAdvisorError;
}

interface LlmProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

export class RarityAdvisorService {
  private url: string;
  private apiKey: string;
  private model: string;
  private fallbackUrl: string;
  private fallbackApiKey: string;
  private fallbackModel: string;
  private timeoutMs: number;
  private maxTokens: number;
  private omdbApiKey: string;
  private twitchClientId: string;
  private twitchClientSecret: string;
  private igdbTokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.url = config.HYPERION_LLM_URL;
    this.apiKey = config.HYPERION_LLM_KEY;
    this.model = config.HYPERION_LLM_MODEL;
    this.fallbackUrl = config.HYPERION_LLM_FALLBACK_URL;
    this.fallbackApiKey = config.HYPERION_LLM_FALLBACK_KEY;
    this.fallbackModel = config.HYPERION_LLM_FALLBACK_MODEL;
    this.timeoutMs = config.HYPERION_LLM_TIMEOUT_MS;
    this.maxTokens = config.HYPERION_LLM_MAX_TOKENS;
    this.omdbApiKey = config.OMDB_API_KEY;
    this.twitchClientId = config.TWITCH_CLIENT_ID;
    this.twitchClientSecret = config.TWITCH_CLIENT_SECRET;
  }

  /**
   * Realiza busca na web usando DuckDuckGo HTML e extrai resumos textuais
   */
  async searchWeb(query: string): Promise<string> {
    if (!query || typeof query !== 'string') {
      return 'Nenhum termo de pesquisa fornecido.';
    }

    const cleanQuery = query.trim();
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.status !== 200) {
        throw new Error(`DuckDuckGo retornou HTTP ${res.status}`);
      }

      const html = await res.text();
      const regex = /<a[^>]+class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let match: RegExpExecArray | null;
      const snippets: string[] = [];

      while ((match = regex.exec(html)) !== null && snippets.length < 4) {
        const cleaned = match[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .trim();
        if (cleaned) {
          snippets.push(cleaned);
        }
      }

      if (snippets.length > 0) {
        return snippets.map((s, idx) => `[${idx + 1}] ${s}`).join('\n\n');
      }
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Busca DuckDuckGo falhou (${err?.message || err}). Tentando Wikipedia...`);
    }

    // Fallback: Wikipedia OpenSearch API
    const wikiQuery = cleanQuery.replace(/\b(mudae|rank|kakera|waifuletes)\b/gi, '').replace(/\s+/g, ' ').trim() || cleanQuery;
    for (const lang of ['pt', 'en'] as const) {
      try {
        const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(wikiQuery)}&limit=3&namespace=0&format=json`;
        const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(5000) });
        if (wikiRes.ok) {
          const wikiData = (await wikiRes.json()) as any[];
          const titles = wikiData[1] || [];
          const descs = wikiData[2] || [];
          if (titles.length > 0) {
            return titles
              .map((t: string, i: number) => `[Wiki-${lang.toUpperCase()}] ${t}: ${descs[i] || 'Sem descrição'}`)
              .join('\n');
          }
        }
      } catch (_) {}
    }

    return 'Nenhum resultado relevante encontrado na pesquisa web.';
  }

  private cleanAniListDescription(raw?: string | null, maxLen = 420): string {
    if (!raw) return 'Sem descrição disponível.';
    const cleaned = raw
      .replace(/~!([\s\S]*?)!~/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/__|\*\*|~~/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return 'Sem descrição disponível.';
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen).trim()}...` : cleaned;
  }

  /**
   * Consulta informações de anime/mangá na API GraphQL do AniList.
   */
  async searchAnimeInfo(query: string): Promise<string> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return 'Nenhum nome de anime/obra fornecido.';
    }
    const cleanQuery = query.trim();
    const gql = `
      query ($search: String) {
        Page(perPage: 3) {
          media(search: $search, sort: POPULARITY_DESC) {
            title { romaji english }
            type
            format
            status
            seasonYear
            episodes
            chapters
            averageScore
            popularity
            favourites
            genres
            studios(isMain: true) { nodes { name } }
            description(asHtml: false)
          }
        }
      }
    `;

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables: { search: cleanQuery } }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`AniList retornou HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      const items: any[] = json?.data?.Page?.media || [];
      if (items.length === 0) {
        return `Nenhuma obra encontrada no AniList para "${cleanQuery}". Use web_search caso seja game, série ocidental, HQ ou outra mídia.`;
      }

      return items
        .map((m, idx) => {
          const title = m.title?.english && m.title.english !== m.title?.romaji
            ? `${m.title.romaji} (${m.title.english})`
            : m.title?.romaji || m.title?.english || 'Sem título';
          const studios = (m.studios?.nodes || []).map((s: any) => s.name).filter(Boolean).join(', ') || 'N/A';
          const genres = (m.genres || []).slice(0, 5).join(', ') || 'N/A';
          const lengthInfo = m.episodes ? `${m.episodes} eps` : m.chapters ? `${m.chapters} caps` : 'N/A';
          const score = m.averageScore != null ? `${m.averageScore}/100` : 'N/A';
          const pop = m.popularity != null ? m.popularity.toLocaleString('en-US') : 'N/A';
          const favs = m.favourites != null ? m.favourites.toLocaleString('en-US') : 'N/A';
          const desc = this.cleanAniListDescription(m.description, 300);
          return `[${idx + 1}] ${title} [${m.type || 'MEDIA'}/${m.format || 'N/A'}, ${m.seasonYear || 'N/A'}, ${lengthInfo}]\nEstúdio: ${studios} | Gêneros: ${genres}\nMétricas AniList: Nota ${score} | Popularidade: ${pop} usuários | Favoritos: ${favs}\nSinopse: ${desc}`;
        })
        .join('\n\n');
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta AniList (anime) falhou (${err?.message || err}).`);
      return `Falha ao consultar AniList para "${cleanQuery}". Tente web_search se necessário.`;
    }
  }

  /**
   * Consulta informações do personagem no AniList.
   */
  async searchCharacterInfo(name: string, series?: string): Promise<string> {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return 'Nenhum nome de personagem fornecido.';
    }
    const cleanName = name.trim();
    const cleanSeries = (series || '').trim().toLowerCase();
    const gql = `
      query ($search: String) {
        Page(perPage: 5) {
          characters(search: $search, sort: FAVOURITES_DESC) {
            name { full native alternative }
            favourites
            description(asHtml: false)
            media(perPage: 4, sort: POPULARITY_DESC) {
              edges {
                characterRole
                node {
                  title { romaji english }
                  type
                  seasonYear
                  popularity
                  favourites
                  averageScore
                }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables: { search: cleanName } }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`AniList retornou HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      let chars: any[] = json?.data?.Page?.characters || [];
      if (chars.length === 0) {
        return `Nenhum personagem encontrado no AniList para "${cleanName}". Use web_search caso seja de game, filme, série ocidental ou HQ.`;
      }

      if (cleanSeries) {
        const matchesSeries = (c: any) =>
          (c.media?.edges || []).some((e: any) => {
            const r = String(e.node?.title?.romaji || '').toLowerCase();
            const en = String(e.node?.title?.english || '').toLowerCase();
            return r.includes(cleanSeries) || en.includes(cleanSeries) || cleanSeries.includes(r);
          });
        const matched = chars.filter(matchesSeries);
        if (matched.length > 0) {
          chars = matched;
        }
      }

      return chars
        .slice(0, 3)
        .map((c, idx) => {
          const fullName = c.name?.full || cleanName;
          const alts = (c.name?.alternative || []).filter(Boolean).slice(0, 3).join(', ');
          const favs = c.favourites != null ? c.favourites.toLocaleString('en-US') : 'N/A';
          const roles = (c.media?.edges || [])
            .map((e: any) => {
              const t = e.node?.title?.romaji || e.node?.title?.english || 'Obra';
              const pop = e.node?.popularity != null ? `${e.node.popularity.toLocaleString('en-US')} users` : 'N/A';
              const score = e.node?.averageScore != null ? `nota ${e.node.averageScore}/100` : 'sem nota';
              return `${e.characterRole || 'N/A'} em "${t}" (${e.node?.type || 'MEDIA'}, ${e.node?.seasonYear || 'N/A'}, ${pop}, ${score})`;
            })
            .join('; ');
          const bio = this.cleanAniListDescription(c.description, 320);
          return `[${idx + 1}] ${fullName}${alts ? ` (Apelidos: ${alts})` : ''}\nFavoritos AniList: ${favs}\nPapéis em obras: ${roles || 'Não listado'}\nBio: ${bio}`;
        })
        .join('\n\n');
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta AniList (personagem) falhou (${err?.message || err}).`);
      return `Falha ao consultar AniList para o personagem "${cleanName}". Tente web_search se necessário.`;
    }
  }

  /**
   * Consulta dados de filme/série/obra audiovisual no IMDb via OMDb API.
   */
  async searchImdbInfo(title: string): Promise<string> {
    if (!title || typeof title !== 'string' || !title.trim()) {
      return 'Nenhum título de filme/série fornecido.';
    }
    const cleanTitle = title.trim();
    if (!this.omdbApiKey) {
      return this.searchWeb(`IMDb ${cleanTitle}`);
    }

    try {
      const res = await fetch(
        `http://www.omdbapi.com/?apikey=${encodeURIComponent(this.omdbApiKey)}&t=${encodeURIComponent(cleanTitle)}&plot=full`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) {
        throw new Error(`OMDb retornou HTTP ${res.status}`);
      }
      const data = (await res.json()) as any;
      if (data.Response === 'False' || !data.Title) {
        return `Nenhuma obra encontrada no IMDb para "${cleanTitle}". Use web_search para pesquisar na web.`;
      }

      const rating = data.imdbRating && data.imdbRating !== 'N/A' ? `${data.imdbRating}/10 (${data.imdbVotes || '0'} votos)` : 'N/A';
      const awards = data.Awards && data.Awards !== 'N/A' ? ` | Prêmios: ${data.Awards}` : '';
      const plot = data.Plot && data.Plot !== 'N/A' ? (data.Plot.length > 350 ? `${data.Plot.slice(0, 350)}...` : data.Plot) : 'Sem sinopse';

      return `[IMDb] ${data.Title} (${data.Year || 'N/A'}, ${data.Type || 'movie'})\nGênero: ${data.Genre || 'N/A'} | Diretor: ${data.Director || 'N/A'} | Elenco: ${data.Actors || 'N/A'}\nAvaliação IMDb: ${rating}${awards}\nSinopse: ${plot}`;
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta IMDb falhou (${err?.message || err}). Tentando web_search...`);
      return this.searchWeb(`IMDb ${cleanTitle}`);
    }
  }

  private async getIgdbAccessToken(): Promise<string | null> {
    if (!this.twitchClientId || !this.twitchClientSecret) return null;
    const now = Date.now();
    if (this.igdbTokenCache && this.igdbTokenCache.expiresAt > now + 60000) {
      return this.igdbTokenCache.token;
    }

    try {
      const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.twitchClientId,
          client_secret: this.twitchClientSecret,
          grant_type: 'client_credentials',
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`Twitch OAuth HTTP ${res.status}`);
      const data = (await res.json()) as any;
      if (data.access_token) {
        this.igdbTokenCache = {
          token: data.access_token,
          expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
        };
        return data.access_token;
      }
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Falha ao obter token IGDB/Twitch: ${err?.message || err}`);
    }
    return null;
  }

  /**
   * Consulta dados de jogos eletrônicos na API do IGDB.
   */
  async searchGameInfo(query: string): Promise<string> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return 'Nenhum nome de jogo fornecido.';
    }
    const cleanQuery = query.trim();
    const token = await this.getIgdbAccessToken();
    if (!token) {
      return this.searchWeb(`video game ${cleanQuery}`);
    }

    try {
      const escaped = cleanQuery.replace(/"/g, '\\"');
      const body = `search "${escaped}"; fields name,summary,total_rating,total_rating_count,first_release_date,genres.name,platforms.name; limit 2;`;
      const res = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
          'Client-ID': this.twitchClientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body,
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`IGDB HTTP ${res.status}`);
      const games = (await res.json()) as any[];
      if (!games || games.length === 0) {
        return `Nenhum jogo encontrado no IGDB para "${cleanQuery}". Use web_search para pesquisar na web.`;
      }

      return games
        .map((g, idx) => {
          const year = g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : 'N/A';
          const rating = g.total_rating != null ? `${Math.round(g.total_rating)}/100 (${g.total_rating_count || 0} avaliações)` : 'Sem avaliação agregada';
          const genres = (g.genres || []).map((x: any) => x.name).filter(Boolean).slice(0, 4).join(', ') || 'N/A';
          const platforms = (g.platforms || []).map((x: any) => x.name).filter(Boolean).slice(0, 4).join(', ') || 'N/A';
          const summary = g.summary ? (g.summary.length > 280 ? `${g.summary.slice(0, 280)}...` : g.summary) : 'Sem sinopse';
          return `[${idx + 1}] ${g.name} (${year})\nPlataformas: ${platforms} | Gêneros: ${genres}\nAvaliação IGDB: ${rating}\nSinopse: ${summary}`;
        })
        .join('\n\n');
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta IGDB falhou (${err?.message || err}). Tentando web_search...`);
      return this.searchWeb(`video game ${cleanQuery}`);
    }
  }

  /**
   * Avalia a sugestão de raridade usando o modelo LLM configurado
   */
  async evaluateRaritySuggestion(data: SuggestionNotifyData, redis?: Redis): Promise<RarityAdvisorEvaluation | null> {
    const result = await this.evaluateRaritySuggestionDetailed(data, redis);
    return result.evaluation;
  }

  /**
   * Mesmo fluxo de evaluateRaritySuggestion, retornando também erro estruturado quando o modelo falha ou expira.
   */
  async evaluateRaritySuggestionDetailed(data: SuggestionNotifyData, redis?: Redis): Promise<RarityAdvisorResult> {
    if (!this.url && !this.fallbackUrl) {
      return {
        evaluation: null,
        error: {
          code: 'AI_ADVISOR_NOT_CONFIGURED',
          message: 'Serviço de IA não configurado no servidor (HYPERION_LLM_URL / HYPERION_LLM_FALLBACK_URL).',
          statusCode: 503,
        },
      };
    }

    const usage = { input: 0, output: 0, calls: 0, toolCalls: 0, retried: false, finishReason: undefined as string | undefined };
    return withBusinessSpan(
      'ai_advisor',
      {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'vllm',
        'gen_ai.request.model': this.model || this.fallbackModel,
        'waifu.suggestion.type': data.type,
      },
      async (span) => {
        const result = await this.evaluateRaritySuggestionWithFallback(data, usage, redis);
        setAttrs(
          {
            'gen_ai.usage.input_tokens': usage.calls ? usage.input : undefined,
            'gen_ai.usage.output_tokens': usage.calls ? usage.output : undefined,
            'waifu.ai.llm_calls': usage.calls,
            'waifu.ai.tool_calls': usage.toolCalls,
            'waifu.ai.retry': usage.retried || undefined,
            'waifu.ai.finish_reason': usage.finishReason,
          },
          span
        );
        if (result.evaluation) {
          setOutcome('ok', undefined, span);
        } else if (!(span as any).attributes?.['app.outcome']) {
          const reason = result.error?.code === 'AI_ADVISOR_EMPTY_RESPONSE' ? 'empty_response' : 'unavailable';
          setOutcome('rejected', reason, span);
        }
        return result;
      }
    );
  }

  private trackUsage(
    usage: { input: number; output: number; calls: number; finishReason?: string },
    body: any
  ): string | undefined {
    usage.calls += 1;
    usage.input += Number(body?.usage?.prompt_tokens) || 0;
    usage.output += Number(body?.usage?.completion_tokens) || 0;
    const finishReason = body?.choices?.[0]?.finish_reason;
    if (finishReason) usage.finishReason = String(finishReason);
    const respModel = body?.model ? String(body.model) : undefined;
    if (respModel) setAttrs({ 'gen_ai.response.model': respModel });
    return respModel;
  }

  private isTimeoutError(err: any): boolean {
    if (!err) return false;
    const name = String(err.name || '');
    const msg = String(err.message || '').toLowerCase();
    return name === 'TimeoutError' || name === 'AbortError' || err.code === 23 || msg.includes('timeout') || msg.includes('aborted');
  }

  /**
   * Executa a avaliação tentando o provedor primário e, em caso de erro 502/5xx/timeout/rede, aciona o provedor de fallback.
   */
  private async evaluateRaritySuggestionWithFallback(
    data: SuggestionNotifyData,
    usage: { input: number; output: number; calls: number; toolCalls: number; retried: boolean; finishReason?: string },
    redis?: Redis
  ): Promise<RarityAdvisorResult> {
    const primaryProvider: LlmProviderConfig = {
      url: this.url,
      apiKey: this.apiKey,
      model: this.model,
    };

    const hasFallback = Boolean(this.fallbackUrl && this.fallbackUrl !== this.url);
    const fallbackProvider: LlmProviderConfig = {
      url: this.fallbackUrl,
      apiKey: this.fallbackApiKey,
      model: this.fallbackModel || this.model,
    };

    if (primaryProvider.url) {
      const primaryResult = await this.evaluateWithSingleProvider(primaryProvider, data, usage, false, redis);
      if (primaryResult.evaluation) {
        return primaryResult;
      }

      // Se falhou e existe fallback configurado, tenta o fallback
      if (hasFallback) {
        console.warn(
          `[RarityAdvisor] Provedor primário (${primaryProvider.url}) falhou [${primaryResult.error?.code}: ${primaryResult.error?.message}]. Tentando provedor de fallback (${fallbackProvider.url})...`
        );
        const fallbackResult = await this.evaluateWithSingleProvider(fallbackProvider, data, usage, true, redis);
        if (fallbackResult.evaluation) {
          fallbackResult.evaluation.usedFallback = true;
          return fallbackResult;
        }
        return fallbackResult;
      }

      return primaryResult;
    }

    if (hasFallback) {
      return this.evaluateWithSingleProvider(fallbackProvider, data, usage, true, redis);
    }

    return {
      evaluation: null,
      error: {
        code: 'AI_ADVISOR_NOT_CONFIGURED',
        message: 'Nenhum provedor de IA disponível.',
        statusCode: 503,
      },
    };
  }

  private async evaluateWithSingleProvider(
    provider: LlmProviderConfig,
    data: SuggestionNotifyData,
    usage: { input: number; output: number; calls: number; toolCalls: number; retried: boolean; finishReason?: string },
    isFallback: boolean,
    redis?: Redis
  ): Promise<RarityAdvisorResult> {
    const charName = data.character?.name || data.characterName || 'Desconhecido';
    const series = data.character?.series || data.series || 'Desconhecida';
    const currentRarity = data.currentRarity || data.character?.baseRarity || 'COMMON';
    const suggestedRarity = data.suggestedRarity || 'COMMON';
    const reason = (data.reason || '').trim();
    const suggesterName = data.userName || 'Usuário Anônimo';
    const isMarried = Boolean(data.isMarriedToSuggester);
    const mudaeRank = data.character?.rank;

    let rankInfo = 'Não informado no banco de dados local (use as ferramentas para pesquisar popularidade e relevância)';
    if (mudaeRank && mudaeRank > 0) {
      if (mudaeRank <= 4466) {
        rankInfo = `#${mudaeRank} (Top ~4.466 ➔ Faixa de referência Mudae: LENDÁRIO)`;
      } else if (mudaeRank <= 20701) {
        rankInfo = `#${mudaeRank} (4.467 a 20.701 ➔ Faixa de referência Mudae: ÉPICO)`;
      } else if (mudaeRank <= 62128) {
        rankInfo = `#${mudaeRank} (20.702 a 62.128 ➔ Faixa de referência Mudae: RARO)`;
      } else if (mudaeRank <= 76135) {
        rankInfo = `#${mudaeRank} (62.129 a 76.135 ➔ Faixa de referência Mudae: INCOMUM)`;
      } else {
        rankInfo = `#${mudaeRank} (Acima de 76.135 ➔ Faixa de referência Mudae: COMUM)`;
      }
    }

    const systemPrompt = `Você é um analista perito em cultura pop, cultura geek, animes, games, HQs, séries e moderação de raridade para o jogo de coleção Waifuletes.

TABELA DE RARIDADES DO WAIFULETES E BALIZADOR DE RANK MUDAE:
- LEGENDARY (🟡 Lendário): O topo absoluto da cultura pop/geek/anime/games mundial. Ícones históricos, protagonistas lendários ou figuras com fandom global massivo e reconhecimento cultural duradouro.
  • Balizador Mudae (referência ~2%): Rank 1 a 4466.
- EPIC (🟣 Épico): Protagonistas muito famosos, personagens marcantes e ícones consagrados de obras de grande destaque, ou coadjuvantes extremamente populares de franquias gigantes.
  • Balizador Mudae (referência ~10%): Rank 4467 a 20701.
- RARE (🔵 Raro): Protagonistas de obras médias/de nicho popular, ou personagens principais de suporte em obras muito populares.
  • Balizador Mudae (referência ~20%): Rank 20702 a 62128.
- UNCOMMON (🟢 Incomum): Personagens secundários/coadjuvantes conhecidos em suas obras ou protagonistas de obras pouco conhecidas.
  • Balizador Mudae (referência ~28%): Rank 62129 a 76135.
- COMMON (⚪ Comum): Figurantes, personagens de fundo, NPCs menores ou personagens de obras muito obscuras.
  • Balizador Mudae (referência ~40%): Rank acima de 76135.

CRITÉRIOS DE AVALIAÇÃO (PONDERE OS 3 PILARES EM CONJUNTO):
1. BALIZADOR DO RANK MUDAE (Popularidade Geral no Gacha):
   - O Rank do Mudae serve como um balizador inicial de popularidade geral, mas NÃO é uma regra rígida nem absoluta.
   - Faixas de referência: 1 a 4466 (LEGENDARY), 4467 a 20701 (EPIC), 20702 a 62128 (RARE), 62129 a 76135 (UNCOMMON), acima de 76135 (COMMON).
2. STATUS DO PERSONAGEM NA CULTURA POP E GEEK:
   - Avalie o peso cultural real do personagem: é um ícone reconhecível até fora do seu fandom? Tem papel principal (MAIN), secundário relevante (SUPPORTING) ou figurante (BACKGROUND)?
3. RELEVÂNCIA E IMPACTO DA OBRA (ANIME / GAME / SÉRIE / HQ):
   - Avalie a estatura da obra de origem: fenômeno global / clássico histórico, obra popular, nicho médio ou título obscuro.
   - Use as ferramentas disponíveis (search_character_info, search_anime_info, search_imdb_info, search_game_info e web_search) para confirmar métricas e fatos.
4. CHECAGEM FACTUAL DE ALEGAÇÕES (FATO VS EXAGERO/MENTIRA):
   - Verifique se o motivo alegado pelo usuário confere ou se há distorção.
${isMarried ? '5. ⚠️ ATENÇÃO CRÍTICA: O usuário que fez o pedido é CASADO com esse personagem no jogo! Verifique com rigor redobrado se há viés de interesse próprio para valorizar sua própria waifu.' : ''}

FORMATO OBRIGATÓRIO DA RESPOSTA:
Sua resposta final DEVE ser estritamente um objeto JSON válido (sem markdown em volta e sem blocos adicionais), estruturado exatamente com estas chaves:
{
  "verdict": "PROCEDENTE" | "PARCIALMENTE_PROCEDENTE" | "EXAGERO" | "FALSO_MENTIRA",
  "recommendedRarity": "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY",
  "balizadorMudae": "string com resumo do balizador",
  "popCultureStatus": "relevância da obra, papel do personagem e status pop/geek",
  "factsChecked": "1 a 2 frases factuais sobre quem realmente é o personagem",
  "claimAnalysis": "análise se o motivo do usuário confere ou se está distorcido",
  "justification": "justificativa técnica equilibrando balizador e relevância"
}`;

    const userPrompt = `Personagem: ${charName}
Série/Origem: ${series}
Raridade Atual: ${currentRarity}
Raridade Sugerida pelo Usuário: ${suggestedRarity}
Rank Mudae (Balizador): ${rankInfo}
Motivo alegado pelo usuário: "${reason || '(Nenhum motivo fornecido)'}"
Sugerido por: ${suggesterName}
Usuário é casado com o personagem?: ${isMarried ? 'SIM (Possível conflito de interesse)' : 'NÃO'}`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_character_info',
          description:
            'Consulta no AniList dados do personagem de anime/mangá: favoritos, obras em que aparece, papel real (MAIN, SUPPORTING ou BACKGROUND) e biografia.',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Nome do personagem (ex: "Frieren", "Rem", "Gojo Satoru")',
              },
              series: {
                type: 'string',
                description: 'Nome opcional do anime/mangá para desambiguação',
              },
            },
            required: ['name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_anime_info',
          description:
            'Consulta no AniList métricas de um anime ou mangá: nota média, popularidade, favoritos, estúdio e ano.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Nome do anime ou mangá (ex: "Sousou no Frieren", "Naruto")',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_imdb_info',
          description:
            'Consulta no IMDb dados de filmes, séries de TV, animações ocidentais e atores (ano, nota IMDb, votos, sinopse, diretor, elenco e prêmios).',
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Título do filme ou série no IMDb (ex: "Arcane", "Breaking Bad", "The Matrix")',
              },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_game_info',
          description:
            'Consulta no IGDB métricas de relevância de jogos eletrônicos (avaliação agregada, nota, ano de lançamento, plataformas e resumo).',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Nome do jogo ou franquia no IGDB (ex: "The Witcher 3", "Final Fantasy VII", "Elden Ring")',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description:
            'Pesquisa na web e Wikipedia por biografias, relevância na cultura pop e notícias quando outras ferramentas não tiverem o resultado.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Termo de pesquisa na web',
              },
            },
            required: ['query'],
          },
        },
      },
    ];

    const searchedQueries: string[] = [];

    const buildAndCacheEvaluation = async (
      rawResponse: string,
      resolvedModel?: string
    ): Promise<RarityAdvisorResult> => {
      const { structured, html } = this.parseEvaluationOutput(rawResponse, data.suggestedRarity);
      const evaluation: RarityAdvisorEvaluation = {
        response: html,
        structured,
        systemPrompt,
        userPrompt,
        searchedQueries,
        evaluatedAt: new Date().toISOString(),
        mudaeRank: mudaeRank || null,
        model: resolvedModel || provider.model,
        usedFallback: isFallback,
      };

      if (redis && data.id) {
        try {
          await redis.set(`suggestion:ai:${data.id}`, JSON.stringify(evaluation), 'EX', 30 * 86400);
        } catch (_) {}
      }

      return { evaluation };
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`;
      }

      const callLlm = async (payload: Record<string, unknown>) => {
        return fetch(`${provider.url}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      };

      // Chamada 1: permite tool calls
      const res1 = await callLlm({
        model: provider.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: this.maxTokens,
        temperature: 0.5,
      });

      if (!res1.ok) {
        const errText = await res1.text().catch(() => '');
        console.warn(`[RarityAdvisor] LLM (${provider.url}) retornou HTTP ${res1.status} na chamada 1: ${errText.slice(0, 300)}`);
        recordError(activeSpan(), new Error(`HTTP ${res1.status}`), `http_${res1.status}`);
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_HTTP_ERROR',
            message: `O serviço de IA retornou erro HTTP ${res1.status}.`,
            statusCode: res1.status === 504 ? 504 : 502,
          },
        };
      }

      const data1 = (await res1.json()) as any;
      let resolvedModel = this.trackUsage(usage, data1);
      const choice1 = data1.choices?.[0];
      if (!choice1?.message) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_EMPTY_RESPONSE',
            message: 'O modelo de IA retornou uma resposta vazia.',
            statusCode: 502,
          },
        };
      }

      let finalChoice = choice1;

      // Executa ferramentas se o modelo chamou
      if (choice1.message.tool_calls && choice1.message.tool_calls.length > 0) {
        usage.toolCalls += choice1.message.tool_calls.length;
        messages.push({
          role: 'assistant',
          content: choice1.message.content || null,
          tool_calls: choice1.message.tool_calls,
        });

        const toolCalls = choice1.message.tool_calls.slice(0, 4);
        const searchResults = await Promise.all(
          toolCalls.map(async (tc: any) => {
            const fnName = String(tc.function?.name || 'web_search');
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(tc.function?.arguments || '{}') || {};
            } catch (_) {}

            if (fnName === 'search_character_info') {
              const targetName = String(args.name || args.query || charName);
              const targetSeries = args.series ? String(args.series) : series !== 'Desconhecida' ? series : undefined;
              searchedQueries.push(`[AniList Personagem] ${targetName}${targetSeries ? ` (${targetSeries})` : ''}`);
              const content = await this.searchCharacterInfo(targetName, targetSeries);
              return { tc, content };
            }

            if (fnName === 'search_anime_info') {
              const targetQuery = String(args.query || args.name || series);
              searchedQueries.push(`[AniList Obra] ${targetQuery}`);
              const content = await this.searchAnimeInfo(targetQuery);
              return { tc, content };
            }

            if (fnName === 'search_imdb_info') {
              const targetTitle = String(args.title || args.query || series !== 'Desconhecida' ? series : charName);
              searchedQueries.push(`[IMDb] ${targetTitle}`);
              const content = await this.searchImdbInfo(targetTitle);
              return { tc, content };
            }

            if (fnName === 'search_game_info') {
              const targetQuery = String(args.query || args.name || series !== 'Desconhecida' ? series : charName);
              searchedQueries.push(`[IGDB Game] ${targetQuery}`);
              const content = await this.searchGameInfo(targetQuery);
              return { tc, content };
            }

            const query = String(args.query || `${charName} ${series}`);
            searchedQueries.push(`[Web] ${query}`);
            const content = await this.searchWeb(query);
            return { tc, content };
          })
        );

        for (const { tc, content } of searchResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function?.name || 'web_search',
            content,
          });
        }

        messages.push({
          role: 'user',
          content:
            'Com base nas informações levantadas e nas diretrizes, emita agora o parecer final estritamente no formato JSON estruturado solicitado, sem chamar novas ferramentas.',
        });

        const res2 = await callLlm({
          model: provider.model,
          messages,
          tools,
          tool_choice: 'none',
          response_format: { type: 'json_object' },
          max_tokens: this.maxTokens,
          temperature: 0.4,
        });

        if (!res2.ok) {
          const errText = await res2.text().catch(() => '');
          console.warn(`[RarityAdvisor] LLM (${provider.url}) retornou HTTP ${res2.status} na chamada 2: ${errText.slice(0, 300)}`);
          recordError(activeSpan(), new Error(`HTTP ${res2.status}`), `http_${res2.status}`);
          return {
            evaluation: null,
            error: {
              code: 'AI_ADVISOR_HTTP_ERROR',
              message: `O serviço de IA retornou erro HTTP ${res2.status} ao finalizar o parecer.`,
              statusCode: res2.status === 504 ? 504 : 502,
            },
          };
        }

        const data2 = (await res2.json()) as any;
        resolvedModel = this.trackUsage(usage, data2) || resolvedModel;
        finalChoice = data2.choices?.[0];
      }

      const rawContent = finalChoice?.message?.content?.trim() || null;
      let cleaned = rawContent ? this.cleanModelResponse(rawContent) : null;

      // Retry defensivo caso retorno esteja vazio
      if (!cleaned) {
        console.warn(
          `[RarityAdvisor] Resposta vazia (${resolvedModel || provider.model}). Tentando retry conciso...`
        );
        usage.retried = true;
        const retryMessages = [
          ...messages,
          {
            role: 'user',
            content:
              'Responda agora mesmo em formato JSON estruturado com as chaves verdict, recommendedRarity e justification.',
          },
        ];
        const resRetry = await callLlm({
          model: provider.model,
          messages: retryMessages,
          tools,
          tool_choice: 'none',
          response_format: { type: 'json_object' },
          max_tokens: this.maxTokens,
          temperature: 0.3,
        });

        if (resRetry.ok) {
          const dataRetry = (await resRetry.json()) as any;
          resolvedModel = this.trackUsage(usage, dataRetry) || resolvedModel;
          const retryRaw = dataRetry.choices?.[0]?.message?.content?.trim() || null;
          cleaned = retryRaw ? this.cleanModelResponse(retryRaw) : null;
        }
      }

      if (!cleaned) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_EMPTY_RESPONSE',
            message: 'O modelo de IA retornou uma resposta vazia.',
            statusCode: 502,
          },
        };
      }

      return buildAndCacheEvaluation(cleaned, resolvedModel);
    } catch (err: any) {
      const isTimeout = this.isTimeoutError(err);
      console.error(`[RarityAdvisor] Erro na análise por LLM (${provider.url}):`, err?.message || err);
      recordError(activeSpan(), err, isTimeout ? 'timeout' : undefined);
      if (isTimeout) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_TIMEOUT',
            message: `Tempo limite esgotado (${Math.round(this.timeoutMs / 1000)}s) ao aguardar resposta do modelo de IA.`,
            statusCode: 504,
          },
        };
      }
      return {
        evaluation: null,
        error: {
          code: 'AI_ADVISOR_NETWORK_ERROR',
          message: `Falha de comunicação com o serviço de IA (${provider.url}).`,
          statusCode: 502,
        },
      };
    }
  }

  /**
   * Converte a resposta do modelo (JSON estruturado ou texto legado) em dados estruturados e HTML padronizado.
   */
  public parseEvaluationOutput(
    raw: string,
    suggestedRarity?: string | null
  ): { structured: RarityAdvisorStructuredResult | null; html: string } {
    const cleaned = this.cleanModelResponse(raw);
    let parsedJson: any = null;

    // Procura JSON isolado ou dentro de bloco ```json
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedJson = JSON.parse(jsonMatch[0]);
      } catch (_) {}
    }

    const normalizeRarity = (val?: any): 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' => {
      const str = String(val || '').toUpperCase().trim();
      if (str.includes('LEGEND')) return 'LEGENDARY';
      if (str.includes('EPIC')) return 'EPIC';
      if (str.includes('RARE') || str.includes('RARO')) return 'RARE';
      if (str.includes('UNCOMMON') || str.includes('INCOMUM')) return 'UNCOMMON';
      return 'COMMON';
    };

    const normalizeVerdict = (val?: any): RarityAdvisorVerdict => {
      const str = String(val || '').toUpperCase().trim();
      if (str.includes('FALSO') || str.includes('MENTIRA')) return 'FALSO_MENTIRA';
      if (str.includes('EXAGERO')) return 'EXAGERO';
      if (str.includes('PARCIAL')) return 'PARCIALMENTE_PROCEDENTE';
      return 'PROCEDENTE';
    };

    if (parsedJson && (parsedJson.recommendedRarity || parsedJson.verdict || parsedJson.justification)) {
      const recommendedRarity = normalizeRarity(parsedJson.recommendedRarity || parsedJson.rarity);
      const verdict = normalizeVerdict(parsedJson.verdict);
      const balizadorMudae = String(parsedJson.balizadorMudae || parsedJson.mudaeRank || '').trim();
      const popCultureStatus = String(parsedJson.popCultureStatus || parsedJson.culturaPop || '').trim();
      const factsChecked = String(parsedJson.factsChecked || parsedJson.fatosApurados || '').trim();
      const claimAnalysis = String(parsedJson.claimAnalysis || parsedJson.checagemAlegacao || '').trim();
      const justification = String(parsedJson.justification || parsedJson.justificativa || '').trim();

      const agreesWithUser = Boolean(
        suggestedRarity &&
        recommendedRarity === normalizeRarity(suggestedRarity)
      );

      const structured: RarityAdvisorStructuredResult = {
        verdict,
        recommendedRarity,
        balizadorMudae: balizadorMudae || undefined,
        popCultureStatus: popCultureStatus || undefined,
        factsChecked: factsChecked || undefined,
        claimAnalysis: claimAnalysis || undefined,
        justification: justification || 'Avaliação técnica baseada em métricas e popularidade.',
        agreesWithUser,
      };

      const verdictLabels: Record<RarityAdvisorVerdict, string> = {
        PROCEDENTE: 'PROCEDENTE',
        PARCIALMENTE_PROCEDENTE: 'PARCIALMENTE PROCEDENTE',
        EXAGERO: 'EXAGERO',
        FALSO_MENTIRA: 'FALSO/MENTIRA',
      };

      const html = `🤖 <b>Parecer da IA</b>:

🎯 <b>Veredito:</b> ${verdictLabels[verdict]}
🏆 <b>Balizador Mudae:</b> ${balizadorMudae || 'Não informado'}
${popCultureStatus ? `🌟 <b>Cultura Pop/Geek & Obra:</b> ${popCultureStatus}\n` : ''}${factsChecked ? `🔍 <b>Fatos Apurados:</b> ${factsChecked}\n` : ''}${claimAnalysis ? `⚖️ <b>Checagem da Alegação:</b> ${claimAnalysis}\n` : ''}💡 <b>Raridade Recomendada:</b> ${recommendedRarity} (${justification})${agreesWithUser ? '\n\n✨ <b>Consenso com o usuário:</b> Aprovado automaticamente!' : ''}`;

      return { structured, html };
    }

    // Parsing defensivo para formatos textuais legados
    const verdictMatch = cleaned.match(/<b>Veredito:?<\/b>\s*([^<\n]+)/i) || cleaned.match(/Veredito:?\s*([^\n]+)/i);
    const rarityMatch = cleaned.match(/<b>Raridade Recomendada:?<\/b>\s*([A-Za-z]+)/i) || cleaned.match(/Raridade Recomendada:?\s*([A-Za-z]+)/i);
    const mudaeMatch = cleaned.match(/<b>Balizador Mudae:?<\/b>\s*([^<\n]+)/i) || cleaned.match(/Balizador Mudae:?\s*([^\n]+)/i);
    const factsMatch = cleaned.match(/<b>Fatos Apurados:?<\/b>\s*([^<\n]+)/i);
    const claimMatch = cleaned.match(/<b>Checagem da Alega[çc][ãa]o:?<\/b>\s*([^<\n]+)/i);

    const recommendedRarity = normalizeRarity(rarityMatch?.[1]);
    const verdict = normalizeVerdict(verdictMatch?.[1]);
    const agreesWithUser = Boolean(
      suggestedRarity &&
      recommendedRarity === normalizeRarity(suggestedRarity)
    );

    const structured: RarityAdvisorStructuredResult = {
      verdict,
      recommendedRarity,
      balizadorMudae: mudaeMatch?.[1]?.trim() || undefined,
      factsChecked: factsMatch?.[1]?.trim() || undefined,
      claimAnalysis: claimMatch?.[1]?.trim() || undefined,
      justification: 'Avaliação processada a partir do parecer textual da IA.',
      agreesWithUser,
    };

    return { structured, html: cleaned };
  }

  /**
   * Remove tokens residuais de thought/think e canais internos do modelo
   */
  private cleanModelResponse(raw: string): string {
    return raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/<\|?channel\|?>thought[\s\S]*?<\|?channel\|?>/gi, '')
      .replace(/<\|?channel\|?>thought/gi, '')
      .replace(/<\|?channel\|?>/gi, '')
      .replace(/<\|.*?\|>/gi, '')
      .replace(/<\|.*?>/gi, '')
      .replace(/<.*?\|>/gi, '')
      .trim();
  }
}
