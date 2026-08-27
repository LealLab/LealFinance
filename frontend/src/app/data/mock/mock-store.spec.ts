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
    expect(store.categoryGroups().length).toBeGreaterThan(0);
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
    it('creates, updates, and deletes an unused category group', () => {
      const created = store.createCategoryGroup({
        name: 'Grupo Teste',
        kind: 'expense',
        color: '#000000',
        icon: 'tag',
      });
      expect(store.categoryGroups()).toContainEqual(created);

      const updated = store.updateCategoryGroup(created.id, { name: 'Grupo Renomeado' });
      expect(updated.name).toBe('Grupo Renomeado');

      store.deleteCategoryGroup(created.id);
      expect(store.categoryGroups().find((group) => group.id === created.id)).toBeUndefined();
    });

    it('refuses to delete a category group referenced by a category', () => {
      const group = store.createCategoryGroup({
        name: 'Grupo em Uso',
        kind: 'expense',
        color: '#000000',
        icon: 'tag',
      });
      store.createCategory({
        name: 'Categoria Teste',
        kind: 'expense',
        groupId: group.id,
        color: '#000000',
        icon: 'tag',
      });

      expect(() => store.deleteCategoryGroup(group.id)).toThrow();
      expect(store.categoryGroups().find((item) => item.id === group.id)).toBeDefined();
    });

    it('throws when deleting a category group that does not exist', () => {
      expect(() => store.deleteCategoryGroup('missing-id')).toThrow();
    });

    it('reorders category groups within a kind', () => {
      const a = store.createCategoryGroup({ name: 'A', kind: 'income', color: '#000', icon: 'tag' });
      const b = store.createCategoryGroup({ name: 'B', kind: 'income', color: '#000', icon: 'tag' });

      store.reorderCategoryGroups('income', [b.id, a.id]);

      expect(store.categoryGroups().find((group) => group.id === b.id)?.position).toBe(0);
      expect(store.categoryGroups().find((group) => group.id === a.id)?.position).toBe(1);
    });

    it('creates a category in a group and keeps its transaction reference', () => {
      const group = store.createCategoryGroup({
        name: 'Grupo Teste',
        kind: 'expense',
        color: '#000000',
        icon: 'tag',
      });
      const category = store.createCategory({
        name: 'Categoria Teste',
        kind: 'expense',
        groupId: group.id,
        color: '#000000',
        icon: 'tag'
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
      expect(category.groupId).toBe(group.id);
      expect(store.transactions().find((t) => t.id === transaction.id)?.categoryId).toBe(category.id);
    });

    it('assigns position 0 to the first category in a new kind/groupId group, and increments after that', () => {
      // The fixtures already seed several groups for both kinds, so use a fresh group
      // with no
      // pre-existing siblings) to observe position starting at 0.
      const group = store.createCategoryGroup({
        name: 'Grupo Novo',
        kind: 'expense',
        color: '#000',
        icon: 'tag'
      });
      const first = store.createCategory({
        name: 'Primeira',
        kind: 'expense',
        groupId: group.id,
        color: '#000',
        icon: 'tag'
      });
      const second = store.createCategory({
        name: 'Segunda',
        kind: 'expense',
        groupId: group.id,
        color: '#000',
        icon: 'tag'
      });

      expect(first.position).toBe(0);
      expect(second.position).toBe(first.position + 1);
    });

    it('scopes position assignment to the same kind/groupId group, not the whole list', () => {
      const group = store.createCategoryGroup({
        name: 'Pai',
        kind: 'expense',
        color: '#000',
        icon: 'tag'
      });
      const child = store.createCategory({
        name: 'Filho',
        kind: 'expense',
        groupId: group.id,
        color: '#000',
        icon: 'tag'
      });

      // The category starts its own sibling group at position 0 even though
      // many categories with higher positions already exist.
      expect(child.position).toBe(0);
    });

    it('deletes an unreferenced category', () => {
      const category = store.createCategory({
        name: 'Descartável',
        kind: 'expense',
        groupId: 'group-other-expense',
        color: '#000',
        icon: 'tag'
      });

      store.deleteCategory(category.id);

      expect(store.categories().find((c) => c.id === category.id)).toBeUndefined();
    });

    it('throws when deleting a category that does not exist', () => {
      expect(() => store.deleteCategory('missing-id')).toThrow();
    });

    it('reorders only the categories passed, leaving other categories untouched', () => {
      const a = store.createCategory({ name: 'A', kind: 'expense', groupId: 'group-food', color: '#000', icon: 'tag' });
      const b = store.createCategory({ name: 'B', kind: 'expense', groupId: 'group-food', color: '#000', icon: 'tag' });
      const c = store.createCategory({ name: 'C', kind: 'expense', groupId: 'group-food', color: '#000', icon: 'tag' });
      const untouchedPosition = store.categories().find((cat) => cat.id === 'cat-rent')?.position;

      store.reorderCategories('expense', 'group-food', [c.id, a.id, b.id]);

      const byId = new Map(store.categories().map((cat) => [cat.id, cat]));
      expect(byId.get(c.id)?.position).toBe(0);
      expect(byId.get(a.id)?.position).toBe(1);
      expect(byId.get(b.id)?.position).toBe(2);
      expect(store.categories().find((cat) => cat.id === 'cat-rent')?.position).toBe(untouchedPosition);
    });

    it('ignores ids in the reorder list that do not belong to the given kind/groupId group', () => {
      const a = store.createCategory({ name: 'A2', kind: 'expense', groupId: 'group-food', color: '#000', icon: 'tag' });
      const incomeOnly = store.createCategory({
        name: 'Renda Extra',
        kind: 'income',
        groupId: 'group-salary',
        color: '#000',
        icon: 'tag'
      });
      const positionBefore = incomeOnly.position;

      store.reorderCategories('expense', 'group-food', [incomeOnly.id, a.id]);

      // The income category's position must be untouched by an 'expense' reorder call,
      // since it doesn't belong to that kind/groupId sibling group.
      expect(store.categories().find((cat) => cat.id === incomeOnly.id)?.position).toBe(positionBefore);
      expect(store.categories().find((cat) => cat.id === a.id)?.position).toBe(0);
    });
  });

  describe('budgets', () => {
    it('upsert creates a new budget for a group/month pair that has none yet', () => {
      const created = store.upsertBudget({
        groupId: 'group-x',
        month: '2026-05',
        amount: '100',
        currency: 'BRL'
      });

      expect(store.budgets()).toContainEqual(created);
    });

    it('upsert updates the existing row for the same group/month instead of duplicating it', () => {
      const first = store.upsertBudget({
        groupId: 'group-y',
        month: '2026-05',
        amount: '100',
        currency: 'BRL'
      });
      const second = store.upsertBudget({
        groupId: 'group-y',
        month: '2026-05',
        amount: '250',
        currency: 'BRL'
      });

      expect(second.id).toBe(first.id);
      expect(store.budgets().filter((b) => b.groupId === 'group-y' && b.month === '2026-05')).toHaveLength(
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

  describe('manualRates', () => {
    it('upsert creates a new rate for a pair/date that has none yet', () => {
      const created = store.upsertManualRate({
        baseCode: 'USD',
        quoteCode: 'BRL',
        rate: '5.2',
        asOf: '2026-05-01'
      });

      expect(store.manualRates()).toContainEqual(created);
    });

    it('upsert updates the existing row for the same pair/date instead of duplicating it', () => {
      const first = store.upsertManualRate({
        baseCode: 'EUR',
        quoteCode: 'BRL',
        rate: '5.6',
        asOf: '2026-05-02'
      });
      const second = store.upsertManualRate({
        baseCode: 'EUR',
        quoteCode: 'BRL',
        rate: '5.65',
        asOf: '2026-05-02'
      });

      expect(second.id).toBe(first.id);
      expect(
        store
          .manualRates()
          .filter((r) => r.baseCode === 'EUR' && r.quoteCode === 'BRL' && r.asOf === '2026-05-02')
      ).toHaveLength(1);
      expect(store.manualRates().find((r) => r.id === first.id)?.rate).toBe('5.65');
    });

    it('deletes an existing manual rate', () => {
      const created = store.upsertManualRate({
        baseCode: 'GBP',
        quoteCode: 'BRL',
        rate: '6.5',
        asOf: '2026-05-03'
      });

      store.deleteManualRate(created.id);

      expect(store.manualRates().find((r) => r.id === created.id)).toBeUndefined();
    });

    it('throws when deleting a manual rate that does not exist', () => {
      expect(() => store.deleteManualRate('missing-id')).toThrow();
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
