import { RecurringRule } from '../models/recurring';
import { projectOccurrences } from './recurrence';

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-01-15',
    template: {
      type: 'expense',
      amount: '100',
      currency: 'BRL',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      description: 'Assinatura'
    },
    ...overrides
  };
}

describe('projectOccurrences', () => {
  it('expands monthly occurrences within the given range', () => {
    const occurrences = projectOccurrences(rule(), '2026-01-01', '2026-04-30');

    expect(occurrences.map((o) => o.date)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15'
    ]);
  });

  it('marks every occurrence as a projection tied to the rule', () => {
    const [occurrence] = projectOccurrences(rule(), '2026-01-01', '2026-01-31');

    expect(occurrence.isProjected).toBe(true);
    expect(occurrence.recurringRuleId).toBe('rule-1');
    expect(occurrence.amount).toBe('100');
    expect(occurrence).not.toHaveProperty('id');
  });

  it('expands weekly occurrences by 7 × interval days', () => {
    const occurrences = projectOccurrences(
      rule({ frequency: 'weekly', interval: 2, startDate: '2026-01-01' }),
      '2026-01-01',
      '2026-02-01'
    );

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
  });

  it('expands yearly occurrences', () => {
    const occurrences = projectOccurrences(
      rule({ frequency: 'yearly', startDate: '2026-06-01' }),
      '2026-01-01',
      '2029-01-01'
    );

    expect(occurrences.map((o) => o.date)).toEqual(['2026-06-01', '2027-06-01', '2028-06-01']);
  });

  it('respects interval > 1 for monthly rules', () => {
    const occurrences = projectOccurrences(
      rule({ interval: 3 }),
      '2026-01-01',
      '2026-12-31'
    );

    expect(occurrences.map((o) => o.date)).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15'
    ]);
  });

  it('stops at the rule end date even if the query range extends further', () => {
    const occurrences = projectOccurrences(
      rule({ endDate: '2026-03-01' }),
      '2026-01-01',
      '2026-12-31'
    );

    expect(occurrences.map((o) => o.date)).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('clamps month-end anchors correctly across a run (Jan 31 -> Feb 28 -> Mar 31)', () => {
    const occurrences = projectOccurrences(
      rule({ startDate: '2026-01-31' }),
      '2026-01-01',
      '2026-04-30'
    );

    expect(occurrences.map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ]);
  });

  it('returns nothing when the range is entirely before the rule starts', () => {
    expect(projectOccurrences(rule(), '2025-01-01', '2025-12-31')).toEqual([]);
  });
});
