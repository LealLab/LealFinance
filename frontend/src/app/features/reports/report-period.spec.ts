import { resolveMonthBuckets } from './report-period';

describe('resolveMonthBuckets', () => {
  it('returns exactly one bucket for "month"', () => {
    expect(resolveMonthBuckets('month')).toHaveLength(1);
  });

  it('returns the requested trailing count for 3m/6m/12m, ending at the current month', () => {
    const now = new Date();
    const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    expect(resolveMonthBuckets('3m')).toHaveLength(3);
    expect(resolveMonthBuckets('6m')).toHaveLength(6);
    const twelve = resolveMonthBuckets('12m');
    expect(twelve).toHaveLength(12);
    expect(twelve.at(-1)?.key).toBe(currentKey);
  });

  it('produces buckets in chronological order with no gaps', () => {
    const buckets = resolveMonthBuckets('6m');
    for (let i = 1; i < buckets.length; i++) {
      const prevMonth = new Date(buckets[i - 1].start);
      prevMonth.setUTCMonth(prevMonth.getUTCMonth() + 1);
      expect(buckets[i].start.getTime()).toBe(prevMonth.getTime());
    }
  });

  it('builds an inclusive range for a valid custom period', () => {
    const buckets = resolveMonthBuckets('custom', '2026-01', '2026-04');
    expect(buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('falls back to the current month when the custom range is missing or inverted', () => {
    expect(resolveMonthBuckets('custom')).toHaveLength(1);
    expect(resolveMonthBuckets('custom', '2026-05', '2026-01')).toHaveLength(1);
  });

  it('formats month labels using the requested locale', () => {
    expect(resolveMonthBuckets('custom', '2026-01', '2026-01', 'en-US')[0].label).toBe('Jan/26');
    expect(resolveMonthBuckets('custom', '2026-01', '2026-01', 'pt-BR')[0].label).toBe('jan/26');
  });
});
