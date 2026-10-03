import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
  });

  redis.on('error', (err: any) => {
    fastify.log.error({ err }, 'Redis connection error');
  });

  redis.on('connect', () => {
    fastify.log.info('Redis connected successfully');
  });

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
};

export default fp(redisPlugin);
