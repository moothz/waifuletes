import { describe, it, expect } from 'vitest';
import { calculateInactiveMultiplier } from '../src/services/HostingFeeService.js';
import { parseHostingRates } from '../src/config.js';

describe('HostingFeeService Unit & Logic Tests', () => {
  it('deve parsear corretamente as taxas ativas e inativas do formato CSV', () => {
    const active = parseHostingRates('1,3,8,15,40', {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
    });
    expect(active).toEqual({
      COMMON: 1,
      UNCOMMON: 3,
      RARE: 8,
      EPIC: 15,
      LEGENDARY: 40,
    });

    const inactive = parseHostingRates('20,120,400,700,2000', {
      COMMON: 0,
      UNCOMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
    });
    expect(inactive).toEqual({
      COMMON: 20,
      UNCOMMON: 120,
      RARE: 400,
      EPIC: 700,
      LEGENDARY: 2000,
    });
  });

  it('deve retornar defaultRates caso a string CSV seja inválida ou incompleta', () => {
    const fallback = {
      COMMON: 1,
      UNCOMMON: 2,
      RARE: 3,
      EPIC: 4,
      LEGENDARY: 5,
    };
    const parsed = parseHostingRates('invalido,10', fallback);
    expect(parsed).toEqual(fallback);
  });

  it('deve calcular corretamente o multiplicador progressivo de inatividade', () => {
    const graceMs = 72 * 3600 * 1000;
    const dayMs = 24 * 3600 * 1000;

    // Dentro da carência: sem multiplicador adicional
    expect(calculateInactiveMultiplier(graceMs, graceMs, 10, 5)).toBe(1.0);
    expect(calculateInactiveMultiplier(graceMs - 1000, graceMs, 10, 5)).toBe(1.0);

    // 1 dia extra offline (+24h além das 72h) -> 1.10
    expect(calculateInactiveMultiplier(graceMs + dayMs, graceMs, 10, 5)).toBe(1.1);

    // 2 dias extras (+48h além das 72h) -> 1.20
    expect(calculateInactiveMultiplier(graceMs + 2 * dayMs, graceMs, 10, 5)).toBe(1.2);

    // 5 dias extras -> 1.50
    expect(calculateInactiveMultiplier(graceMs + 5 * dayMs, graceMs, 10, 5)).toBe(1.5);

    // 10 dias extras -> 2.00 (taxa dobra)
    expect(calculateInactiveMultiplier(graceMs + 10 * dayMs, graceMs, 10, 5)).toBe(2.0);

    // Acima do teto máximo (ex.: 50 dias offline) respeita o maxMultiplier
    expect(calculateInactiveMultiplier(graceMs + 50 * dayMs, graceMs, 10, 5)).toBe(5.0);
  });
});
