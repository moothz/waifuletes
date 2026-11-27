import { Rarity } from '@prisma/client';
import { config, cotaRarityDays, marriedProgressionWeights } from '../config.js';

export const RARITY_BASE_WEIGHTS: Record<Rarity, number> = {
  LEGENDARY: 2.5,
  EPIC: 8,
  RARE: 25,
  UNCOMMON: 60,
  COMMON: 100,
};

// Valores de cristal de Kakera gerado em sorteios casuais de personagens já casados
export const KAKERA_CRYSTAL_BASE: Record<Rarity, number> = {
  COMMON: 10,
  UNCOMMON: 30,
  RARE: 70,
  EPIC: 140,
  LEGENDARY: 300,
};

// Bônus do cristal por chave que o dono tem no personagem sorteado (cristal = base da raridade + chaves × bônus)
export const KAKERA_CRYSTAL_KEY_BONUS = 5;

// Valores de divórcio comum (não-soulmate)
export const RARITY_DIVORCE_VALUES: Record<Rarity, number> = {
  COMMON: 50,
  UNCOMMON: 150,
  RARE: 350,
  EPIC: 700,
  LEGENDARY: 1500,
};

// Bônus por chave escalonado por raridade para divórcio comum
export const RARITY_KEY_DIVORCE_BONUS: Record<Rarity, number> = {
  COMMON: 500,
  UNCOMMON: 2000,
  RARE: 5000,
  EPIC: 25000,
  LEGENDARY: 75000,
};

// Valores de divórcio equivalentes a 4 COTAS exclusivo para SOULMATES (100% do preço base de mercado da waifu: RARITY_DAYS * BASE_DAILY_ZINTHOS)
export const SOULMATE_DIVORCE_VALUES: Record<Rarity, number> = {
  COMMON: cotaRarityDays.COMMON * (config.COTA_BASE_DAILY_ZINTHOS ?? 21000),
  UNCOMMON: cotaRarityDays.UNCOMMON * (config.COTA_BASE_DAILY_ZINTHOS ?? 21000),
  RARE: cotaRarityDays.RARE * (config.COTA_BASE_DAILY_ZINTHOS ?? 21000),
  EPIC: cotaRarityDays.EPIC * (config.COTA_BASE_DAILY_ZINTHOS ?? 21000),
  LEGENDARY: cotaRarityDays.LEGENDARY * (config.COTA_BASE_DAILY_ZINTHOS ?? 21000),
};

export const SOULMATE_KEY_KAKERA_BONUS = 21000; // 21.000 Zinthos de bônus por chave para soulmates
export const KEY_KAKERA_BONUS = 15; // Legado mantido para compatibilidade

// Pontuação de ranking de coleção concedida por Soulmate conforme a raridade base
export const SOULMATE_RANKING_SCORES: Record<Rarity, number> = {
  LEGENDARY: 2200,
  EPIC: 1300,
  RARE: 800,
  UNCOMMON: 500,
  COMMON: 200,
};
export const DIVORCE_PENALTY_RATE = 0.05; // 5% de taxa de divórcio

// Escalonamento do Soft Limite diário de divórcio por raridade
export const DAILY_DIVORCE_TIER_RATES = [
  1.0, // 1º divórcio do dia: 100%
  0.8, // 2º divórcio do dia: 80%
  0.5, // 3º divórcio do dia: 50%
  0.2, // 4º divórcio do dia: 20%
];
export const DAILY_DIVORCE_MIN_RATE = 0.05; // 5º em diante: 5% (Mínimo: 5%)

/**
 * Retorna o multiplicador de reembolso baseado no número do divórcio daquela raridade no dia.
 * @param divorceNumber 1 para 1º divórcio, 2 para 2º, etc.
 */
export function getDailyDivorceRate(divorceNumber: number): number {
  if (divorceNumber <= 1) return 1.0;
  const idx = divorceNumber - 1;
  if (idx < DAILY_DIVORCE_TIER_RATES.length) {
    return DAILY_DIVORCE_TIER_RATES[idx];
  }
  return DAILY_DIVORCE_MIN_RATE;
}

