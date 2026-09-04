import { Injectable, signal } from '@angular/core';
import { ApiError } from '../../core/api-error';
import { Account } from '../../domain/models/account';
import { Budget } from '../../domain/models/budget';
import { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import { CategorizationRule } from '../../domain/models/categorization-rule';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Goal } from '../../domain/models/goal';
import { Institution } from '../../domain/models/institution';
import { Loan } from '../../domain/models/loan';
import {
  installmentAmount as computeInstallmentAmount,
  loanPaymentQuote,
  openLoanInstallments,
} from '../../domain/calc/loans';
import { todayIso } from '../../domain/calc/dates';
import { LoanAdvancePayment, LoanPayment } from '../loan.repository';
import { InstitutionDeleteMode } from '../institution.repository';
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
  private readonly loansSignal = signal<Loan[]>([]);
  private readonly investmentWalletsSignal = signal<InvestmentWallet[]>([]);
  private readonly investmentAssetsSignal = signal<InvestmentAsset[]>([]);
  private readonly investmentTransactionsSignal = signal<InvestmentTransaction[]>([]);
  private readonly allocationsSignal = signal<BudgetAllocation[]>([]);
  private readonly expectedIncomeSignal = signal<ExpectedIncome[]>([]);
  private readonly recurringRulesSignal = signal<RecurringRule[]>([]);
  private readonly categorizationRulesSignal = signal<CategorizationRule[]>([]);
  private readonly institutionsSignal = signal<Institution[]>([]);
  private readonly manualRatesSignal = signal<ManualRate[]>([]);
  private readonly marketDataLinkedProvidersSignal = signal<MarketDataProvider[]>([]);

  readonly accounts = this.accountsSignal.asReadonly();
  readonly transactions = this.transactionsSignal.asReadonly();
  readonly categoryGroups = this.categoryGroupsSignal.asReadonly();
  readonly categories = this.categoriesSignal.asReadonly();
  readonly budgets = this.budgetsSignal.asReadonly();
  readonly goals = this.goalsSignal.asReadonly();
  readonly loans = this.loansSignal.asReadonly();
  readonly investmentWallets = this.investmentWalletsSignal.asReadonly();
  readonly investmentAssets = this.investmentAssetsSignal.asReadonly();
  readonly investmentTransactions = this.investmentTransactionsSignal.asReadonly();
  readonly allocations = this.allocationsSignal.asReadonly();
  readonly expectedIncome = this.expectedIncomeSignal.asReadonly();
  readonly recurringRules = this.recurringRulesSignal.asReadonly();
  readonly categorizationRules = this.categorizationRulesSignal.asReadonly();
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
    this.loansSignal.set(fixtures.loans);
    this.investmentWalletsSignal.set(fixtures.investmentWallets);
    this.investmentAssetsSignal.set(fixtures.investmentAssets);
    this.investmentTransactionsSignal.set(fixtures.investmentTransactions);
    this.allocationsSignal.set(fixtures.allocations);
    this.expectedIncomeSignal.set(fixtures.expectedIncome);
    this.recurringRulesSignal.set(fixtures.recurringRules);
    this.categorizationRulesSignal.set(fixtures.categorizationRules);
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

  deleteInstitution(id: string, mode: InstitutionDeleteMode = 'guard'): void {
    if (!findEntity(this.institutionsSignal(), id)) notFound('Institution', id);
    const accounts = this.accountsSignal().filter((account) => account.institutionId === id);
    const wallets = this.investmentWalletsSignal().filter((wallet) => wallet.institutionId === id);
    if (mode === 'guard' && (accounts.length || wallets.length)) {
      throw new ApiError(409, 'institution.has_accounts', {
        accounts: accounts.length,
        wallets: wallets.length,
      });
    }
    if (mode === 'detach') {
      this.accountsSignal.update((list) =>
        list.map((account) =>
          account.institutionId === id ? { ...account, institutionId: undefined } : account,
        ),
      );
      this.investmentWalletsSignal.update((list) =>
        list.map((wallet) =>
          wallet.institutionId === id ? { ...wallet, institutionId: undefined } : wallet,
        ),
      );
    }
    if (mode === 'cascade') {
      const accountIds = new Set(accounts.map((account) => account.id));
      const walletIds = new Set(
        this.investmentWalletsSignal()
          .filter(
            (wallet) =>
              wallet.institutionId === id ||
              accountIds.has(wallet.accountId) ||
              (wallet.cashAccountId !== undefined && accountIds.has(wallet.cashAccountId)),
          )
          .map((wallet) => wallet.id),
      );
      const transactionIds = new Set(
        this.transactionsSignal()
          .filter(
            (transaction) =>
              accountIds.has(transaction.accountId) ||
              (transaction.toAccountId !== undefined && accountIds.has(transaction.toAccountId)),
          )
          .map((transaction) => transaction.id),
      );
      const investmentTransactionIds = new Set(
        this.investmentTransactionsSignal()
          .filter(
            (transaction) =>
              walletIds.has(transaction.walletId) ||
              (transaction.transactionId !== undefined &&
                transactionIds.has(transaction.transactionId)),
          )
          .map((transaction) => transaction.id),
      );
      const goalIds = new Set(
        this.goalsSignal()
          .filter((goal) => accountIds.has(goal.accountId))
          .map((goal) => goal.id),
      );
      const loanIds = new Set(
        this.loansSignal()
          .filter(
            (loan) =>
              loan.paymentAccountId !== undefined && accountIds.has(loan.paymentAccountId),
          )
          .map((loan) => loan.id),
      );
      const recurringRuleIds = new Set(
        this.recurringRulesSignal()
          .filter(
            (rule) =>
              accountIds.has(rule.template.accountId) ||
              (rule.template.toAccountId !== undefined &&
                accountIds.has(rule.template.toAccountId)),
          )
          .map((rule) => rule.id),
      );

      this.investmentTransactionsSignal.update((list) =>
        list.filter((transaction) => !investmentTransactionIds.has(transaction.id)),
      );
      this.investmentWalletsSignal.update((list) =>
        list.filter((wallet) => !walletIds.has(wallet.id)),
      );
      this.transactionsSignal.update((list) =>
        list
          .filter((transaction) => !transactionIds.has(transaction.id))
          .map((transaction) => {
            const next = { ...transaction };
            if (next.loanId !== undefined && loanIds.has(next.loanId)) next.loanId = undefined;
            if (
              next.recurringRuleId !== undefined &&
              recurringRuleIds.has(next.recurringRuleId)
            ) {
              next.recurringRuleId = undefined;
            }
            return next;
          }),
      );
      this.goalsSignal.update((list) => list.filter((goal) => !goalIds.has(goal.id)));
      this.loansSignal.update((list) => list.filter((loan) => !loanIds.has(loan.id)));
      this.recurringRulesSignal.update((list) =>
        list.filter((rule) => !recurringRuleIds.has(rule.id)),
      );
      this.accountsSignal.update((list) =>
        list
          .filter((account) => !accountIds.has(account.id))
          .map((account) =>
            account.paymentAccountId !== undefined && accountIds.has(account.paymentAccountId)
              ? { ...account, paymentAccountId: undefined }
              : account,
          ),
      );
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

  // --- Loans ------------------------------------------------------------

  /** Re-derives the two backend-computed fields from the contract and linked ledger. */
  private loanWithDerived(loan: Loan): Loan {
    return {
      ...loan,
      installmentAmount: loan.contractedInstallmentAmount ?? computeInstallmentAmount(loan),
      installmentsPaid: this.transactionsSignal().filter((tx) => tx.loanId === loan.id).length,
    };
  }

  listLoans(): Loan[] {
    return this.loansSignal().map((loan) => this.loanWithDerived(loan));
  }

  createLoan(input: Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid'>): Loan {
    const loan: Loan = { ...input, id: newId(), installmentAmount: '0', installmentsPaid: 0 };
    this.loansSignal.update((list) => [...list, loan]);
    return this.loanWithDerived(loan);
  }

  updateLoan(
    id: string,
    changes: Partial<Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid'>>,
  ): Loan {
    if (!findEntity(this.loansSignal(), id)) notFound('Loan', id);
    this.loansSignal.update((list) => updateEntity(list, id, changes));
    return this.loanWithDerived(findEntity(this.loansSignal(), id)!);
  }

  recordLoanPayment(id: string, payment: LoanPayment): Transaction {
    const stored = findEntity(this.loansSignal(), id);
    if (!stored) notFound('Loan', id);
    const loan = this.loanWithDerived(stored);
    const accountId = payment.accountId ?? loan.paymentAccountId;
    if (!accountId) throw new Error('A loan payment needs a source account.');
    const transactions = this.transactionsSignal().filter((transaction) => transaction.loanId === id);
    const installment = openLoanInstallments(loan, transactions)[0];
    if (!installment) throw new Error('Loan is fully paid.');
    const date = payment.date ?? todayIso();
    const suggested = loanPaymentQuote(loan, transactions, 'next', date).suggestedAmount.amount;
    return this.createTransaction({
      type: 'expense',
      date,
      amount: payment.amount ?? suggested,
      currency: loan.currency,
      accountId,
      categoryId: loan.categoryId,
      description:
        payment.description ??
        `${loan.name} ${installment.number}/${loan.installmentCount}`,
      loanId: loan.id,
      installmentNumber: installment.number,
      installmentCount: loan.installmentCount,
    });
  }

  advanceLoanPayments(id: string, payment: LoanAdvancePayment): Transaction[] {
    const stored = findEntity(this.loansSignal(), id);
    if (!stored) notFound('Loan', id);
    const loan = this.loanWithDerived(stored);
    const accountId = payment.accountId ?? loan.paymentAccountId;
    if (!accountId) throw new Error('A loan payment needs a source account.');
    const transactions = this.transactionsSignal().filter((transaction) => transaction.loanId === id);
    const date = payment.date ?? todayIso();
    const quote = loanPaymentQuote(loan, transactions, payment.mode, date, payment.count);
    if (quote.installments.length === 0) throw new Error('No installments selected.');

    let amounts = quote.installments.map((installment) => installment.amount.amount);
    if (payment.amount !== undefined) {
      const total = Number(payment.amount);
      const suggestedTotal = Number(quote.suggestedAmount.amount);
      let allocated = 0;
      amounts = quote.installments.map((installment, index) => {
        if (index === quote.installments.length - 1) return (total - allocated).toFixed(4);
        const amount = Number(
          ((total * Number(installment.amount.amount)) / suggestedTotal).toFixed(4),
        );
        allocated += amount;
        return amount.toFixed(4);
      });
    }

    return quote.installments.map((installment, index) =>
      this.createTransaction({
        type: 'expense',
        date,
        amount: amounts[index],
        currency: loan.currency,
        accountId,
        categoryId: loan.categoryId,
        description:
          payment.description ?? `${loan.name} ${installment.number}/${loan.installmentCount}`,
        loanId: loan.id,
        installmentNumber: installment.number,
        installmentCount: loan.installmentCount,
      }),
    );
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

  // --- Categorization rules --------------------------------------------

  createCategorizationRule(input: Omit<CategorizationRule, 'id'>): CategorizationRule {
    const rule: CategorizationRule = { ...input, id: newId() };
    this.categorizationRulesSignal.update((list) => [...list, rule]);
    return rule;
  }

  updateCategorizationRule(
    id: string,
    changes: Partial<Omit<CategorizationRule, 'id'>>,
  ): CategorizationRule {
    if (!findEntity(this.categorizationRulesSignal(), id)) notFound('CategorizationRule', id);
    this.categorizationRulesSignal.update((list) => updateEntity(list, id, changes));
    return findEntity(this.categorizationRulesSignal(), id)!;
  }

  deleteCategorizationRule(id: string): void {
    if (!findEntity(this.categorizationRulesSignal(), id)) notFound('CategorizationRule', id);
    this.categorizationRulesSignal.update((list) => removeEntity(list, id));
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
