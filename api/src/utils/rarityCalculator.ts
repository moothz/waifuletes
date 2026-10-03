import { Rarity } from '@prisma/client';

export const RARITY_BASE_WEIGHTS: Record<Rarity, number> = {
  LEGENDARY: 5,
  EPIC: 15,
  RARE: 30,
  UNCOMMON: 60,
  COMMON: 100,
};

export const RARITY_DIVORCE_VALUES: Record<Rarity, number> = {
  COMMON: 50,
  UNCOMMON: 150,
  RARE: 350,
  EPIC: 700,
  LEGENDARY: 1500,
};

export const KEY_KAKERA_BONUS = 15;
export const DIVORCE_PENALTY_RATE = 0.05; // 5%

export interface RollBonuses {
  donorBadge?: string;
  wishlistMultiplier?: number;
  starWishMultiplier?: number;
  rarityMultipliers?: Partial<Record<Rarity, number>>;
  extraMaxRolls?: number;
}

export interface WeightCalculationParams {
  baseRarity: Rarity;
  claimCount: number;
  totalActiveUsersOrClaims: number;
  isWishlisted?: boolean;
  isStarWish?: boolean;
  bonuses?: RollBonuses;
}

export function calculateCharacterWeight(params: WeightCalculationParams): number {
  let base = RARITY_BASE_WEIGHTS[params.baseRarity] ?? 100;

  // Custom rarity multiplier / donor bonus
  const rarityMult = params.bonuses?.rarityMultipliers?.[params.baseRarity];
  if (typeof rarityMult === 'number' && rarityMult > 0) {
    base *= rarityMult;
  }

  // Popularity factor: more claimed = harder to get
  const total = Math.max(1, params.totalActiveUsersOrClaims);
  const ratio = params.claimCount / total;
  const popularityFactor = Math.max(0.1, 1 - ratio * 0.5);

  let finalWeight = base * popularityFactor;

  // Wishlist and StarWish multipliers (default: 1.5x and 2.0x, or custom via bonuses)
  const defaultWishMult = 1.5;
  const defaultStarMult = 2.0;

  if (params.isStarWish) {
    const starMult = params.bonuses?.starWishMultiplier ?? defaultStarMult;
    finalWeight *= starMult;
  } else if (params.isWishlisted) {
    const wishMult = params.bonuses?.wishlistMultiplier ?? defaultWishMult;
    finalWeight *= wishMult;
  }

  return Math.max(1, Math.round(finalWeight));
}

export function calculateDivorceRefund(baseRarity: Rarity, keys: number) {
  const baseValue = RARITY_DIVORCE_VALUES[baseRarity] ?? 50;
  const keysBonus = Math.max(0, keys) * KEY_KAKERA_BONUS;
  const rawValue = baseValue + keysBonus;

  // 5% penalty on refund
  const netKakera = Math.floor(rawValue * (1 - DIVORCE_PENALTY_RATE));
  // 5% loss of keys (minimum 0)
  const remainingKeys = Math.max(0, Math.floor(keys * (1 - DIVORCE_PENALTY_RATE)));

  return {
    baseValue,
    keysBonus,
    rawValue,
    netKakera,
    remainingKeys,
  };
}