export interface DivorceRefundOptions {
  isSoulmate?: boolean;
  inflationMultiplier?: number;
  dailyDivorceRate?: number;
  rankMultiplier?: number;
  payoutMultiplier?: number;
}

/**
 * Calcula o multiplicador de divórcio (1x a 7x) com base na posição do personagem dentro da sua categoria (raridade).
 * Utiliza curva exponencial cúbica concentrada no topo para proteger a economia de inflação:
 * - Posição 1: 7.0x (Pico de recompensa no topo absoluto da categoria)
 * - Top 10%: ~5.4x
 * - Top 25%: ~3.5x
 * - Top 50% (mediana): ~1.75x
 * - Posições inferiores têm piso mínimo garantido em 1.0x (não desvaloriza abaixo do valor base).
 */
export const RANK_MULTIPLIER_MAX = config.RANK_MULTIPLIER_MAX; // multiplicador da posição 1 da raridade
export const RANK_MULTIPLIER_EXPONENT = 3; // curva cúbica: concentra o multiplicador no topo

export function calculateRankMultiplier(position: number, total: number): number {
  if (!total || total <= 1 || !position || position < 1) return 1.0;
  if (position === 1) return RANK_MULTIPLIER_MAX;
  if (position >= total) return 1.0;
  const ratio = Math.max(0, 1.0 - (position - 1) / total);
  const mult = Math.max(1.0, 1.0 + (RANK_MULTIPLIER_MAX - 1.0) * Math.pow(ratio, RANK_MULTIPLIER_EXPONENT));
  return Number(mult.toFixed(4));
}

/**
 * Pesos progressivos de custo para evolução de chaves via cotas de cônjuge (chaves 1 -> 2 até 9 -> 10).
 * Quanto mais chaves o jogador possui no personagem, mais caras ficam as cotas.
 * A progressão sobe gradativamente até a última cota da 10ª chave (Soulmate) atingir o valor de referência
 * integral (peso 1.0, ~5x o valor anterior), parametrizável via .env.
 */
export const MARRIED_KEY_PROGRESSION_WEIGHTS: number[] = marriedProgressionWeights;

export interface CharacterSharePricingParams {
  baseRarity: Rarity;
  baseDynamicPrice: number;
  scarcityMultiplier?: number;
  inflationMultiplier?: number;
  rankMultiplier?: number;
  isOwner?: boolean;
  currentKeys?: number;
  haremExtraKeys?: number;
  extraKeySurchargePercent?: number;
}

