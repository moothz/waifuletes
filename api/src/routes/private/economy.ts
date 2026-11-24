import { FastifyPluginAsync } from 'fastify';
import { verifyApiKey } from '../../plugins/auth.js';
import { EconomySummaryService, PLAYERS_MAX_WINDOW_MS, windowError } from '../../services/EconomySummaryService.js';
import { withBusinessSpan, setAttrs } from '../../telemetry.js';
import { getEconomyParams } from '../../utils/economyParams.js';

/** Maior epoch em ms representável por Date. */
const MAX_EPOCH_MS = 8_640_000_000_000_000;

export const privateEconomyRoutes: FastifyPluginAsync = async (fastify) => {
  const economyService = new EconomySummaryService(fastify.prisma);

  // onRequest (antes da validação da querystring): sem a chave, a resposta é sempre 401, nunca 400.
  fastify.addHook('onRequest', verifyApiKey);

  fastify.get('/internal/economy/summary', {
    schema: {
      description:
        'Resumo agregado da economia de Zinthos para o painel da Ravena (fluxos por hora e motivo, retrato dos saldos e quintos, ciclo da alma gêmea por hora). Sem dados por jogador. Um pedido por vez: enquanto um roda, outro recebe 429 ECONOMY_BUSY.',
      tags: ['Kakera & Economia (Privado)'],
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'integer', minimum: 0, maximum: MAX_EPOCH_MS },
          to: { type: 'integer', minimum: 1, maximum: MAX_EPOCH_MS },
          // 1 pede receivedByQuintile (só para janelas de até 8 dias); a carga da Ravena pede uma vez por dia.
          received: { type: 'integer', enum: [0, 1], default: 0 },
          // 0 pula o retrato dos saldos (balances: null) — usado nos pedaços históricos da carga inicial.
          balances: { type: 'integer', enum: [0, 1], default: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { from, to, received, balances } = request.query as {
        from: number;
        to: number;
        received?: number;
        balances?: number;
      };
      const now = Date.now();

      const result = await withBusinessSpan(
        'economy summary',
        {
          'waifu.economy.window_ms': to - from,
          'waifu.economy.full_history': from === 0,
          'waifu.economy.received': received === 1,
          'waifu.economy.balances': balances !== 0,
        },
        async () => {
          const invalid = windowError(from, to, now);
          if (invalid) return { success: false as const, error: { code: 'INVALID_WINDOW', message: invalid } };
          const summary = await economyService.getSummary(from, to, now, { received: received === 1, balances: balances !== 0 });
          setAttrs({
            'waifu.economy.flow_rows': summary.ledger.flows.length,
            'waifu.economy.soulmate_divorces': summary.soulmateCycle.reduce((s, h) => s + h.divorces, 0),
            'waifu.economy.holders': summary.balances?.holders,
          });
          return summary;
        }
      );

      if ('success' in result && result.success === false) {
        return reply.status(400).send(result);
      }
      return reply.send(result);
    },
  });

  fastify.get('/internal/economy/players', {
    schema: {
      description:
        'Recorte por jogador da economia de Zinthos para o painel da Ravena: saldo atual, saldo no fim da janela e fluxos por motivo em [from, to). Janela de até 8 dias. Um pedido por vez: enquanto um roda, outro recebe 429 ECONOMY_BUSY.',
      tags: ['Kakera & Economia (Privado)'],
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'integer', minimum: 0, maximum: MAX_EPOCH_MS },
          to: { type: 'integer', minimum: 1, maximum: MAX_EPOCH_MS },
        },
      },
    },
    handler: async (request, reply) => {
      const { from, to } = request.query as { from: number; to: number };
      const now = Date.now();

      const result = await withBusinessSpan(
        'economy players',
        { 'waifu.economy.window_ms': to - from },
        async () => {
          const invalid = windowError(from, to, now, PLAYERS_MAX_WINDOW_MS);
          if (invalid) return { success: false as const, error: { code: 'INVALID_WINDOW', message: invalid } };
          const players = await economyService.getPlayers(from, to, now);
          setAttrs({
            'waifu.economy.players': players.players.length,
            'waifu.economy.flow_rows': players.flows.length,
          });
          return players;
        }
      );

      if ('success' in result && result.success === false) {
        return reply.status(400).send(result);
      }
      return reply.send(result);
    },
  });

  fastify.get('/internal/economy/params', {
    schema: {
      description:
        'Parâmetros de balanceamento da economia de Zinthos (recompensas, custos, taxas, multiplicadores, limites e cooldowns) em mapa plano `<grupo>.<NOME>[.<chave>]`, para o painel da Ravena detectar mudanças de balanceamento. Só leitura; sem dados de jogador.',
      tags: ['Kakera & Economia (Privado)'],
      querystring: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: async (_request, reply) => {
      const result = await withBusinessSpan('economy params', {}, async () => {
        const params = getEconomyParams();
        setAttrs({ 'waifu.economy.params': Object.keys(params.params).length });
        return params;
      });
      return reply.send(result);
    },
  });
};
