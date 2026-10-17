import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

export interface UserSessionData {
  userId: string;
  publicId: string;
  inventory?: {
    fishes?: any[];
    buffs?: any[];
    farmItems?: any[];
  } | null;
}

export class WebSessionService {
  constructor(
    private redis: Redis,
    private prisma: PrismaClient
  ) {}

  /**
   * Cria uma sessão web temporária de 30 minutos para o usuário
   */
  async createUserSession(userId: string, inventorySnapshot?: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, publicId: true, name: true },
    });

    if (!user) {
      throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.');
    }

    const token = randomUUID();
    const sessionData: UserSessionData = {
      userId: user.id,
      publicId: user.publicId,
      inventory: inventorySnapshot || null,
    };

    // 1800 segundos = 30 minutos
    await this.redis.set(`web:session:${token}`, JSON.stringify(sessionData), 'EX', 1800);

    return {
      publicId: user.publicId,
      token,
      url: `${config.PUBLIC_BASE_URL}/user/${user.publicId}?token=${token}`,
      publicUrl: `${config.PUBLIC_BASE_URL}/user/${user.publicId}`,
      expiresIn: 1800,
    };
  }

  /**
   * Valida uma sessão web de usuário e confere se pertence ao publicId solicitado
   */
  async validateUserSession(publicId: string, token?: string) {
    if (!token || typeof token !== 'string') {
      return { valid: false as const, userId: null, inventory: null, expiresIn: 0 };
    }

    const raw = await this.redis.get(`web:session:${token}`);
    if (!raw) {
      return { valid: false as const, userId: null, inventory: null, expiresIn: 0 };
    }

    try {
      const data = JSON.parse(raw) as UserSessionData;
      if (data.publicId !== publicId) {
        return { valid: false as const, userId: null, inventory: null, expiresIn: 0 };
      }

      const ttl = await this.redis.ttl(`web:session:${token}`);

      return {
        valid: true as const,
        userId: data.userId,
        publicId: data.publicId,
        inventory: data.inventory || null,
        expiresIn: Math.max(0, ttl),
      };
    } catch (_) {
      return { valid: false as const, userId: null, inventory: null, expiresIn: 0 };
    }
  }

  /**
   * Obtém a sessão do usuário apenas pelo token (para rotas autenticadas da API)
   */
  async getUserSessionByToken(token?: string) {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const raw = await this.redis.get(`web:session:${token}`);
    if (!raw) return null;

    try {
      const data = JSON.parse(raw) as UserSessionData;
      const ttl = await this.redis.ttl(`web:session:${token}`);
      return {
        ...data,
        expiresIn: Math.max(0, ttl),
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Cria uma sessão de administrador (24 horas)
   */
  async createAdminSession() {
    const token = randomUUID();
    // 86400 segundos = 24 horas
    await this.redis.set(`admin:session:${token}`, 'admin', 'EX', 86400);

    return {
      token,
      expiresIn: 86400,
    };
  }

  /**
   * Valida sessão de administrador
   */
  async validateAdminSession(token?: string): Promise<boolean> {
    if (!token || typeof token !== 'string') return false;
    const val = await this.redis.get(`admin:session:${token}`);
    return val === 'admin';
  }

  /**
   * Invalida sessão de administrador
   */
  async invalidateAdminSession(token: string): Promise<void> {
    if (token) {
      await this.redis.del(`admin:session:${token}`);
    }
  }
}