export function calculateCharacterSharePricing(params: CharacterSharePricingParams) {
  const inflationMultiplier =
    typeof params.inflationMultiplier === 'number' && params.inflationMultiplier > 0 ? params.inflationMultiplier : 1.0;
  const scarcityMultiplier =
    typeof params.scarcityMultiplier === 'number' && params.scarcityMultiplier > 0 ? params.scarcityMultiplier : 1.0;
  const rankMultiplier =
    typeof params.rankMultiplier === 'number' && params.rankMultiplier > 0 ? params.rankMultiplier : 1.0;
  const currentKeys = Math.max(0, Math.floor(params.currentKeys ?? 0));
  const haremExtraKeys = Math.max(0, Math.floor(params.haremExtraKeys ?? 0));
  const extraKeySurchargePercent =
    typeof params.extraKeySurchargePercent === 'number' && params.extraKeySurchargePercent >= 0
      ? params.extraKeySurchargePercent
      : (config.COTA_HAREM_EXTRA_KEY_SURCHARGE_PERCENT ?? 0.5);
  const haremSurchargePercent = Number((haremExtraKeys * extraKeySurchargePercent).toFixed(4));
  const haremSurchargeMultiplier = 1 + haremSurchargePercent / 100;

  // Valor bruto de divórcio Soulmate (10 chaves) deste personagem considerando seu rank e inflação
  const soulmateDivorce = calculateDivorceRefund(params.baseRarity, 10, {
    isSoulmate: true,
    inflationMultiplier,
    rankMultiplier,
  });

  // Base de referência para 4 cotas: nunca inferior ao valor bruto de divórcio Soulmate ajustado pela escassez
  // e pela sobretaxa de chaves extras no harém do jogador.
  const baseReferenceDynamicPrice = Math.max(
    params.baseDynamicPrice,
    Math.round(soulmateDivorce.rawValue * scarcityMultiplier)
  );
  const referenceDynamicPrice = Math.round(baseReferenceDynamicPrice * haremSurchargeMultiplier);
  const baseCotaPrice = Math.ceil(referenceDynamicPrice / 4);

  if (!params.isOwner) {
    return {
      dynamicPrice: referenceDynamicPrice,
      cotaPrice: baseCotaPrice,
      baseCotaPrice,
      discountPercent: 0,
      keyProgressionWeight: 1.0,
      haremExtraKeys,
      extraKeySurchargePercent,
      haremSurchargePercent,
      haremSurchargeMultiplier,
    };
  }

  const keyIdx = Math.max(
    0,
    Math.min(MARRIED_KEY_PROGRESSION_WEIGHTS.length - 1, Math.max(1, currentKeys) - 1)
  );
  const weight = MARRIED_KEY_PROGRESSION_WEIGHTS[keyIdx];
  const marriedKeyDynamicPrice = Math.round(referenceDynamicPrice * weight);
  const marriedCotaPrice = Math.ceil(marriedKeyDynamicPrice / 4);
  const discountPercent = weight < 1.0 ? Math.round((1 - weight) * 100) : 0;

  return {
    dynamicPrice: marriedKeyDynamicPrice,
    cotaPrice: marriedCotaPrice,
    baseCotaPrice,
    discountPercent,
    keyProgressionWeight: weight,
    haremExtraKeys,
    extraKeySurchargePercent,
    haremSurchargePercent,
    haremSurchargeMultiplier,
  };
}

export interface RollBonuses {
  donorBadge?: string;
  wishlistMultiplier?: number;
  starWishMultiplier?: number;
  rarityMultipliers?: Partial<Record<Rarity, number>>;
  extraMaxRolls?: number;
  isFreeRoll?: boolean;
}

export interface WeightCalculationParams {
  baseRarity: Rarity;
  claimCount: number;
  totalActiveUsersOrClaims: number;
  isWishlisted?: boolean;
  isStarWish?: boolean;
  bonuses?: RollBonuses;
  investmentShares?: number;
  weeklyLegendaryMultiplier?: number;
  rollRankWeight?: number;
}

/**
 * Retorna o multiplicador de probabilidade para sorteio de personagens Lendários (0.0 a 1.0)
 * baseado na quantidade de Lendários já obtidos pelo usuário na semana corrente.
 *
 * Curva de Diminishing Returns:
 * - 0 lendárias na semana: 1.0 (100% da chance base/cap)
 * - 1 lendária: ~0.82 (82%)
 * - 2 lendárias: ~0.65 (65%)
 * - 3 lendárias: ~0.49 (49%)
 * - 4 lendárias: ~0.35 (35%)
 * - 5 lendárias: ~0.23 (23%)
 * - 6 lendárias: ~0.13 (13%)
 * - 7 lendárias: ~0.04 (4%)
 * - 8+ lendárias: 0.0 (Hard Cap: 0% de chance, bloqueio total de novos sorteios de Lendários na semana)
 */
export function calculateWeeklyLegendaryMultiplier(weeklyCount: number, hardCap: number = 8): number {
  if (hardCap <= 0) return 1.0;
  if (weeklyCount >= hardCap) return 0.0;
  if (weeklyCount <= 0) return 1.0;

  const ratio = (hardCap - weeklyCount) / hardCap;
  const mult = Math.pow(ratio, 1.5);
  return Math.max(0, Math.min(1.0, mult));
}

/**
 * Calcula o multiplicador de peso de sorteio baseado no rank global (Mudae).
 * Um personagem rank 1 tem peso 1.0 (7x mais difícil).
 * Um personagem rank >= refCutoff (20.000) ou sem rank tem peso maxDiff (7.0).
 */
