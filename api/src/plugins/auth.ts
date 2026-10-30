import { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual, createHash } from 'node:crypto';
import { apiKeys, externalApiKeys } from '../config.js';

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

export function isValidExternalApiKey(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const tokenHash = hashToken(token);

  // Valida tanto contra chaves de EXTERNAL_USAGE_API quanto contra apiKeys do dono
  const allowedKeys = [...externalApiKeys, ...apiKeys];
  for (const validKey of allowedKeys) {
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

export async function verifyExternalApiKey(request: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;

  // 1. Tenta extrair do cabeçalho Authorization: Bearer <token>
  const authHeader = request.headers.authorization;
  if (authHeader) {
    const [scheme, parsedToken] = authHeader.split(' ');
    if (scheme === 'Bearer' && parsedToken) {
      token = parsedToken;
    }
  }

  // 2. Se não houver no header, tenta extrair de query parameter (?key= ou ?apiKey=)
  if (!token && request.query && typeof request.query === 'object') {
    const query = request.query as Record<string, any>;
    if (typeof query.key === 'string' && query.key) {
      token = query.key;
    } else if (typeof query.apiKey === 'string' && query.apiKey) {
      token = query.apiKey;
    }
  }

  if (!token) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Chave de acesso externa não fornecida. Utilize: Bearer <key> ou ?key=<key>.',
      },
    });
  }

  if (!isValidExternalApiKey(token)) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Chave de acesso externa inválida.',
      },
    });
  }
}


