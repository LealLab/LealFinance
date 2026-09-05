import {
  mapAccount,
  mapAccountBalance,
  mapAccountPatch,
  mapCardInvoice,
  mapCardInvoicePayment,
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
  mapConnectToken,
  mapPluggyAccount,
  mapPluggyCredentialStatus,
  mapPluggyItem,
  mapPluggySyncResult,
  mapRecurringRule,
  mapTransaction,
  mapTransactionCreate,
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
        payment_account_id: null,
        auto_pay: false,
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
      paymentAccountId: undefined,
      autoPay: false,
    });
  });

  it('carries installment fields in and out and only sends installments when splitting', () => {
    const wire = {
      id: 't',
      type: 'expense' as const,
      date: '2026-01-31',
      amount: '33.3334',
      currency: 'BRL',
      account_id: 'card',
      to_account_id: null,
      category_id: 'c',
      description: 'Sofa',
      notes: null,
      recurring_rule_id: null,
      loan_id: null,
      card_invoice_close_date: null,
      installment_group_id: 'grp',
      installment_number: 1,
      installment_count: 3,
      conversion: null,
    };
    expect(mapTransaction(wire)).toMatchObject({
      installmentGroupId: 'grp',
      installmentNumber: 1,
      installmentCount: 3,
    });

    const base = {
      type: 'expense' as const,
      date: '2026-01-31',
      amount: '100.00',
      currency: 'BRL',
      accountId: 'card',
      categoryId: 'c',
      description: 'Sofa',
    };
    expect('installments' in mapTransactionCreate(base)).toBe(false);
    expect(mapTransactionCreate({ ...base, installments: 3 })).toMatchObject({ installments: 3 });
  });

  it('maps a card invoice and drops nulls from a payment body', () => {
    expect(
      mapCardInvoice({
        close_date: '2026-01-20',
        due_date: '2026-01-27',
        period_start: '2025-12-21',
        period_end: '2026-01-20',
        currency: 'BRL',
        total: '120.0000',
        paid: '20.0000',
        remaining: '100.0000',
        status: 'closed',
      }),
    ).toEqual({
      closeDate: '2026-01-20',
      dueDate: '2026-01-27',
      periodStart: '2025-12-21',
      periodEnd: '2026-01-20',
      currency: 'BRL',
      total: '120.0000',
      paid: '20.0000',
      remaining: '100.0000',
      status: 'closed',
    });
    expect(mapCardInvoicePayment({ amount: '50.00' })).toEqual({
      account_id: null,
      date: null,
      amount: '50.00',
      description: null,
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

  it('maps Pluggy responses, including JSON-string money fields to numbers', () => {
    expect(mapPluggyCredentialStatus({ configured: true, environment: 'production' })).toEqual({
      configured: true,
      environment: 'production',
    });
    expect(mapConnectToken({ access_token: 'token' })).toEqual({ accessToken: 'token' });
    expect(
      mapPluggyItem({
        id: 'item',
        external_id: 'external-item',
        connector_id: 42,
        connector_name: 'Banco Aurora',
        connector_image_url: null,
        status: 'UPDATED',
        execution_status: null,
        status_detail: null,
        institution_id: null,
        last_synced_at: null,
        last_sync_error: null,
        consent_expires_at: null,
      }),
    ).toEqual({
      id: 'item',
      externalId: 'external-item',
      connectorId: 42,
      connectorName: 'Banco Aurora',
      connectorImageUrl: undefined,
      status: 'UPDATED',
      executionStatus: undefined,
      statusDetail: undefined,
      institutionId: undefined,
      lastSyncedAt: undefined,
      lastSyncError: undefined,
      consentExpiresAt: undefined,
    });
    expect(
      mapPluggyAccount({
        id: 'account',
        pluggy_item_id: 'item',
        account_id: null,
        external_id: 'external-account',
        type: 'BANK',
        subtype: 'CHECKING',
        name: 'Conta corrente',
        number: null,
        currency: 'BRL',
        synced_balance: '1234.5000',
        credit_limit: '5000.0000',
        available_credit_limit: null,
        raw: { balance: '1234.5000' },
        last_transaction_date: '2026-09-04',
        sync_enabled: true,
      }),
    ).toEqual({
      id: 'account',
      pluggyItemId: 'item',
      accountId: undefined,
      externalId: 'external-account',
      type: 'BANK',
      subtype: 'CHECKING',
      name: 'Conta corrente',
      number: undefined,
      currency: 'BRL',
      syncedBalance: 1234.5,
      creditLimit: 5000,
      availableCreditLimit: undefined,
      raw: { balance: '1234.5000' },
      lastTransactionDate: '2026-09-04',
      syncEnabled: true,
    });
    expect(mapPluggySyncResult({ transactions_imported: 3, accounts_synced: 1, error: null })).toEqual({
      transactionsImported: 3,
      accountsSynced: 1,
      error: undefined,
    });
  });
});
