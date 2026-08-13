import { Account } from '../../domain/models/account';
import { Transaction } from '../../domain/models/transaction';
import { EMPTY_FILTERS, matchesFilters, TransactionFilters } from './transaction-filters';

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
});
