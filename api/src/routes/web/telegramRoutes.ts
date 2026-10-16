import { FastifyPluginAsync } from 'fastify';
import { TelegramNotificationService } from '../../services/TelegramNotificationService.js';
import { SuggestionService } from '../../services/SuggestionService.js';
import { CharacterService } from '../../services/CharacterService.js';

export const telegramRoutes: FastifyPluginAsync = async (fastify) => {
  const characterService = new CharacterService(fastify.prisma, fastify.redis);
  const suggestionService = new SuggestionService(fastify.prisma, fastify.redis, characterService);
  const telegramService = new TelegramNotificationService();

  fastify.post('/api/telegram/webhook', {
    schema: {
      description: 'Webhook do Telegram para processamento de botões inline de moderação',
      tags: ['Telegram'],
    },
    handler: async (request, reply) => {
      const update = request.body as any;

      if (update?.callback_query) {
        // Processa o clique no botão inline em segundo plano
        telegramService.handleCallback(update.callback_query, suggestionService).catch((err) => {
          request.log.error(err, 'Erro no processamento do callback_query do Telegram');
        });
      }

      return reply.send({ ok: true });
    },
  });
};
