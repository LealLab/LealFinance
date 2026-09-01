import {
  addDays,
  addMonthsClamped,
  formatIsoDate,
  monthKey,
  monthStartUtc,
  parseIsoDate,
  todayIso
} from './dates';

describe('parseIsoDate / formatIsoDate', () => {
  it('round-trips an ISO date through UTC without shifting a day', () => {
    expect(formatIsoDate(parseIsoDate('2026-03-15'))).toBe('2026-03-15');
  });
});

describe('monthKey', () => {
  it('extracts the YYYY-MM prefix', () => {
    expect(monthKey('2026-03-15')).toBe('2026-03');
  });
});

describe('todayIso', () => {
  it("uses the local calendar day, not UTC's", () => {
    // Constructed in local time - late evening on the 31st. `formatIsoDate`
    // would roll this to the 1st (next month) for any zone behind UTC;
    // `todayIso` must stay on the 31st everywhere.
    const localLateEvening = new Date(2026, 0, 31, 22, 0, 0);
    expect(todayIso(localLateEvening)).toBe('2026-01-31');
  });

  it('zero-pads month and day', () => {
    expect(todayIso(new Date(2026, 2, 5, 9, 0, 0))).toBe('2026-03-05');
  });
});

describe('monthStartUtc', () => {
  it('is the first of the local current month, UTC-anchored', () => {
    expect(formatIsoDate(monthStartUtc(new Date(2026, 0, 15, 23, 30)))).toBe('2026-01-01');
  });
});

describe('addDays', () => {
  it('adds days across a month boundary', () => {
    expect(formatIsoDate(addDays(parseIsoDate('2026-01-30'), 3))).toBe('2026-02-02');
  });
});

describe('addMonthsClamped', () => {
  it('adds whole months when the day fits in the target month', () => {
    expect(formatIsoDate(addMonthsClamped(parseIsoDate('2026-01-15'), 1))).toBe('2026-02-15');
  });

  it('clamps to the last day of a shorter target month', () => {
    expect(formatIsoDate(addMonthsClamped(parseIsoDate('2026-01-31'), 1))).toBe('2026-02-28');
  });

  it('re-anchors to day 31 once the target month has 31 days again', () => {
    // Jan 31 -> Feb (clamped to 28) -> Mar must land back on 31, not 28+1.
    expect(formatIsoDate(addMonthsClamped(parseIsoDate('2026-01-31'), 2))).toBe('2026-03-31');
  });

  it('clamps Feb 29 to Feb 28 a year later in a non-leap year', () => {
    expect(formatIsoDate(addMonthsClamped(parseIsoDate('2024-02-29'), 12))).toBe('2025-02-28');
  });

  it('rolls over the year when adding past December', () => {
    expect(formatIsoDate(addMonthsClamped(parseIsoDate('2026-11-15'), 3))).toBe('2027-02-15');
  });
});
