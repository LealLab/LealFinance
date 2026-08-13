import { Injectable, signal } from '@angular/core';
import { Account } from '../../domain/models/account';
import { Budget } from '../../domain/models/budget';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { RecurringRule } from '../../domain/models/recurring';
import { Transaction } from '../../domain/models/transaction';
import { createFixtures } from './fixtures';
import { findEntity, removeEntity, updateEntity } from './entity-list.utils';

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
  private readonly institutionsSignal = signal<Institution[]>([]);

  readonly accounts = this.accountsSignal.asReadonly();
  readonly transactions = this.transactionsSignal.asReadonly();
  readonly categories = this.categoriesSignal.asReadonly();
  readonly budgets = this.budgetsSignal.asReadonly();
  readonly recurringRules = this.recurringRulesSignal.asReadonly();
  readonly institutions = this.institutionsSignal.asReadonly();

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
    this.institutionsSignal.set(fixtures.institutions);
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

  // --- Institutions -------------------------------------------------------

  createInstitution(input: Omit<Institution, 'id'>): Institution {
    const institution: Institution = { ...input, id: newId() };
    this.institutionsSignal.update((list) => [...list, institution]);
    return institution;
  }

  updateInstitution(id: string, changes: Partial<Omit<Institution, 'id'>>): Institution {
    if (!findEntity(this.institutionsSignal(), id)) notFound('Institution', id);
    this.institutionsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.institutionsSignal(), id)!;
  }

  /**
   * Refuses to delete an institution that any account still references —
   * unlike Transactions/Budgets/RecurringRules (freely deletable), this is
   * an invariant check enforced at the store level (the categories
   * workstream's usage-guard equivalent lives one layer up instead; either
   * placement is fine, this just needs to be the one used consistently
   * here). A thrown Error is this repo's existing convention for a
   * store-level invariant violation — see `notFound` above.
   */
  deleteInstitution(id: string): void {
    if (!findEntity(this.institutionsSignal(), id)) notFound('Institution', id);
    const inUse = this.accountsSignal().some((account) => account.institutionId === id);
    if (inUse) {
      throw new Error(`Institution "${id}" is still referenced by at least one account`);
    }
    this.institutionsSignal.update((list) => removeEntity(list, id));
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

  createCategory(input: Omit<Category, 'id'>): Category {
    const category: Category = { ...input, id: newId() };
    this.categoriesSignal.update((list) => [...list, category]);
    return category;
  }

  updateCategory(id: string, changes: Partial<Omit<Category, 'id'>>): Category {
    if (!findEntity(this.categoriesSignal(), id)) notFound('Category', id);
    this.categoriesSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.categoriesSignal(), id)!;
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
