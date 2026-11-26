import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { HostingFeeService } from '../services/HostingFeeService.js';
import { NotificationService } from '../services/NotificationService.js';
import { DivorceService } from '../services/DivorceService.js';

export interface SchedulerHandle {
  stop: () => void;
}

interface LoggerLike {
  info: (obj: any, msg?: string) => void;
  warn: (obj: any, msg?: string) => void;
  error: (obj: any, msg?: string) => void;
}

/**
 * Calcula o próximo horário de reset diário (04:00 BRT = 07:00 UTC por padrão)
 * estritamente posterior a `now`.
 */
export function nextDailyResetAt(
  now: Date = new Date(),
  hourUtc: number = config.DAILY_RESET_HOUR_UTC ?? 7,
  minuteUtc: number = config.DAILY_RESET_MINUTE_UTC ?? 0
): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minuteUtc, 0, 0)
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

/**
 * Agenda a execução diária da taxa de hospedagem junto ao reset oficial das 04:00 BRT.
 * A idempotência por dia/usuário no HostingFeeService impede cobranças duplicadas.
 */
export function startHostingFeeScheduler(deps: {
  prisma: PrismaClient;
  redis: Redis;
  logger?: LoggerLike;
}): SchedulerHandle {
  const notificationService = new NotificationService(deps.prisma);
  const divorceService = new DivorceService(deps.prisma, undefined, deps.redis);
  const hostingFeeService = new HostingFeeService(deps.prisma, deps.redis, notificationService, divorceService);

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    const now = new Date();
    const nextRun = nextDailyResetAt(now);
    const delayMs = Math.max(1000, nextRun.getTime() - now.getTime());

    deps.logger?.info(
      { nextRunAt: nextRun.toISOString(), delayMs },
      'Agendamento da taxa diária de hospedagem armado para o próximo reset (04:00 BRT)'
    );

    timer = setTimeout(async () => {
      if (stopped) return;
      try {
        const summary = await hostingFeeService.runDailyFee();
        deps.logger?.info({ summary }, 'Taxa diária de hospedagem executada com sucesso');
      } catch (err: any) {
        if (err?.code === 'ALREADY_RAN' || err?.code === 'ALREADY_RUNNING') {
          deps.logger?.info({ code: err.code, message: err.message }, 'Taxa diária de hospedagem já executada hoje');
        } else {
          deps.logger?.error({ err: err?.message || err }, 'Falha ao executar taxa diária de hospedagem agendada');
        }
      } finally {
        scheduleNext();
      }
    }, delayMs);

    timer.unref();
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
