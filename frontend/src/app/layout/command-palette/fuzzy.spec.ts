import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches an exact match', () => {
    expect(fuzzyScore('categorias', 'Categorias')).toBeGreaterThan(-1);
  });

  it('scores a prefix match higher than the same substring appearing later', () => {
    const prefix = fuzzyScore('cat', 'Categorias');
    const later = fuzzyScore('cat', 'Orçamento Cat X');

    expect(prefix).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(-1);
  });

  it('matches regardless of diacritics, in both directions', () => {
    expect(fuzzyScore('alimentacao', 'Alimentação')).toBeGreaterThan(-1);
    expect(fuzzyScore('alimentação', 'Alimentacao')).toBeGreaterThan(-1);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('CATEGORIAS', 'categorias')).toBeGreaterThan(-1);
    expect(fuzzyScore('categorias', 'CATEGORIAS')).toBeGreaterThan(-1);
  });

  it('returns -1 when the query is not a subsequence of the text', () => {
    expect(fuzzyScore('xyz', 'Categorias')).toBe(-1);
  });

  it('returns 0 for an empty (or whitespace-only) query, matching everything', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('returns -1 for a non-empty query against empty text', () => {
    expect(fuzzyScore('abc', '')).toBe(-1);
  });

  it('scores a contiguous subsequence run higher than a scattered one of the same length', () => {
    const contiguous = fuzzyScore('nova', 'Nova conta');
    const scattered = fuzzyScore('nvca', 'Nova conta');

    expect(contiguous).toBeGreaterThan(-1);
    expect(scattered).toBeGreaterThan(-1);
    expect(contiguous).toBeGreaterThan(scattered);
  });
});
