/**
 * Simulação pura de perda total de um jogador inativo.
 *
 * Espelha a lógica do HostingFeeService (taxa diária + confisco de waifus) para
 * projetar quantos dias até o jogador perder tudo, dado que ele nunca mais entra.
 * Não toca no banco: recebe o estado atual e devolve a projeção.
 */
import { Rarity } from '@prisma/client';
import { config, inactiveHostingRates } from '../config.js';
import { calculateInactiveMultiplier } from './HostingFeeService.js';
import { calculateDivorceRefund } from '../utils/rarityCalculator.js';

export interface ProjectedHaremEntry {
  characterId: string;
  rarity: Rarity;
  keys: number;
  claimedAt: Date | string;
  isSoulmate: boolean;
}

export interface InactiveProjectionInput {
  balance: number;
  harem: ProjectedHaremEntry[];
  /** ms desde a última atividade do jogador */
  offlineMs: number;
  /** janela de carência em ms (ex.: 72h) */
  graceMs: number;
  inflationMultiplier: number;
  /** teto de projeção em dias (padrão 365) */
  maxDays?: number;
}

export interface InactiveProjectionResult {
  /** dias até o harém esvaziar; null quando não esvazia dentro do teto */
  estimatedDays: number | null;
  /** saldo projetado ao fim da simulação (0 se esvaziou e sobrou dívida) */
  finalBalance: number;
  /** waifus remanescentes ao fim da simulação */
  waifusRemaining: number;
  /** waifus confiscados ao longo da simulação */
  confiscatedCount: number;
  /** taxa estimada para hoje (primeiro dia simulado) */
  todayFee: number;
  /** multiplicador de inatividade efetivo hoje */
  todayMultiplier: number;
}

export const DEFAULT_MAX_SIMULATION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RARITY_PRIORITY: Record<Rarity, number> = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
};

function confiscoRatio(): number {
  return Math.max(0, Number(config.HOSTING_CONFISCO_PERMILLE ?? 3000)) / 10000;
}

function recoveredValue(entry: ProjectedHaremEntry, inflationMultiplier: number): number {
  // Mesma base do confisco real: valor integral de divórcio com soulmate e inflação, sem soft limit diário
  const refund = calculateDivorceRefund(entry.rarity, entry.keys, {
    isSoulmate: entry.isSoulmate,
    inflationMultiplier,
    dailyDivorceRate: 1.0,
  });
  return Math.max(1, Math.floor(refund.fullNetKakera * confiscoRatio()));
}

/** Ordena pela ordem de confisco real: raridade crescente, depois mais antigo primeiro. */
function confiscationOrder(entries: ProjectedHaremEntry[]): ProjectedHaremEntry[] {
  return [...entries].sort((a, b) => {
    const pA = RARITY_PRIORITY[a.rarity];
    const pB = RARITY_PRIORITY[b.rarity];
    if (pA !== pB) return pA - pB;
    return new Date(a.claimedAt).getTime() - new Date(b.claimedAt).getTime();
  });
}

export function simulateInactiveLoss(input: InactiveProjectionInput): InactiveProjectionResult {
  const maxDays = Math.max(1, Math.floor(input.maxDays ?? DEFAULT_MAX_SIMULATION_DAYS));
  const balanceInitial = Math.max(0, Number(input.balance) || 0);
  const remaining = confiscationOrder(input.harem);

  if (remaining.length === 0) {
    return { estimatedDays: 0, finalBalance: balanceInitial, waifusRemaining: 0, confiscatedCount: 0, todayFee: 0, todayMultiplier: 1.0 };
  }

  let balance = balanceInitial;
  let confiscatedCount = 0;
  let todayFee = 0;
  let todayMultiplier = 1.0;

  for (let day = 1; day <= maxDays; day++) {
    const offlineMsNow = input.offlineMs + (day - 1) * MS_PER_DAY;
    const multiplier = calculateInactiveMultiplier(
      offlineMsNow,
      input.graceMs,
      config.HOSTING_INACTIVE_DAILY_SURCHARGE_PERCENT,
      config.HOSTING_INACTIVE_MAX_MULTIPLIER
    );
    if (day === 1) {
      todayMultiplier = multiplier;
    }
    const rates: Record<Rarity, number> = {
      COMMON: Math.round(inactiveHostingRates.COMMON * multiplier),
      UNCOMMON: Math.round(inactiveHostingRates.UNCOMMON * multiplier),
      RARE: Math.round(inactiveHostingRates.RARE * multiplier),
      EPIC: Math.round(inactiveHostingRates.EPIC * multiplier),
      LEGENDARY: Math.round(inactiveHostingRates.LEGENDARY * multiplier),
    };
    const totalFee = remaining.reduce((sum, entry) => sum + rates[entry.rarity], 0);
    if (day === 1) {
      todayFee = totalFee;
    }

    if (totalFee <= 0) {
      // Nenhum waifu cobrado (ex.: todos míticos): para evitar loop infinito, encerra a simulação
      return { estimatedDays: null, finalBalance: balance, waifusRemaining: remaining.length, confiscatedCount, todayFee, todayMultiplier };
    }

    if (balance >= totalFee) {
      balance -= totalFee;
      continue;
    }

    // Saldo insuficiente: cobra o saldo e confisca na ordem de menos valioso primeiro
    const debited = balance;
    balance = 0;
    let debt = totalFee - debited;
    const confiscatedNow: string[] = [];
    for (const entry of remaining) {
      if (debt <= 0) break;
      debt -= recoveredValue(entry, input.inflationMultiplier);
      confiscatedNow.push(entry.characterId);
    }
    const confiscatedSet = new Set(confiscatedNow);
    for (const id of confiscatedSet) {
      const idx = remaining.findIndex((e) => e.characterId === id);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    confiscatedCount += confiscatedSet.size;

    // O confisco rendeu mais que a dívida: a sobra volta ao saldo
    if (debt < 0) balance = -debt;

    if (remaining.length === 0) {
      return { estimatedDays: day, finalBalance: balance, waifusRemaining: 0, confiscatedCount, todayFee, todayMultiplier };
    }
  }

  return { estimatedDays: null, finalBalance: balance, waifusRemaining: remaining.length, confiscatedCount, todayFee, todayMultiplier };
}

/** Valor com desconto de confisco de um harém atual. Útil para a tabela admin. */
export function haremValueWithDiscount(harem: ProjectedHaremEntry[], inflationMultiplier: number): number {
  return harem.reduce((sum, entry) => sum + recoveredValue(entry, inflationMultiplier), 0);
}
