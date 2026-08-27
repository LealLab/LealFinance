import { Injectable, signal } from '@angular/core';
import { Account } from '../../domain/models/account';
import { Budget } from '../../domain/models/budget';
import { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Goal } from '../../domain/models/goal';
import { Institution } from '../../domain/models/institution';
import {
  InvestmentAsset,
  InvestmentTransaction,
  InvestmentWallet,
} from '../../domain/models/investment';
import { ManualRate } from '../../domain/models/manual-rate';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
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

const MARKET_DATA_PROVIDERS: MarketDataProvider[] = ['twelve_data', 'brapi'];

/**
 * The single in-memory source of truth behind every Mock*Repository - see
 * data/*.repository.ts for the abstractions built on top of it. Backed by
 * signals so components could in principle read it reactively. Everything
 * goes through the repository interfaces, allowing this store to remain a
 * test double while the application uses HTTP providers.
 *
 * State is in-memory only by design: a reload always comes back to `reset()`'s
 * fixtures. `reset()` is also exposed directly to the Settings screen's
 * "reset mock data" action.
 */
@Injectable({ providedIn: 'root' })
export class MockStore {
  private readonly accountsSignal = signal<Account[]>([]);
  private readonly transactionsSignal = signal<Transaction[]>([]);
  private readonly categoryGroupsSignal = signal<CategoryGroup[]>([]);
  private readonly categoriesSignal = signal<Category[]>([]);
  private readonly budgetsSignal = signal<Budget[]>([]);
  private readonly goalsSignal = signal<Goal[]>([]);
  private readonly investmentWalletsSignal = signal<InvestmentWallet[]>([]);
  private readonly investmentAssetsSignal = signal<InvestmentAsset[]>([]);
  private readonly investmentTransactionsSignal = signal<InvestmentTransaction[]>([]);
  private readonly allocationsSignal = signal<BudgetAllocation[]>([]);
  private readonly expectedIncomeSignal = signal<ExpectedIncome[]>([]);
  private readonly recurringRulesSignal = signal<RecurringRule[]>([]);
  private readonly institutionsSignal = signal<Institution[]>([]);
  private readonly manualRatesSignal = signal<ManualRate[]>([]);
  private readonly marketDataLinkedProvidersSignal = signal<MarketDataProvider[]>([]);

  readonly accounts = this.accountsSignal.asReadonly();
  readonly transactions = this.transactionsSignal.asReadonly();
  readonly categoryGroups = this.categoryGroupsSignal.asReadonly();
  readonly categories = this.categoriesSignal.asReadonly();
  readonly budgets = this.budgetsSignal.asReadonly();
  readonly goals = this.goalsSignal.asReadonly();
  readonly investmentWallets = this.investmentWalletsSignal.asReadonly();
  readonly investmentAssets = this.investmentAssetsSignal.asReadonly();
  readonly investmentTransactions = this.investmentTransactionsSignal.asReadonly();
  readonly allocations = this.allocationsSignal.asReadonly();
  readonly expectedIncome = this.expectedIncomeSignal.asReadonly();
  readonly recurringRules = this.recurringRulesSignal.asReadonly();
  readonly institutions = this.institutionsSignal.asReadonly();
  readonly manualRates = this.manualRatesSignal.asReadonly();
  readonly marketDataLinkedProviders = this.marketDataLinkedProvidersSignal.asReadonly();

  constructor() {
    this.reset();
  }

  reset(): void {
    const fixtures = createFixtures();
    this.accountsSignal.set(fixtures.accounts);
    this.transactionsSignal.set(fixtures.transactions);
    this.categoryGroupsSignal.set(fixtures.categoryGroups);
    this.categoriesSignal.set(fixtures.categories);
    this.budgetsSignal.set(fixtures.budgets);
    this.goalsSignal.set(fixtures.goals);
    this.investmentWalletsSignal.set(fixtures.investmentWallets);
    this.investmentAssetsSignal.set(fixtures.investmentAssets);
    this.investmentTransactionsSignal.set(fixtures.investmentTransactions);
    this.allocationsSignal.set(fixtures.allocations);
    this.expectedIncomeSignal.set(fixtures.expectedIncome);
    this.recurringRulesSignal.set(fixtures.recurringRules);
    this.institutionsSignal.set(fixtures.institutions);
    this.manualRatesSignal.set(fixtures.manualRates);
    this.marketDataLinkedProvidersSignal.set([]);
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
   * Refuses to delete an institution that any account still references -
   * unlike Transactions/Budgets/RecurringRules (freely deletable), this is
   * an invariant check enforced at the store level (the categories
   * workstream's usage-guard equivalent lives one layer up instead; either
   * placement is fine, this just needs to be the one used consistently
   * here). A thrown Error is this repo's existing convention for a
   * store-level invariant violation - see `notFound` above.
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

  // --- Category Groups ----------------------------------------------------

  createCategoryGroup(input: Omit<CategoryGroup, 'id' | 'position'>): CategoryGroup {
    const siblingPositions = this.categoryGroupsSignal()
      .filter((group) => group.kind === input.kind)
      .map((group) => group.position);
    const position = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
    const group: CategoryGroup = { ...input, id: newId(), position };
    this.categoryGroupsSignal.update((list) => [...list, group]);
    return group;
  }

  updateCategoryGroup(id: string, changes: Partial<Omit<CategoryGroup, 'id'>>): CategoryGroup {
    if (!findEntity(this.categoryGroupsSignal(), id)) notFound('Category group', id);
    this.categoryGroupsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.categoryGroupsSignal(), id)!;
  }

