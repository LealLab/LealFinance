import { money } from './money';
import { convertByRate, effectiveRate, invertRate } from './rate';

describe('rate', () => {
  describe('convertByRate', () => {
    it('converts an amount by a decimal rate and relabels the currency', () => {
      expect(convertByRate(money('100', 'USD'), '5.2', 'BRL')).toEqual(money('520', 'BRL'));
    });

    it('keeps rate precision beyond money scale 4 (rate parsed at scale 10)', () => {
      // 100 * 0.1923076923 = 19.23076923, rounds to 19.2308 at scale 4.
      expect(convertByRate(money('100', 'USD'), '0.1923076923', 'BRL').amount).toBe('19.2308');
    });

    it('rounds the rescaled result half away from zero', () => {
      // 0.0001 * 0.00005 -> exact product rounds up to the next scale-4 unit.
      expect(convertByRate(money('0.0001', 'USD'), '0.5', 'BRL').amount).toBe('0.0001');
      expect(convertByRate(money('0.0001', 'USD'), '0.4', 'BRL').amount).toBe('0.0000');
    });
  });

  describe('invertRate', () => {
    it('inverts to 10 decimal places', () => {
      expect(invertRate('5.2')).toBe('0.1923076923');
    });

    it('round-trips a conversion within the precision of the inverted rate', () => {
      const rate = '5.2';
      const usd = money('100', 'USD');
      const brl = convertByRate(usd, rate, 'BRL');
      const backToUsd = convertByRate(brl, invertRate(rate), 'USD');
      expect(backToUsd).toEqual(usd);
    });

    it('throws when inverting a zero rate', () => {
      expect(() => invertRate('0')).toThrow();
    });
  });

  describe('effectiveRate', () => {
    it('derives the rate two amounts imply', () => {
      expect(effectiveRate(money('100', 'USD'), money('520', 'BRL'))).toBe('5.2000000000');
    });

    it('throws when the origin amount is zero', () => {
      expect(() => effectiveRate(money('0', 'USD'), money('520', 'BRL'))).toThrow();
    });
  });
});
