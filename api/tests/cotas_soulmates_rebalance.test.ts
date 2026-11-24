import { describe, it, expect } from 'vitest';
import {
  parseRarityDays,
  parseMarriedProgressionWeights,
  cotaRarityDays,
  marriedProgressionWeights,
  config,
} from '../src/config.js';
import {
  BASE_DAILY_ZINTHOS,
  RARITY_DAYS,
} from '../src/services/MarketInvestmentService.js';
import {
  SOULMATE_DIVORCE_VALUES,
  SOULMATE_RANKING_SCORES,
  MARRIED_KEY_PROGRESSION_WEIGHTS,
  calculateCharacterSharePricing,
} from '../src/utils/rarityCalculator.js';

describe('💎 Cotas, Escalonamento de Preços e Rebalanceamento de Soulmates', () => {
  it('deve ter cotas de Comum, Incomum e Raro mais próximas de Épico em escala ascendente', () => {
    expect(RARITY_DAYS.COMMON).toBe(50);
    expect(RARITY_DAYS.UNCOMMON).toBe(65);
    expect(RARITY_DAYS.RARE).toBe(80);
    expect(RARITY_DAYS.EPIC).toBe(100);
    expect(RARITY_DAYS.LEGENDARY).toBe(210);

    // Escala estritamente crescente
    expect(RARITY_DAYS.COMMON).toBeLessThan(RARITY_DAYS.UNCOMMON);
    expect(RARITY_DAYS.UNCOMMON).toBeLessThan(RARITY_DAYS.RARE);
    expect(RARITY_DAYS.RARE).toBeLessThan(RARITY_DAYS.EPIC);
    expect(RARITY_DAYS.EPIC).toBeLessThan(RARITY_DAYS.LEGENDARY);

    // Valores base das 4 cotas por raridade
    expect(RARITY_DAYS.COMMON * BASE_DAILY_ZINTHOS).toBe(1050000);
    expect(RARITY_DAYS.UNCOMMON * BASE_DAILY_ZINTHOS).toBe(1365000);
    expect(RARITY_DAYS.RARE * BASE_DAILY_ZINTHOS).toBe(1680000);
    expect(RARITY_DAYS.EPIC * BASE_DAILY_ZINTHOS).toBe(2100000);
    expect(RARITY_DAYS.LEGENDARY * BASE_DAILY_ZINTHOS).toBe(4410000);
  });

  it('deve aumentar o valor da última cota para Soulmate para 5x o valor anterior (peso 1.00)', () => {
    // Última cota (chave 9 -> 10 / Soulmate)
    expect(MARRIED_KEY_PROGRESSION_WEIGHTS[8]).toBe(1.00); // 0.20 * 5 = 1.00

    // Todos os pesos escalonados proporcionalmente
    expect(MARRIED_KEY_PROGRESSION_WEIGHTS).toEqual([
      0.35, 0.40, 0.50, 0.55, 0.65, 0.75, 0.85, 0.95, 1.00,
    ]);

    // Soma total dos pesos = 6.00
    const totalWeights = MARRIED_KEY_PROGRESSION_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(Number(totalWeights.toFixed(2))).toBe(6.00);
  });

  it('deve calcular corretamente a cotação da última cota como 100% da referência (0% de desconto)', () => {
    const pricing = calculateCharacterSharePricing({
      baseRarity: 'EPIC',
      baseDynamicPrice: 3000000,
      isOwner: true,
      currentKeys: 9, // Chave 9 -> 10 (último nível antes de virar Soulmate)
    });

    expect(pricing.keyProgressionWeight).toBe(1.00);
    expect(pricing.discountPercent).toBe(0);
    expect(pricing.dynamicPrice).toBe(3000000);
    expect(pricing.cotaPrice).toBe(Math.ceil(3000000 / 4)); // 750.000 Zinthos
  });

  it('deve calcular desconto decrescente para as chaves anteriores', () => {
    // Chave 1 -> 2 (peso 0.35, 65% OFF)
    const pricingKey1 = calculateCharacterSharePricing({
      baseRarity: 'EPIC',
      baseDynamicPrice: 2100000,
      isOwner: true,
      currentKeys: 1,
    });
    expect(pricingKey1.keyProgressionWeight).toBe(0.35);
    expect(pricingKey1.discountPercent).toBe(65);

    // Chave 5 -> 6 (peso 0.65, 35% OFF)
    const pricingKey5 = calculateCharacterSharePricing({
      baseRarity: 'EPIC',
      baseDynamicPrice: 2100000,
      isOwner: true,
      currentKeys: 5,
    });
    expect(pricingKey5.keyProgressionWeight).toBe(0.65);
    expect(pricingKey5.discountPercent).toBe(35);
  });

  it('deve permitir parametrização via funções de parsing de ambiente (.env)', () => {
    // Custom CSV de dias de raridade
    const customDays = parseRarityDays('40,55,75,95,200', {
      COMMON: 50,
      UNCOMMON: 65,
      RARE: 80,
      EPIC: 100,
      LEGENDARY: 210,
    });
    expect(customDays.COMMON).toBe(40);
    expect(customDays.UNCOMMON).toBe(55);
    expect(customDays.RARE).toBe(75);
    expect(customDays.EPIC).toBe(95);
    expect(customDays.LEGENDARY).toBe(200);

    // Custom CSV de pesos de progressão
    const customWeights = parseMarriedProgressionWeights(
      '0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90,1.00'
    );
    expect(customWeights).toHaveLength(9);
    expect(customWeights[0]).toBe(0.20);
    expect(customWeights[8]).toBe(1.00);

    // Fallbacks para entradas inválidas
    const fallbackDays = parseRarityDays('invalido', {
      COMMON: 50,
      UNCOMMON: 65,
      RARE: 80,
      EPIC: 100,
      LEGENDARY: 210,
    });
    expect(fallbackDays.COMMON).toBe(50);

    const fallbackWeights = parseMarriedProgressionWeights('curto,demais');
    expect(fallbackWeights[8]).toBe(1.00);
  });

  it('deve ter SOULMATE_RANKING_SCORE configurado como 2100 (redução de 30% em relação a 3000)', () => {
    expect(config.SOULMATE_RANKING_SCORE).toBe(2100);
    expect(3000 * 0.70).toBe(2100);
  });

  it('deve ter SOULMATE_RANKING_SCORES escalonados por raridade', () => {
    expect(SOULMATE_RANKING_SCORES.LEGENDARY).toBe(2200);
    expect(SOULMATE_RANKING_SCORES.EPIC).toBe(1300);
    expect(SOULMATE_RANKING_SCORES.RARE).toBe(800);
    expect(SOULMATE_RANKING_SCORES.UNCOMMON).toBe(500);
    expect(SOULMATE_RANKING_SCORES.COMMON).toBe(200);
  });
});
