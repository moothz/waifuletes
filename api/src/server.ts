import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';

import { config } from './config.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import { isTrustedRequest } from './plugins/auth.js';
import { DomainError } from './errors/DomainError.js';
import { activeSpan, recordError, tagRequestIds } from './telemetry.js';
import { CooldownService } from './services/CooldownService.js';
import { CharacterService } from './services/CharacterService.js';
import { RollService } from './services/RollService.js';
import { startHostingFeeScheduler, SchedulerHandle } from './jobs/hostingFeeScheduler.js';

declare module 'fastify' {
  interface FastifyInstance {
    rollService?: RollService;
  }
}

// Rotas públicas
import { publicCharacterRoutes } from './routes/public/characters.js';
import { publicLeaderboardRoutes } from './routes/public/leaderboard.js';
import { publicCalculatorRoutes } from './routes/public/calculator.js';

// Rotas web públicas e administrativas
import { userWebRoutes } from './routes/web/userWebRoutes.js';
import { adminWebRoutes } from './routes/web/adminWebRoutes.js';
import { telegramRoutes } from './routes/web/telegramRoutes.js';

// Rotas privadas
import { privateUserRoutes } from './routes/private/user.js';
import { privateRollRoutes } from './routes/private/roll.js';
import { privateMarryRoutes } from './routes/private/marry.js';
import { privateDivorceRoutes } from './routes/private/divorce.js';
import { privateHaremRoutes } from './routes/private/harem.js';
import { privateWishlistRoutes } from './routes/private/wishlist.js';
import { privateKakeraRoutes } from './routes/private/kakera.js';
import { privateAdminRoutes } from './routes/private/admin.js';
import { privateMarketRoutes } from './routes/private/market.js';
import { privateCovetRoutes } from './routes/private/covet.js';
import { privateCollectionRoutes } from './routes/private/collection.js';
import { privateEconomyRoutes } from './routes/private/economy.js';

// Rotas do Acervo Externo / Storage Remoto (Hub)
import { externalCatalogRoutes } from './routes/external/externalCatalogRoutes.js';

const fastify = Fastify({
  trustProxy: true,
  bodyLimit: 75 * 1024 * 1024, // 75MB para permitir envio de fotos de personagens e míticos
  maxParamLength: 500, // Permite slugs e identificadores de personagens extensos (ex.: títulos de light novel)
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
  },
});

