import {
  add,
  compare,
  isNegative,
  isZero,
  money,
  multiply,
  negate,
  ratio,
  subtract,
  sum,
  toNumber,
  zero
} from './money';

describe('money', () => {
  describe('money() canonicalization', () => {
    it('pads to 4 decimal places', () => {
      expect(money('10', 'BRL').amount).toBe('10.0000');
      expect(money('10.5', 'BRL').amount).toBe('10.5000');
    });

    it('rounds half away from zero beyond scale 4', () => {
      expect(money('1.00005', 'BRL').amount).toBe('1.0001');
      expect(money('1.00004', 'BRL').amount).toBe('1.0000');
      expect(money('-1.00005', 'BRL').amount).toBe('-1.0001');
    });

    it('never produces a "-0.0000"', () => {
      expect(money('-0.00001', 'BRL').amount).toBe('0.0000');
    });

    it('throws on a malformed amount', () => {
      expect(() => money('abc', 'BRL')).toThrow();
      expect(() => money('1.2.3', 'BRL')).toThrow();
    });
  });

  describe('add / subtract / negate', () => {
    it('adds exactly, without float drift', () => {
      // 0.1 + 0.2 !== 0.3 in float64 - this must not leak through.
      expect(add(money('0.1', 'BRL'), money('0.2', 'BRL'))).toEqual(money('0.3', 'BRL'));
    });

    it('subtracts, allowing negative results', () => {
      expect(subtract(money('5', 'BRL'), money('7.5', 'BRL'))).toEqual(money('-2.5', 'BRL'));
    });

    it('negates', () => {
      expect(negate(money('5', 'BRL'))).toEqual(money('-5', 'BRL'));
      expect(negate(money('-5', 'BRL'))).toEqual(money('5', 'BRL'));
    });

    it('throws on a currency mismatch', () => {
      expect(() => add(money('10', 'BRL'), money('10', 'USD'))).toThrow();
      expect(() => subtract(money('10', 'BRL'), money('10', 'USD'))).toThrow();
    });
  });

  describe('sum', () => {
    it('sums an empty list to zero in the given currency', () => {
      expect(sum([], 'BRL')).toEqual(zero('BRL'));
    });

    it('sums same-currency amounts exactly', () => {
      const amounts = [money('10.10', 'BRL'), money('0.20', 'BRL'), money('-5', 'BRL')];
      expect(sum(amounts, 'BRL')).toEqual(money('5.30', 'BRL'));
    });

    it('throws if any amount has a different currency', () => {
      expect(() => sum([money('10', 'BRL'), money('1', 'USD')], 'BRL')).toThrow();
    });
  });

  describe('compare / isZero / isNegative', () => {
    it('compares magnitudes', () => {
      expect(compare(money('5', 'BRL'), money('5', 'BRL'))).toBe(0);
      expect(compare(money('5', 'BRL'), money('4.99', 'BRL'))).toBe(1);
      expect(compare(money('4.99', 'BRL'), money('5', 'BRL'))).toBe(-1);
    });

    it('detects zero regardless of trailing precision', () => {
      expect(isZero(money('0', 'BRL'))).toBe(true);
      expect(isZero(money('0.0000', 'BRL'))).toBe(true);
      expect(isZero(money('0.0001', 'BRL'))).toBe(false);
    });

    it('detects sign', () => {
      expect(isNegative(money('-0.01', 'BRL'))).toBe(true);
      expect(isNegative(money('0', 'BRL'))).toBe(false);
      expect(isNegative(money('0.01', 'BRL'))).toBe(false);
    });
  });

  describe('multiply (exchange-rate conversion)', () => {
    it('converts by a decimal factor and relabels the currency', () => {
      expect(multiply(money('100', 'USD'), '5.20', 'BRL')).toEqual(money('520', 'BRL'));
    });

    it('rounds the rescaled product half away from zero', () => {
      // 0.7071 × 0.7071 = 0.49999041 exactly - rounds up to 0.5000 at scale 4.
      expect(multiply(money('0.7071', 'USD'), '0.7071', 'BRL').amount).toBe('0.5000');
    });
  });

  describe('ratio', () => {
    it('divides two same-currency amounts into a plain number', () => {
      expect(ratio(money('50', 'BRL'), money('200', 'BRL'))).toBeCloseTo(0.25);
    });

    it('throws on a currency mismatch', () => {
      expect(() => ratio(money('50', 'BRL'), money('200', 'USD'))).toThrow();
    });
  });

  describe('toNumber', () => {
    it('converts to a JS number for display/chart use', () => {
      expect(toNumber(money('1234.5', 'BRL'))).toBe(1234.5);
    });
  });
});
