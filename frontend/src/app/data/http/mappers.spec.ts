import {
  mapAccount,
  mapAccountBalance,
  mapAccountPatch,
  mapExchangeRate,
  mapRecurringRule,
  mapTransactionPatch,
} from './mappers';

describe('HTTP wire mappers', () => {
  it('maps nullable fields to undefined without changing decimal strings', () => {
    expect(
      mapAccount({
        id: 'a',
        name: 'Cash',
        type: 'cash',
        currency: 'BRL',
        opening_balance: '100.0000',
        institution_id: null,
        archived: false,
        credit_limit: null,
        closing_day: null,
        due_day: null,
      }),
    ).toEqual({
      id: 'a',
      name: 'Cash',
      type: 'cash',
      currency: 'BRL',
      openingBalance: '100.0000',
      institutionId: undefined,
      archived: false,
      creditLimit: undefined,
      closingDay: undefined,
      dueDay: undefined,
    });
  });

  it('distinguishes omitted PATCH fields from explicitly cleared fields', () => {
    expect(mapAccountPatch({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(mapAccountPatch({ name: undefined })).toEqual({ name: null });
    expect(mapAccountPatch({ institutionId: undefined, creditLimit: undefined })).toEqual({
      institution_id: null,
      credit_limit: null,
    });
    expect(mapTransactionPatch({ notes: undefined, conversion: undefined })).toEqual({
      notes: null,
      conversion: null,
    });
  });

  it('maps nested recurring templates and preserves dates and decimal strings', () => {
    const result = mapRecurringRule({
      id: 'r',
      frequency: 'monthly',
      interval: 2,
      start_date: '2026-01-31',
      end_date: null,
      last_posted_date: null,
      template: {
        type: 'expense',
        amount: '10.2300',
        currency: 'BRL',
        account_id: 'a',
        to_account_id: null,
        category_id: 'c',
        description: 'Fee',
        notes: null,
        conversion: { amount: '2.00', currency: 'USD', fee: null, rate: '0.1955', source: 'quote' },
      },
    });
    expect(result.startDate).toBe('2026-01-31');
    expect(result.endDate).toBeUndefined();
    expect(result.lastPostedDate).toBeUndefined();
    expect(result.template.conversion?.rate).toBe('0.1955');
    expect(result.template.conversion?.fee).toBeUndefined();
  });

  it('normalizes exchange-rate provenance and effective date', () => {
    expect(
      mapExchangeRate({
        base_code: 'USD',
        quote_code: 'BRL',
        rate: '5.2',
        is_fallback: false,
        source: 'cache',
        as_of: '2026-08-13',
      }),
    ).toEqual({
      baseCode: 'USD',
      quoteCode: 'BRL',
      rate: '5.2',
      isFallback: false,
      source: 'quote',
      asOf: '2026-08-13',
    });
    expect(
      mapExchangeRate({
        base_code: 'USD',
        quote_code: 'EUR',
        rate: '1',
        is_fallback: true,
        source: 'fallback_1to1',
        as_of: '2026-08-13',
      }).source,
    ).toBe('fallback');
  });

  it('maps an account balance wire row', () => {
    expect(mapAccountBalance({ account_id: 'a', currency: 'BRL', balance: '300.0000' })).toEqual({
      accountId: 'a',
      currency: 'BRL',
      balance: '300.0000',
    });
  });
});
