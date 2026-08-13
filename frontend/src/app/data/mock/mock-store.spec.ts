import { TestBed } from '@angular/core/testing';
import { MockStore } from './mock-store';

describe('MockStore', () => {
  let store: MockStore;

  beforeEach(() => {
    store = TestBed.inject(MockStore);
  });

  it('seeds every entity list on construction', () => {
    expect(store.accounts().length).toBeGreaterThan(0);
    expect(store.transactions().length).toBeGreaterThan(0);
    expect(store.categories().length).toBeGreaterThan(0);
    expect(store.budgets().length).toBeGreaterThan(0);
    expect(store.recurringRules().length).toBeGreaterThan(0);
    expect(store.institutions().length).toBeGreaterThan(0);
  });

  describe('accounts', () => {
    it('creates and round-trips an account', () => {
      const created = store.createAccount({
        name: 'Nova Conta',
        type: 'checking',
        currency: 'BRL',
        openingBalance: '0',
        archived: false
      });

      expect(store.accounts()).toContainEqual(created);
    });

    it('updates an existing account in place', () => {
      const created = store.createAccount({
        name: 'Nova Conta',
        type: 'checking',
        currency: 'BRL',
        openingBalance: '0',
        archived: false
      });

      const updated = store.updateAccount(created.id, { name: 'Conta Renomeada' });

      expect(updated.name).toBe('Conta Renomeada');
      expect(store.accounts().find((a) => a.id === created.id)?.name).toBe('Conta Renomeada');
    });

    it('throws when updating an account that does not exist', () => {
      expect(() => store.updateAccount('missing-id', { name: 'x' })).toThrow();
    });
  });

  describe('transactions', () => {
    it('creates, updates, and deletes a transaction', () => {
      const created = store.createTransaction({
        type: 'expense',
        date: '2026-01-01',
        amount: '10',
        currency: 'BRL',
        accountId: store.accounts()[0].id,
        description: 'Teste'
      });
      expect(store.transactions()).toContainEqual(created);

      const updated = store.updateTransaction(created.id, { amount: '20' });
      expect(updated.amount).toBe('20');

      store.deleteTransaction(created.id);
      expect(store.transactions().find((t) => t.id === created.id)).toBeUndefined();
    });

    it('throws when deleting a transaction that does not exist', () => {
      expect(() => store.deleteTransaction('missing-id')).toThrow();
    });
  });

  describe('categories', () => {
    it('archiving a referenced category keeps it (and its id) intact rather than removing it', () => {
      const category = store.createCategory({
        name: 'Categoria Teste',
        kind: 'expense',
        color: '#000000',
        icon: 'tag',
        archived: false
      });
      const transaction = store.createTransaction({
        type: 'expense',
        date: '2026-01-01',
        amount: '10',
        currency: 'BRL',
        accountId: store.accounts()[0].id,
        categoryId: category.id,
        description: 'Compra'
      });

      const archived = store.updateCategory(category.id, { archived: true });

      expect(archived.archived).toBe(true);
      expect(archived.id).toBe(category.id);
      expect(store.categories().find((c) => c.id === category.id)).toBeDefined();
      expect(store.transactions().find((t) => t.id === transaction.id)?.categoryId).toBe(category.id);
    });
  });

  describe('budgets', () => {
    it('upsert creates a new budget for a category/month pair that has none yet', () => {
      const created = store.upsertBudget({
        categoryId: 'cat-x',
        month: '2026-05',
        amount: '100',
        currency: 'BRL'
      });

      expect(store.budgets()).toContainEqual(created);
    });

    it('upsert updates the existing row for the same category/month instead of duplicating it', () => {
      const first = store.upsertBudget({
        categoryId: 'cat-y',
        month: '2026-05',
        amount: '100',
        currency: 'BRL'
      });
      const second = store.upsertBudget({
        categoryId: 'cat-y',
        month: '2026-05',
        amount: '250',
        currency: 'BRL'
      });

      expect(second.id).toBe(first.id);
      expect(store.budgets().filter((b) => b.categoryId === 'cat-y' && b.month === '2026-05')).toHaveLength(
        1
      );
      expect(store.budgets().find((b) => b.id === first.id)?.amount).toBe('250');
    });
  });

  describe('institutions', () => {
    it('creates and round-trips an institution', () => {
      const created = store.createInstitution({
        name: 'Nova Instituição',
        icon: 'bank',
        archived: false,
        position: 99
      });

      expect(store.institutions()).toContainEqual(created);
    });

    it('updates an existing institution in place', () => {
      const created = store.createInstitution({
        name: 'Nova Instituição',
        icon: 'bank',
        archived: false,
        position: 99
      });

      const updated = store.updateInstitution(created.id, { name: 'Renomeada' });

      expect(updated.name).toBe('Renomeada');
      expect(store.institutions().find((i) => i.id === created.id)?.name).toBe('Renomeada');
    });

    it('throws when updating an institution that does not exist', () => {
      expect(() => store.updateInstitution('missing-id', { name: 'x' })).toThrow();
    });

    it('deletes an institution no account references', () => {
      const created = store.createInstitution({
        name: 'Instituição Vazia',
        icon: 'bank',
        archived: false,
        position: 99
      });

      store.deleteInstitution(created.id);

      expect(store.institutions().find((i) => i.id === created.id)).toBeUndefined();
    });

    it('refuses to delete an institution still referenced by an account', () => {
      const institution = store.createInstitution({
        name: 'Instituição em Uso',
        icon: 'bank',
        archived: false,
        position: 99
      });
      store.createAccount({
        name: 'Conta Vinculada',
        type: 'checking',
        currency: 'BRL',
        openingBalance: '0',
        institutionId: institution.id,
        archived: false
      });

      expect(() => store.deleteInstitution(institution.id)).toThrow();
      expect(store.institutions().find((i) => i.id === institution.id)).toBeDefined();
    });

    it('throws when deleting an institution that does not exist', () => {
      expect(() => store.deleteInstitution('missing-id')).toThrow();
    });
  });

  describe('reset', () => {
    it('discards created entities and restores the seeded fixtures', () => {
      const seededCount = store.accounts().length;
      store.createAccount({
        name: 'Temporária',
        type: 'checking',
        currency: 'BRL',
        openingBalance: '0',
        archived: false
      });
      expect(store.accounts().length).toBe(seededCount + 1);

      store.reset();

      expect(store.accounts().length).toBe(seededCount);
    });
  });
});
