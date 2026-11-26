import { describe, it, expect } from 'vitest';
import {
  calculateDivorceRefund,
  RARITY_DIVORCE_VALUES,
  SOULMATE_DIVORCE_VALUES,
  RARITY_KEY_DIVORCE_BONUS,
  SOULMATE_KEY_KAKERA_BONUS,
} from '../src/utils/rarityCalculator.js';

describe('💔 Divorce Refund Calculations (Normal vs Soulmate vs Inflation)', () => {
  it('deve calcular corretamente o divórcio normal para 1 chave sem inflação', () => {
    // The Temp King (COMMON, 1 key)
    const commonRefund = calculateDivorceRefund('COMMON', 1);
    expect(commonRefund.baseValue).toBe(50);
    expect(commonRefund.keysBonus).toBe(500);
    expect(commonRefund.rawValue).toBe(550);
    expect(commonRefund.netKakera).toBe(522); // floor(550 * 0.95)
    expect(commonRefund.isSoulmate).toBe(false);

    // George Washbrook (UNCOMMON, 1 key)
    const uncommonRefund = calculateDivorceRefund('UNCOMMON', 1);
    expect(uncommonRefund.baseValue).toBe(150);
    expect(uncommonRefund.keysBonus).toBe(2000);
    expect(uncommonRefund.rawValue).toBe(2150);
    expect(uncommonRefund.netKakera).toBe(2042); // floor(2150 * 0.95)

    // Eiji Asuma / Hisui (RARE, 1 key)
    const rareRefund = calculateDivorceRefund('RARE', 1);
    expect(rareRefund.baseValue).toBe(350);
    expect(rareRefund.keysBonus).toBe(5000);
    expect(rareRefund.rawValue).toBe(5350);
    expect(rareRefund.netKakera).toBe(5082); // floor(5350 * 0.95)

    // EPIC (1 key)
    const epicRefund = calculateDivorceRefund('EPIC', 1);
    expect(epicRefund.baseValue).toBe(700);
    expect(epicRefund.keysBonus).toBe(25000);
    expect(epicRefund.rawValue).toBe(25700);
    expect(epicRefund.netKakera).toBe(24415); // floor(25700 * 0.95)

    // LEGENDARY (1 key)
    const legRefund = calculateDivorceRefund('LEGENDARY', 1);
    expect(legRefund.baseValue).toBe(1500);
    expect(legRefund.keysBonus).toBe(75000);
    expect(legRefund.rawValue).toBe(76500);
    expect(legRefund.netKakera).toBe(72675); // floor(76500 * 0.95)
  });

  it('deve calcular corretamente o divórcio normal com inflação de 59% (IM = 1.5906)', () => {
    const im = 1.5906;

    // COMMON 1 key
    const commonRefund = calculateDivorceRefund('COMMON', 1, { inflationMultiplier: im });
    expect(commonRefund.rawBeforeInflation).toBe(550);
    expect(commonRefund.rawValue).toBe(Math.round(550 * im)); // 875
    expect(commonRefund.netKakera).toBe(Math.floor(875 * 0.95)); // 831

    // RARE 1 key
    const rareRefund = calculateDivorceRefund('RARE', 1, { inflationMultiplier: im });
    expect(rareRefund.rawBeforeInflation).toBe(5350);
    expect(rareRefund.rawValue).toBe(Math.round(5350 * im)); // 8510
    expect(rareRefund.netKakera).toBe(Math.floor(8510 * 0.95)); // 8084
  });

  it('deve conceder reembolso de 4 cotas (Divórcio Dourado) EXCLUSIVAMENTE para Soulmates sem multiplicar base por rank', () => {
    // COMMON Soulmate (10 keys)
    const commonSoulmate = calculateDivorceRefund('COMMON', 10, { isSoulmate: true });
    expect(commonSoulmate.baseValue).toBe(1050000); // 4 cotas base (50 dias x 21k)
    expect(commonSoulmate.keysBonus).toBe(10 * 500); // 5000
    expect(commonSoulmate.rawValue).toBe(1050000 + 50 + 5000); // 1055050
    expect(commonSoulmate.netKakera).toBe(Math.floor(1055050 * 0.95)); // 1002297
    expect(commonSoulmate.isSoulmate).toBe(true);

    // RARE Soulmate (10 keys)
    const rareSoulmate = calculateDivorceRefund('RARE', 10, { isSoulmate: true });
    expect(rareSoulmate.baseValue).toBe(1680000); // 4 cotas base (80 dias x 21k)
    expect(rareSoulmate.keysBonus).toBe(10 * 5000); // 50000
    expect(rareSoulmate.rawValue).toBe(1680000 + 350 + 50000); // 1730350
    expect(rareSoulmate.netKakera).toBe(Math.floor(1730350 * 0.95)); // 1643832

    // RARE Soulmate (10 keys) com inflação 1.5906
    const rareSoulmateInflated = calculateDivorceRefund('RARE', 10, { isSoulmate: true, inflationMultiplier: 1.5906 });
    expect(rareSoulmateInflated.rawBeforeInflation).toBe(1730350);
    expect(rareSoulmateInflated.rawValue).toBe(Math.round(1730350 * 1.5906)); // 2752295
    expect(rareSoulmateInflated.netKakera).toBe(Math.floor(2752295 * 0.95)); // 2614680
  });

  it('deve suportar chamada legada com boolean isSoulmate', () => {
    const res = calculateDivorceRefund('RARE', 1, false);
    expect(res.baseValue).toBe(350);
    expect(res.netKakera).toBe(5082);

    const resSm = calculateDivorceRefund('RARE', 10, true);
    expect(resSm.baseValue).toBe(1680000);
    expect(resSm.netKakera).toBe(1643832);
  });

  it('deve aplicar payoutMultiplier apenas quando informado (sem afetar cotas)', () => {
    const base = calculateDivorceRefund('LEGENDARY', 1, { inflationMultiplier: 1.2 });
    const boosted = calculateDivorceRefund('LEGENDARY', 1, {
      inflationMultiplier: 1.2,
      payoutMultiplier: 1.65,
    });
    expect(boosted.rawValue).toBe(Math.round(76500 * 1.2 * 1.65));
    expect(boosted.netKakera).toBeGreaterThan(base.netKakera);
  });
});
