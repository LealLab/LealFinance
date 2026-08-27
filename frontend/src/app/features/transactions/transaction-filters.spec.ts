import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Transaction } from '../../domain/models/transaction';
import {
  activeChips,
  ChipContext,
  clearChip,
  EMPTY_FILTERS,
  matchesFilters,
  toQuery,
  TransactionFilters
} from './transaction-filters';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Account',
    type: 'checking',
    currency: 'BRL',
    openingBalance: '0',
    archived: false,
    ...overrides
  };
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    date: '2026-01-15',
    amount: '0',
    currency: 'BRL',
    accountId: 'acc-1',
    description: '',
    ...overrides
  };
}

const bancoLeal = account({ id: 'checking', institutionId: 'inst-banco-leal' });
const xpEurope = account({ id: 'investment', institutionId: 'inst-xp-europe' });
const noInstitution = account({ id: 'cash' });

const accountsById = new Map<string, Account>([
  [bancoLeal.id, bancoLeal],
  [xpEurope.id, xpEurope],
  [noInstitution.id, noInstitution]
]);

describe('matchesFilters', () => {
  it('passes everything through when no filter is set', () => {
    const transaction = tx({ accountId: bancoLeal.id });
    expect(matchesFilters(transaction, EMPTY_FILTERS, accountsById)).toBe(true);
  });

  describe('institutionId', () => {
    const filters: TransactionFilters = { ...EMPTY_FILTERS, institutionId: 'inst-banco-leal' };

    it('matches a non-transfer transaction whose account belongs to the filtered institution', () => {
      const transaction = tx({ accountId: bancoLeal.id });
      expect(matchesFilters(transaction, filters, accountsById)).toBe(true);
    });

    it('rejects a non-transfer transaction whose account belongs to a different institution', () => {
      const transaction = tx({ accountId: xpEurope.id });
      expect(matchesFilters(transaction, filters, accountsById)).toBe(false);
    });

    it('rejects a transaction on an account with no institution at all', () => {
      const transaction = tx({ accountId: noInstitution.id });
      expect(matchesFilters(transaction, filters, accountsById)).toBe(false);
    });

    it('matches a transfer when the *source* leg belongs to the filtered institution', () => {
      const transfer = tx({
        type: 'transfer',
        accountId: bancoLeal.id,
        toAccountId: xpEurope.id,
        categoryId: undefined
      });
      expect(matchesFilters(transfer, filters, accountsById)).toBe(true);
    });

    it('matches a transfer when the *destination* leg belongs to the filtered institution', () => {
      const transfer = tx({
        type: 'transfer',
        accountId: xpEurope.id,
        toAccountId: bancoLeal.id,
        categoryId: undefined
      });
      expect(matchesFilters(transfer, filters, accountsById)).toBe(true);
    });

    it('rejects a transfer where neither leg belongs to the filtered institution', () => {
      const transfer = tx({
        type: 'transfer',
        accountId: xpEurope.id,
        toAccountId: noInstitution.id,
        categoryId: undefined
      });
      expect(matchesFilters(transfer, filters, accountsById)).toBe(false);
    });
  });

  describe('groupId', () => {
    const groceries: Category = {
      id: 'cat-groceries',
      name: 'Groceries',
      kind: 'expense',
      groupId: 'grp-essentials',
      color: '#000',
      icon: 'cart',
      position: 0
    };
    const categoriesById = new Map<string, Category>([[groceries.id, groceries]]);
    const filters: TransactionFilters = { ...EMPTY_FILTERS, groupId: 'grp-essentials' };

    it("matches a transaction whose category is in the filtered group", () => {
      const transaction = tx({ categoryId: groceries.id });
      expect(matchesFilters(transaction, filters, accountsById, categoriesById)).toBe(true);
    });

    it("rejects a transaction whose category is in another group", () => {
      const transaction = tx({ categoryId: 'cat-other' });
      expect(matchesFilters(transaction, filters, accountsById, categoriesById)).toBe(false);
    });
  });

  describe('amount range', () => {
    it('respects inclusive min/max bounds', () => {
      const filters: TransactionFilters = { ...EMPTY_FILTERS, amountMin: '10', amountMax: '20' };
      expect(matchesFilters(tx({ amount: '10' }), filters, accountsById)).toBe(true);
      expect(matchesFilters(tx({ amount: '20' }), filters, accountsById)).toBe(true);
      expect(matchesFilters(tx({ amount: '9.99' }), filters, accountsById)).toBe(false);
      expect(matchesFilters(tx({ amount: '20.01' }), filters, accountsById)).toBe(false);
    });
  });
});

describe('toQuery', () => {
  it('maps set fields and drops empty ones', () => {
    const filters: TransactionFilters = {
      ...EMPTY_FILTERS,
      accountId: 'acc-1',
      groupId: 'grp-1',
      from: '2026-01-01',
      amountMin: '5'
    };
    expect(toQuery(filters)).toEqual({
      accountId: 'acc-1',
      categoryId: undefined,
      groupId: 'grp-1',
      institutionId: undefined,
      dateFrom: '2026-01-01',
      dateTo: undefined,
      amountMin: '5',
      amountMax: undefined
    });
  });
});

describe('activeChips / clearChip', () => {
  const ctx: ChipContext = {
    accountsById: new Map([[bancoLeal.id, bancoLeal]]),
    categoriesById: new Map(),
    groupsById: new Map(),
    institutionsById: new Map(),
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    formatDate: (iso) => iso
  };

  it('emits one date chip covering both bounds and clears both', () => {
    const filters: TransactionFilters = {
      ...EMPTY_FILTERS,
      accountId: bancoLeal.id,
      from: '2026-01-01',
      to: '2026-01-31'
    };
    const chips = activeChips(filters, ctx);
    expect(chips.map((c) => c.key)).toEqual(['account', 'date']);

    const cleared = clearChip(filters, 'date');
    expect(cleared.from).toBe('');
    expect(cleared.to).toBe('');
    expect(cleared.accountId).toBe(bancoLeal.id);
  });
});
