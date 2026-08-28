import {
  mapAccount,
  mapAccountBalance,
  mapAccountPatch,
  mapBudget,
  mapBudgetAllocation,
  mapBudgetAllocationInput,
  mapBudgetInput,
  mapCategory,
  mapCategoryCreate,
  mapCategoryGroup,
  mapCategoryGroupCreate,
  mapCategoryGroupPatch,
  mapCategoryPatch,
  mapExchangeRate,
  mapImportPreview,
  mapImportPreviewRequest,
  mapRecurringRule,
  mapTransactionPatch,
} from './mappers';

describe('HTTP wire mappers', () => {
  it('maps category groups and categories between wire and domain shapes', () => {
    expect(
      mapCategoryGroup({
        id: 'g',
        name: 'Housing',
        kind: 'expense',
        color: '#000000',
        icon: 'home',
        position: 2,
      }),
    ).toEqual({
      id: 'g',
      name: 'Housing',
      kind: 'expense',
      color: '#000000',
      icon: 'home',
      position: 2,
    });
    expect(
      mapCategoryGroupCreate({ name: 'Housing', kind: 'expense', color: '#000000', icon: 'home' }),
    ).toEqual({ name: 'Housing', kind: 'expense', color: '#000000', icon: 'home' });
    expect(mapCategoryGroupPatch({ name: 'Renamed', position: undefined })).toEqual({
      name: 'Renamed',
      position: null,
    });
    expect(
      mapCategory({
        id: 'c',
        name: 'Rent',
        kind: 'expense',
        group_id: 'g',
        color: '#000000',
        icon: 'home',
        position: 0,
      }),
    ).toEqual({
      id: 'c',
      name: 'Rent',
      kind: 'expense',
      groupId: 'g',
      color: '#000000',
      icon: 'home',
      position: 0,
    });
    expect(
      mapCategoryCreate({
        name: 'Rent',
        kind: 'expense',
        groupId: 'g',
        color: '#000000',
        icon: 'home',
      }),
    ).toEqual({
      name: 'Rent',
      kind: 'expense',
      group_id: 'g',
      color: '#000000',
      icon: 'home',
    });
    expect(mapCategoryPatch({ groupId: undefined })).toEqual({ group_id: null });
  });

  it('maps group-keyed budgets and allocations', () => {
    expect(
      mapBudget({ id: 'b', group_id: 'g', month: '2026-08', amount: '100.00', currency: 'BRL' }),
    ).toEqual({ id: 'b', groupId: 'g', month: '2026-08', amount: '100.00', currency: 'BRL' });
    expect(
      mapBudgetInput({ groupId: 'g', month: '2026-08', amount: '100.00', currency: 'BRL' }),
    ).toEqual({ group_id: 'g', month: '2026-08', amount: '100.00', currency: 'BRL' });
    expect(mapBudgetAllocation({ id: 'a', group_id: 'g', percentage: '20' })).toEqual({
      id: 'a',
      groupId: 'g',
      percentage: '20',
    });
    expect(mapBudgetAllocationInput({ groupId: 'g', percentage: '20' })).toEqual({
      group_id: 'g',
      percentage: '20',
    });
  });

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

  it('maps an import preview request to snake_case, defaulting an absent mapping to null', () => {
    expect(
      mapImportPreviewRequest({
        content: 'date,amount\n2026-01-01,-5\n',
        accountId: 'a',
        options: { dateFormat: 'dmy', decimalSeparator: ',', invertSign: true },
      }),
    ).toEqual({
      content: 'date,amount\n2026-01-01,-5\n',
      account_id: 'a',
      mapping: null,
      options: { date_format: 'dmy', decimal_separator: ',', invert_sign: true },
    });
  });

  it('maps an import preview response, turning nulls into undefined per row', () => {
    expect(
      mapImportPreview({
        headers: ['Data', 'Descrição', 'Valor'],
        mapping: { date: 'Data', description: null, amount: 'Valor', category: null, notes: null },
        rows: [
          {
            index: 0,
            date: '2026-01-15',
            description: 'Coffee',
            type: 'expense',
            amount: '5.00',
            category_id: 'c1',
            category_name: 'Groceries',
            rule_name: null,
            notes: null,
            error: null,
            duplicate: false,
          },
          {
            index: 1,
            date: null,
            description: '',
            type: null,
            amount: null,
            category_id: null,
            category_name: null,
            rule_name: null,
            notes: null,
            error: 'import.row.invalid_date',
            duplicate: false,
          },
        ],
      }),
    ).toEqual({
      headers: ['Data', 'Descrição', 'Valor'],
      mapping: { date: 'Data', description: null, amount: 'Valor', category: null, notes: null },
      rows: [
        {
          index: 0,
          date: '2026-01-15',
          description: 'Coffee',
          type: 'expense',
          amount: '5.00',
          categoryId: 'c1',
          categoryName: 'Groceries',
          ruleName: undefined,
          notes: undefined,
          error: undefined,
          duplicate: false,
        },
        {
          index: 1,
          date: undefined,
          description: '',
          type: undefined,
          amount: undefined,
          categoryId: undefined,
          categoryName: undefined,
          ruleName: undefined,
          notes: undefined,
          error: 'import.row.invalid_date',
          duplicate: false,
        },
      ],
    });
  });
});