  deleteCategoryGroup(id: string): void {
    if (!findEntity(this.categoryGroupsSignal(), id)) notFound('Category group', id);
    const inUse =
      this.categoriesSignal().some((category) => category.groupId === id) ||
      this.budgetsSignal().some((budget) => budget.groupId === id) ||
      this.allocationsSignal().some((allocation) => allocation.groupId === id);
    if (inUse) {
      throw new Error(`Category group "${id}" is still referenced`);
    }
    this.categoryGroupsSignal.update((list) => removeEntity(list, id));
  }

  reorderCategoryGroups(kind: CategoryKind, orderedIds: string[]): void {
    const siblingIds = new Set(
      this.categoryGroupsSignal()
        .filter((group) => group.kind === kind)
        .map((group) => group.id),
    );
    const validOrderedIds = orderedIds.filter((id) => siblingIds.has(id));
    this.categoryGroupsSignal.update((list) => reorderEntities(list, validOrderedIds));
  }

  // --- Categories ---------------------------------------------------------

  createCategory(input: Omit<Category, 'id' | 'position'>): Category {
    const siblingPositions = this.categoriesSignal()
      .filter((c) => c.kind === input.kind && c.groupId === input.groupId)
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
   * in `orderedIds`, scoped to the given `kind`/`groupId` sibling group -
   * other categories, including siblings not present in `orderedIds`, are
   * left untouched. Ids that don't actually belong to that sibling group are
   * ignored, so a caller can't accidentally reorder across groups.
   */
  reorderCategories(kind: CategoryKind, groupId: string, orderedIds: string[]): void {
    const siblingIds = new Set(
      this.categoriesSignal()
        .filter((c) => c.kind === kind && c.groupId === groupId)
        .map((c) => c.id)
    );
    const validOrderedIds = orderedIds.filter((id) => siblingIds.has(id));
    this.categoriesSignal.update((list) => reorderEntities(list, validOrderedIds));
  }

  // --- Budgets --------------------------------------------------------------

  upsertBudget(input: Omit<Budget, 'id'>): Budget {
    const existing = this.budgetsSignal().find(
      (budget) => budget.groupId === input.groupId && budget.month === input.month
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

  // --- Goals --------------------------------------------------------------

  createGoal(input: Omit<Goal, 'id'>): Goal {
    const goal: Goal = { ...input, id: newId() };
    this.goalsSignal.update((list) => [...list, goal]);
    return goal;
  }

  updateGoal(id: string, changes: Partial<Omit<Goal, 'id'>>): Goal {
    if (!findEntity(this.goalsSignal(), id)) notFound('Goal', id);
    this.goalsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.goalsSignal(), id)!;
  }

  // --- Investment wallets, assets, and transactions --------------------

  createInvestmentWallet(input: Omit<InvestmentWallet, 'id'>): InvestmentWallet {
    const wallet: InvestmentWallet = { ...input, id: newId() };
    this.investmentWalletsSignal.update((list) => [...list, wallet]);
    return wallet;
  }

  updateInvestmentWallet(
    id: string,
    changes: Partial<Omit<InvestmentWallet, 'id'>>,
  ): InvestmentWallet {
    if (!findEntity(this.investmentWalletsSignal(), id)) notFound('Investment wallet', id);
    this.investmentWalletsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.investmentWalletsSignal(), id)!;
  }

  createInvestmentAsset(input: Omit<InvestmentAsset, 'id'>): InvestmentAsset {
    const asset: InvestmentAsset = { ...input, id: newId() };
    this.investmentAssetsSignal.update((list) => [...list, asset]);
    return asset;
  }

  updateInvestmentAsset(
    id: string,
    changes: Partial<Omit<InvestmentAsset, 'id'>>,
  ): InvestmentAsset {
    if (!findEntity(this.investmentAssetsSignal(), id)) notFound('Investment asset', id);
    this.investmentAssetsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.investmentAssetsSignal(), id)!;
  }