export function calculateRollRankWeight(
  rank: number | null | undefined,
  maxDiff: number = 7.0,
  refCutoff: number = 20_000
): number {
  if (rank == null || rank >= refCutoff) return maxDiff;
  if (rank <= 1) return 1.0;
  return 1.0 + (maxDiff - 1.0) * ((rank - 1) / (refCutoff - 1));
}

export function calculateCharacterWeight(params: WeightCalculationParams): number {
  if (params.baseRarity === 'LEGENDARY' && params.weeklyLegendaryMultiplier !== undefined && params.weeklyLegendaryMultiplier <= 0) {
    return 0;
  }

  let base = RARITY_BASE_WEIGHTS[params.baseRarity] ?? 100;

  // Custom rarity multiplier / donor bonus
  const rarityMult = params.bonuses?.rarityMultipliers?.[params.baseRarity];

  // Popularity factor: more claimed = harder to get
  const total = Math.max(1, params.totalActiveUsersOrClaims);
  const ratio = params.claimCount / total;
  const popularityFactor = Math.max(0.1, 1 - ratio * 0.5);

  // Wishlist and StarWish multipliers (default: 1.5x and 2.0x, or custom via bonuses)
  const defaultWishMult = 1.5;
  const defaultStarMult = 2.0;

  let finalWeight: number;

  if (params.baseRarity === 'LEGENDARY') {
    // Desacoplamento para Lendários: o multiplicador de wishlist incide sobre o peso base (2.5),
    // somando com o bônus de raridade em vez de multiplicar em cascata (evita 2.5 * 10 * 20 = 500).
    const rMult = typeof rarityMult === 'number' && rarityMult > 0 ? rarityMult : 1.0;
    let wMult = 1.0;
    if (params.isStarWish) {
      wMult = params.bonuses?.starWishMultiplier ?? defaultStarMult;
    } else if (params.isWishlisted) {
      wMult = params.bonuses?.wishlistMultiplier ?? defaultWishMult;
    }
    const combinedMult = Math.max(1.0, rMult + Math.max(0, wMult - 1.0));
    finalWeight = base * combinedMult * popularityFactor;
    if (typeof params.weeklyLegendaryMultiplier === 'number') {
      finalWeight *= params.weeklyLegendaryMultiplier;
    }
  } else {
    if (typeof rarityMult === 'number' && rarityMult > 0) {
      base *= rarityMult;
    }
    let weight = base * popularityFactor;
    if (params.isStarWish) {
      const starMult = params.bonuses?.starWishMultiplier ?? defaultStarMult;
      weight *= starMult;
    } else if (params.isWishlisted) {
      const wishMult = params.bonuses?.wishlistMultiplier ?? defaultWishMult;
      weight *= wishMult;
    }
    finalWeight = weight;
  }

  // Multiplicador de Cotas de Investimento:
  // 1 cota (25%): 4x peso (+300%)
  // 2 cotas (50%): 10x peso (+900%)
  // 3 cotas (75%): 25x peso (+2400%)
  if (params.investmentShares && params.investmentShares > 0) {
    const shareMult = params.investmentShares === 1 ? 4 : params.investmentShares === 2 ? 10 : 25;
    finalWeight *= shareMult;
  }

  if (typeof params.rollRankWeight === 'number' && params.rollRankWeight > 0) {
    finalWeight *= params.rollRankWeight;
  }

  if (params.baseRarity === 'LEGENDARY' && params.weeklyLegendaryMultiplier !== undefined && params.weeklyLegendaryMultiplier <= 0) {
    return 0;
  }

  return Math.max(1, Math.round(finalWeight));
}