async function buildServer() {
  // CORS configurável
  const allowedOrigins = config.CORS_ORIGINS === '*'
    ? '*'
    : config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

  await fastify.register(cors, {
    origin: allowedOrigins,
  });

  // Proteção HTTP com Helmet
  await fastify.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  });

  // Rate Limiting (600 req/min geral para anônimos; bot e arquivos estáticos/mídia são isentos)
  await fastify.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => {
      if (isTrustedRequest(req)) return true;
      const cleanUrl = req.url.split('?')[0];
      return (
        cleanUrl.startsWith('/media/') ||
        cleanUrl.startsWith('/css/') ||
        cleanUrl.startsWith('/js/') ||
        cleanUrl.startsWith('/vendor/') ||
        cleanUrl.startsWith('/health') ||
        cleanUrl === '/favicon.ico'
      );
    },
  });

  // Multipart/form-data
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
    },
  });

  // Swagger Documentation (habilitado apenas se ENABLE_SWAGGER for true ou fora de produção)
  if (config.ENABLE_SWAGGER) {
    await fastify.register(swagger, {
      openapi: {
        info: {
          title: 'Waifuletes API',
          description: 'API REST do jogo clone de Mudae para integração com bots (WhatsApp, Telegram, Discord).',
          version: '1.0.0',
        },
        servers: [
          { url: config.INTERNAL_BASE_URL, description: 'Servidor Local / Interno' },
          { url: config.PUBLIC_BASE_URL, description: 'Servidor Público (via Cloudflared)' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              description: 'API Key Bearer token configurada em .env',
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });
  }

  // Servir arquivos de mídia estáticos em /media
  await fastify.register(fastifyStatic, {
    root: path.resolve(config.MEDIA_DIR),
    prefix: '/media/',
    decorateReply: false,
  });

  // Servir arquivos de frontend estáticos em /
  const publicDir = fs.existsSync(path.resolve(process.cwd(), 'public'))
    ? path.resolve(process.cwd(), 'public')
    : fs.existsSync(path.resolve(process.cwd(), 'api/public'))
      ? path.resolve(process.cwd(), 'api/public')
      : path.resolve(process.cwd(), '../api/public');

  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    decorateReply: true,
  });

  // Rotas diretas para páginas HTML (sempre no-cache para forçar atualização imediata de scripts e estilos)
  const sendHtmlNoCache = (reply: any, file: string) => {
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    return reply.sendFile(file);
  };

  fastify.get('/', async (req, reply) => {
    return sendHtmlNoCache(reply, 'index.html');
  });

  fastify.get('/admin', async (req, reply) => {
    return sendHtmlNoCache(reply, 'admin.html');
  });

  fastify.get('/catalogo', async (req, reply) => {
    return sendHtmlNoCache(reply, 'catalogo.html');
  });

  fastify.get('/waifinder', async (req, reply) => {
    return sendHtmlNoCache(reply, 'catalogo.html');
  });

  fastify.get('/character/:id', async (req, reply) => {
    return sendHtmlNoCache(reply, 'character.html');
  });

  fastify.get('/char/:id', async (req, reply) => {
    return sendHtmlNoCache(reply, 'character.html');
  });

  fastify.get('/c/:id', async (req, reply) => {
    return sendHtmlNoCache(reply, 'character.html');
  });

  fastify.get('/user', async (req, reply) => {
    return sendHtmlNoCache(reply, 'user.html');
  });

  fastify.get('/calculadora-chances', async (req, reply) => {
    return sendHtmlNoCache(reply, 'calculadora-chances.html');
  });

  // Esvazia a fila de spans no encerramento (teto de 3 s; no-op sem telemetria).
  fastify.addHook('onClose', async () => {
    await (globalThis as any).__OTEL_SHUTDOWN?.();
  });

  // Hash do usuário/grupo (userId/groupId de params, corpo ou query) nos spans da requisição.
  // preValidation: o corpo já foi lido e este hook não vira span (o @fastify/otel só instrumenta preHandler).
  fastify.addHook('preValidation', (request, _reply, done) => {
    tagRequestIds(request);
    done();
  });

  // Plugins de infraestrutura
  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);

  // Instância compartilhada de RollService (evita duplicar ~200k itens em RAM entre rotas privadas e web)
  const sharedRollService = new RollService(
    fastify.prisma,
    new CooldownService(fastify.redis),
    new CharacterService(fastify.prisma, fastify.redis)
  );
  if (!fastify.hasDecorator('rollService')) {
    fastify.decorate('rollService', sharedRollService);
  } else {
    fastify.rollService = sharedRollService;
  }

  // Tratamento global de erros
  fastify.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 413 || (error as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'A imagem enviada é muito grande! Compacte ela antes',
        },
      });
    }

    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
      });
    }

    request.log.error(error);
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) recordError(activeSpan(), error);
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code || 'INTERNAL_SERVER_ERROR',
        message: statusCode >= 500 ? 'Ocorreu um erro interno no servidor.' : error.message,
      },
    });
  });

  // Health checks
  fastify.get('/health', {
    schema: {
      description: 'Verificação básica de integridade da API',
      tags: ['Sistema (Público)'],
    },
    handler: async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }),
  });

  fastify.get('/health/live', {
    schema: {
      description: 'Liveness probe (K8s/Docker)',
      tags: ['Sistema (Público)'],
    },
    handler: async () => ({
      status: 'live',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  });

  fastify.get('/health/ready', {
    schema: {
      description: 'Readiness probe verificando conectividade com PostgreSQL e Redis',
      tags: ['Sistema (Público)'],
    },
    handler: async (request, reply) => {
      try {
        await Promise.all([
          fastify.prisma.$queryRaw`SELECT 1`,
          fastify.redis.ping(),
        ]);
        return {
          status: 'ready',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        };
      } catch (err: any) {
        request.log.error({ err }, 'Readiness check failed');
        return reply.status(503).send({
          status: 'not_ready',
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    },
  });

  // Registro de rotas públicas
  await fastify.register(publicCharacterRoutes);
  await fastify.register(publicLeaderboardRoutes);
  await fastify.register(publicCalculatorRoutes);

  // Registro de rotas web do usuário e moderação de admin
  await fastify.register(userWebRoutes);
  await fastify.register(adminWebRoutes);
  await fastify.register(telegramRoutes);

  // Registro de rotas privadas do bot
  await fastify.register(privateUserRoutes);
  await fastify.register(privateRollRoutes);
  await fastify.register(privateMarryRoutes);
  await fastify.register(privateDivorceRoutes);
  await fastify.register(privateHaremRoutes);
  await fastify.register(privateWishlistRoutes);
  await fastify.register(privateKakeraRoutes);
  await fastify.register(privateAdminRoutes);
  await fastify.register(privateMarketRoutes);
  await fastify.register(privateCovetRoutes);
  await fastify.register(privateCollectionRoutes);
  await fastify.register(privateEconomyRoutes);

  // Registro de rotas de catálogo e mídias do Storage Remoto (Hub)
  await fastify.register(externalCatalogRoutes, { prefix: '/api/v1/external' });

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();

    // Registra webhook do Telegram se configurado e URL pública válida
    try {
      const { TelegramNotificationService } = await import('./services/TelegramNotificationService.js');
      const telegramService = new TelegramNotificationService(server.redis);
      if (telegramService.isConfigured && config.PUBLIC_BASE_URL.startsWith('https://')) {
        await telegramService.registerWebhook(config.PUBLIC_BASE_URL);
      }
    } catch (tgErr: any) {
      server.log.warn({ err: tgErr.message }, 'Falha ao registrar webhook inicial do Telegram');
    }

    let hostingFeeScheduler: SchedulerHandle | null = null;

    // Encerramento gracioso
    const closeSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of closeSignals) {
      process.on(signal, async () => {
        server.log.info(`Recebido sinal ${signal}. Encerrando servidor graciosamente...`);
        hostingFeeScheduler?.stop();
        try {
          await server.close();
          process.exit(0);
        } catch (closeErr) {
          server.log.error(closeErr);
          process.exit(1);
        }
      });
    }

    process.on('unhandledRejection', (reason, promise) => {
      server.log.error({ reason, promise }, 'Unhandled Rejection detectada');
    });

    await server.listen({ port: config.PORT, host: config.HOST });
    hostingFeeScheduler = startHostingFeeScheduler({
      prisma: server.prisma,
      redis: server.redis,
      logger: server.log,
    });
    console.log(`🚀 Servidor Waifuletes rodando em http://${config.HOST}:${config.PORT}`);
    if (config.ENABLE_SWAGGER) {
      console.log(`📚 Documentação OpenAPI / Swagger disponível em http://${config.HOST}:${config.PORT}/docs`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Executar start apenas se chamado diretamente
if (process.env.NODE_ENV !== 'test') {
  start();
}

export { buildServer };