  createInvestmentTransaction(
    input: Omit<InvestmentTransaction, 'id'>,
  ): InvestmentTransaction {
    const transaction: InvestmentTransaction = { ...input, id: newId() };
    this.investmentTransactionsSignal.update((list) => [...list, transaction]);
    return transaction;
  }

  updateInvestmentTransaction(
    id: string,
    changes: Partial<Omit<InvestmentTransaction, 'id'>>,
  ): InvestmentTransaction {
    if (!findEntity(this.investmentTransactionsSignal(), id)) notFound('Investment transaction', id);
    this.investmentTransactionsSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.investmentTransactionsSignal(), id)!;
  }

  deleteInvestmentTransaction(id: string): void {
    if (!findEntity(this.investmentTransactionsSignal(), id)) {
      notFound('Investment transaction', id);
    }
    this.investmentTransactionsSignal.update((list) => removeEntity(list, id));
  }

  // --- Percentage budget planner -----------------------------------------

  upsertAllocation(input: Omit<BudgetAllocation, 'id'>): BudgetAllocation {
    const existing = this.allocationsSignal().find((allocation) => allocation.groupId === input.groupId);
    if (existing) {
      this.allocationsSignal.update((list) => updateEntity(list, existing.id, input));
      return findEntity(this.allocationsSignal(), existing.id)!;
    }
    const allocation: BudgetAllocation = { ...input, id: newId() };
    this.allocationsSignal.update((list) => [...list, allocation]);
    return allocation;
  }

  deleteAllocation(id: string): void {
    if (!findEntity(this.allocationsSignal(), id)) notFound('Budget allocation', id);
    this.allocationsSignal.update((list) => removeEntity(list, id));
  }

  upsertExpectedIncome(input: Omit<ExpectedIncome, 'id'>): ExpectedIncome {
    const existing = this.expectedIncomeSignal().find((income) => income.month === input.month);
    if (existing) {
      this.expectedIncomeSignal.update((list) => updateEntity(list, existing.id, input));
      return findEntity(this.expectedIncomeSignal(), existing.id)!;
    }
    const income: ExpectedIncome = { ...input, id: newId() };
    this.expectedIncomeSignal.update((list) => [...list, income]);
    return income;
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

  // --- Manual exchange rates ----------------------------------------------

  /**
   * Keyed on (baseCode, quoteCode, asOf) rather than a caller-supplied id -
   * same "upsert" shape as `upsertBudget` above - so re-entering a rate for
   * a pair/date that already has one edits it in place instead of
   * accumulating duplicates for the same day.
   */
  upsertManualRate(input: Omit<ManualRate, 'id'>): ManualRate {
    const existing = this.manualRatesSignal().find(
      (rate) =>
        rate.baseCode === input.baseCode && rate.quoteCode === input.quoteCode && rate.asOf === input.asOf
    );
    if (existing) {
      this.manualRatesSignal.update((list) => updateEntity(list, existing.id, input));
      return findEntity(this.manualRatesSignal(), existing.id)!;
    }
    const rate: ManualRate = { ...input, id: newId() };
    this.manualRatesSignal.update((list) => [...list, rate]);
    return rate;
  }

  deleteManualRate(id: string): void {
    if (!findEntity(this.manualRatesSignal(), id)) notFound('Manual rate', id);
    this.manualRatesSignal.update((list) => removeEntity(list, id));
  }

  marketDataCredentialStatuses(): MarketDataCredentialStatus[] {
    const linked = new Set(this.marketDataLinkedProvidersSignal());
    return MARKET_DATA_PROVIDERS.map((provider) => ({
      provider,
      configured: linked.has(provider),
      source: linked.has(provider) ? 'user' : 'none',
    }));
  }

  linkMarketDataProvider(provider: MarketDataProvider): MarketDataCredentialStatus {
    this.marketDataLinkedProvidersSignal.update((providers) =>
      providers.includes(provider) ? providers : [...providers, provider],
    );
    return { provider, configured: true, source: 'user' };
  }

  unlinkMarketDataProvider(provider: MarketDataProvider): void {
    if (!this.marketDataLinkedProvidersSignal().includes(provider)) {
      notFound('Market-data credential', provider);
    }
    this.marketDataLinkedProvidersSignal.update((providers) =>
      providers.filter((current) => current !== provider),
    );
  }
}
