import { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual, createHash } from 'node:crypto';
import { apiKeys } from '../config.js';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function isValidApiKey(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const tokenHash = hashToken(token);

  for (const validKey of apiKeys) {
    const validHash = hashToken(validKey);
    if (tokenHash.length === validHash.length && timingSafeEqual(tokenHash, validHash)) {
      return true;
    }
  }

  return false;
}

export function isTrustedRequest(request: FastifyRequest): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return isValidApiKey(token);
}

export async function verifyApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Cabeçalho Authorization não fornecido.',
      },
    });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Formato de autenticação inválido. Utilize: Bearer <API_KEY>',
      },
    });
  }

  if (!isValidApiKey(token)) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token de API inválido.',
      },
    });
  }
}