export function calculateDivorceRefund(
  baseRarity: Rarity,
  keys: number,
  optionsOrIsSoulmate?: boolean | DivorceRefundOptions,
  legacyInflation?: number
) {
  let isSoulmate = false;
  let inflationMultiplier = 1.0;
  let dailyDivorceRate = 1.0;
  let rankMultiplier = 1.0;
  let payoutMultiplier = 1.0;

  if (typeof optionsOrIsSoulmate === 'boolean') {
    isSoulmate = optionsOrIsSoulmate;
    if (typeof legacyInflation === 'number' && legacyInflation > 0) {
      inflationMultiplier = legacyInflation;
    }
  } else if (optionsOrIsSoulmate && typeof optionsOrIsSoulmate === 'object') {
    isSoulmate = Boolean(optionsOrIsSoulmate.isSoulmate);
    if (typeof optionsOrIsSoulmate.inflationMultiplier === 'number' && optionsOrIsSoulmate.inflationMultiplier > 0) {
      inflationMultiplier = optionsOrIsSoulmate.inflationMultiplier;
    }
    if (typeof optionsOrIsSoulmate.dailyDivorceRate === 'number' && optionsOrIsSoulmate.dailyDivorceRate > 0) {
      dailyDivorceRate = optionsOrIsSoulmate.dailyDivorceRate;
    }
    if (typeof optionsOrIsSoulmate.rankMultiplier === 'number' && optionsOrIsSoulmate.rankMultiplier > 0) {
      rankMultiplier = optionsOrIsSoulmate.rankMultiplier;
    }
    if (typeof optionsOrIsSoulmate.payoutMultiplier === 'number' && optionsOrIsSoulmate.payoutMultiplier > 0) {
      payoutMultiplier = optionsOrIsSoulmate.payoutMultiplier;
    }
  }

  const maxKeys = config.SOULMATE_KEYS_REQUIRED ?? 10;
  const effectiveKeys = Math.max(0, Math.min(keys, maxKeys));
  const rarityBase = RARITY_DIVORCE_VALUES[baseRarity] ?? 50;
  const baseValue = isSoulmate
    ? (SOULMATE_DIVORCE_VALUES[baseRarity] ?? 315000)
    : rarityBase;

  const bonusPerKey = RARITY_KEY_DIVORCE_BONUS[baseRarity] ?? 500;
  const keysBonus = effectiveKeys * bonusPerKey;

  // Para Soulmates, o reembolso base de 4 cotas (SOULMATE_DIVORCE_VALUES) não é multiplicado pelo rankMultiplier;
  // o rankMultiplier incide apenas sobre o valor de divórcio da raridade + bônus de chaves.
  const rawBeforeInflation = isSoulmate
    ? baseValue + (rarityBase + keysBonus) * rankMultiplier
    : (baseValue + keysBonus) * rankMultiplier;
  let rawValue = Math.round(rawBeforeInflation * inflationMultiplier * payoutMultiplier);

  // Trava anti-exploit: o retorno bruto do divórcio nunca pode superar 75% do custo mínimo
  // de reposição das cotas (casamento inicial + evoluções com pesos progressivos).
  if (isSoulmate) {
    const evolutionCount = Math.max(0, Math.min(effectiveKeys - 1, MARRIED_KEY_PROGRESSION_WEIGHTS.length));
    let replacementWeight = 1.0;
    for (let i = 0; i < evolutionCount; i++) {
      replacementWeight += MARRIED_KEY_PROGRESSION_WEIGHTS[i] ?? 1.0;
    }
    const minReplacementCost = (SOULMATE_DIVORCE_VALUES[baseRarity] ?? 315000) * replacementWeight * inflationMultiplier;
    const maxAllowedRawValue = Math.round(minReplacementCost * 0.75);
    rawValue = Math.min(rawValue, maxAllowedRawValue);
  }

  // 5% penalty on refund (penalidade arredondada para cima conforme regra de divórcio por rank)
  const fullNetKakera = Math.floor(rawValue * (1 - DIVORCE_PENALTY_RATE));
  // Aplicação do Soft Limite diário por raridade
  const netKakera = Math.max(1, Math.floor(fullNetKakera * dailyDivorceRate));

  // 5% loss of keys (minimum 0)
  const remainingKeys = Math.max(0, Math.floor(effectiveKeys * (1 - DIVORCE_PENALTY_RATE)));

  return {
    baseValue,
    keysBonus,
    rawBeforeInflation,
    rawValue,
    fullNetKakera,
    netKakera,
    dailyDivorceRate,
    rankMultiplier,
    remainingKeys,
    isSoulmate,
    inflationMultiplier,
  };
}
