import { Injectable, signal } from '@angular/core';
import { Account } from '../../domain/models/account';
import { Budget } from '../../domain/models/budget';
import { Category, CategoryKind } from '../../domain/models/category';
import { RecurringRule } from '../../domain/models/recurring';
import { Transaction } from '../../domain/models/transaction';
import { createFixtures } from './fixtures';
import { findEntity, removeEntity, reorderEntities, updateEntity } from './entity-list.utils';

function newId(): string {
  return crypto.randomUUID();
}

function notFound(entity: string, id: string): never {
  throw new Error(`${entity} "${id}" not found`);
}

/**
 * The single in-memory source of truth behind every Mock*Repository — see
 * data/*.repository.ts for the abstractions built on top of it. Backed by
 * signals so components could in principle read it reactively, though in
 * practice everything goes through the repository interfaces to keep the
 * eventual swap to real HTTP a provider change, not a call-site change.
 *
 * State is in-memory only by design (see docs/superpowers/specs — mock
 * persistence decision): a reload always comes back to `reset()`'s
 * fixtures. `reset()` is also exposed directly to the Settings screen's
 * "reset mock data" action.
 */
@Injectable({ providedIn: 'root' })
export class MockStore {
  private readonly accountsSignal = signal<Account[]>([]);
  private readonly transactionsSignal = signal<Transaction[]>([]);
  private readonly categoriesSignal = signal<Category[]>([]);
  private readonly budgetsSignal = signal<Budget[]>([]);
  private readonly recurringRulesSignal = signal<RecurringRule[]>([]);

  readonly accounts = this.accountsSignal.asReadonly();
  readonly transactions = this.transactionsSignal.asReadonly();
  readonly categories = this.categoriesSignal.asReadonly();
  readonly budgets = this.budgetsSignal.asReadonly();
  readonly recurringRules = this.recurringRulesSignal.asReadonly();

  constructor() {
    this.reset();
  }

  reset(): void {
    const fixtures = createFixtures();
    this.accountsSignal.set(fixtures.accounts);
    this.transactionsSignal.set(fixtures.transactions);
    this.categoriesSignal.set(fixtures.categories);
    this.budgetsSignal.set(fixtures.budgets);
    this.recurringRulesSignal.set(fixtures.recurringRules);
  }

  // --- Accounts ---------------------------------------------------------

  createAccount(input: Omit<Account, 'id'>): Account {
    const account: Account = { ...input, id: newId() };
    this.accountsSignal.update((list) => [...list, account]);
    return account;
  }

  updateAccount(id: string, changes: Partial<Omit<Account, 'id'>>): Account {
    if (!findEntity(this.accountsSignal(), id)) notFound('Account', id);
    this.accountsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.accountsSignal(), id)!;
  }

  // --- Transactions -------------------------------------------------------

  createTransaction(input: Omit<Transaction, 'id'>): Transaction {
    const transaction: Transaction = { ...input, id: newId() };
    this.transactionsSignal.update((list) => [...list, transaction]);
    return transaction;
  }

  updateTransaction(id: string, changes: Partial<Omit<Transaction, 'id'>>): Transaction {
    if (!findEntity(this.transactionsSignal(), id)) notFound('Transaction', id);
    this.transactionsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.transactionsSignal(), id)!;
  }

  deleteTransaction(id: string): void {
    if (!findEntity(this.transactionsSignal(), id)) notFound('Transaction', id);
    this.transactionsSignal.update((list) => removeEntity(list, id));
  }

  // --- Categories ---------------------------------------------------------

  createCategory(input: Omit<Category, 'id' | 'position'>): Category {
    const siblingPositions = this.categoriesSignal()
      .filter((c) => c.kind === input.kind && c.parentId === input.parentId)
      .map((c) => c.position);
    const position = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
    const category: Category = { ...input, id: newId(), position };
    this.categoriesSignal.update((list) => [...list, category]);
    return category;
  }

  updateCategory(id: string, changes: Partial<Omit<Category, 'id'>>): Category {
    if (!findEntity(this.categoriesSignal(), id)) notFound('Category', id);
    this.categoriesSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.categoriesSignal(), id)!;
  }

  deleteCategory(id: string): void {
    if (!findEntity(this.categoriesSignal(), id)) notFound('Category', id);
    this.categoriesSignal.update((list) => removeEntity(list, id));
  }

  /**
   * Reassigns sequential positions (0, 1, 2, ...) to exactly the categories
   * in `orderedIds`, scoped to the given `kind`/`parentId` sibling group —
   * other categories, including siblings not present in `orderedIds`, are
   * left untouched. Ids that don't actually belong to that sibling group are
   * ignored, so a caller can't accidentally reorder across groups.
   */
  reorderCategories(kind: CategoryKind, parentId: string | undefined, orderedIds: string[]): void {
    const siblingIds = new Set(
      this.categoriesSignal()
        .filter((c) => c.kind === kind && c.parentId === parentId)
        .map((c) => c.id)
    );
    const validOrderedIds = orderedIds.filter((id) => siblingIds.has(id));
    this.categoriesSignal.update((list) => reorderEntities(list, validOrderedIds));
  }

  // --- Budgets --------------------------------------------------------------

  upsertBudget(input: Omit<Budget, 'id'>): Budget {
    const existing = this.budgetsSignal().find(
      (budget) => budget.categoryId === input.categoryId && budget.month === input.month
    );
    if (existing) {
      this.budgetsSignal.update((list) => updateEntity(list, existing.id, input));
      return findEntity(this.budgetsSignal(), existing.id)!;
    }
    const budget: Budget = { ...input, id: newId() };
    this.budgetsSignal.update((list) => [...list, budget]);
    return budget;
  }

  deleteBudget(id: string): void {
    if (!findEntity(this.budgetsSignal(), id)) notFound('Budget', id);
    this.budgetsSignal.update((list) => removeEntity(list, id));
  }

  // --- Recurring rules --------------------------------------------------

  createRecurringRule(input: Omit<RecurringRule, 'id'>): RecurringRule {
    const rule: RecurringRule = { ...input, id: newId() };
    this.recurringRulesSignal.update((list) => [...list, rule]);
    return rule;
  }

  updateRecurringRule(id: string, changes: Partial<Omit<RecurringRule, 'id'>>): RecurringRule {
    if (!findEntity(this.recurringRulesSignal(), id)) notFound('RecurringRule', id);
    this.recurringRulesSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.recurringRulesSignal(), id)!;
  }

  deleteRecurringRule(id: string): void {
    if (!findEntity(this.recurringRulesSignal(), id)) notFound('RecurringRule', id);
    this.recurringRulesSignal.update((list) => removeEntity(list, id));
  }
}
