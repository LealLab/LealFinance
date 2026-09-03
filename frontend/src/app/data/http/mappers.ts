import type { Account, AccountBalance } from '../../domain/models/account';
import type { CardInvoice, CardInvoicePayment } from '../../domain/models/card-invoice';
import type {
  AgentOAuthStart,
  AgentProviderLink,
  AgentProviderStatus,
  AgentProviderTestResult,
} from '../../domain/models/agent-provider';
import type { Budget } from '../../domain/models/budget';
import type { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import type {
  CategorizationRule,
  RuleConditionEntry,
  RuleExportItem,
  RulePack,
} from '../../domain/models/categorization-rule';
import type { Category } from '../../domain/models/category';
import type { CategoryGroup } from '../../domain/models/category-group';
import type { ExchangeRate, RateRefresh } from '../../domain/models/exchange-rate';
import type { Goal } from '../../domain/models/goal';
import type { Institution } from '../../domain/models/institution';
import type { Loan } from '../../domain/models/loan';
import type {
  InvestmentAsset,
  InvestmentPosition,
  InvestmentSummary,
  InvestmentTransaction,
  InvestmentWallet,
} from '../../domain/models/investment';
import type { ManualRate } from '../../domain/models/manual-rate';
import type { MarketDataCredentialStatus } from '../../domain/models/market-data-credential';
import type { RecurringRule } from '../../domain/models/recurring';
import type { ImportOptions, ImportPreview, ImportPreviewRequest } from '../transaction.repository';
import type {
  InvestmentWalletCreate,
  InvestmentWalletUpdate,
} from '../investment-wallet.repository';
import type {
  InvestmentAssetCreate,
  InvestmentAssetUpdate,
} from '../investment-asset.repository';
import type {
  InvestmentTransactionCreate,
  InvestmentTransactionUpdate,
} from '../investment-transaction.repository';
import type { Transaction, TransactionConversion } from '../../domain/models/transaction';
import type {
  AccountBalanceWire,
  AccountInputWire,
  AccountPatchWire,
  AccountWire,
  AgentOAuthStartWire,
  AgentProviderLinkWire,
  AgentProviderStatusWire,
  AgentProviderTestWire,
  BudgetAllocationInputWire,
  BudgetAllocationWire,
  BudgetInputWire,
  BudgetWire,
  CardInvoicePaymentWire,
  CardInvoiceWire,
  CategorizationRuleInputWire,
  CategorizationRulePatchWire,
  CategorizationRuleWire,
  CategoryGroupInputWire,
  CategoryGroupPatchWire,
  CategoryGroupWire,
  CategoryInputWire,
  CategoryPatchWire,
  CategoryWire,
  ConversionWire,
  ExchangeRateRefreshWire,
  ExchangeRateWire,
  ExpectedIncomeInputWire,
  ExpectedIncomeWire,
  GoalWire,
  GoalWithAccountInputWire,
  GoalWithAccountPatchWire,
  LoanInputWire,
  LoanPatchWire,
  LoanPaymentWire,
  LoanWire,
  InvestmentAssetInputWire,
  InvestmentAssetPatchWire,
  InvestmentAssetWire,
  InvestmentPositionWire,
  InvestmentSummaryWire,
  InvestmentTransactionInputWire,
  InvestmentTransactionPatchWire,
  InvestmentTransactionWire,
  InvestmentWalletInputWire,
  InvestmentWalletPatchWire,
  InvestmentWalletWire,
  ImportOptionsWire,
  ImportPreviewRequestWire,
  ImportPreviewWire,
  InstitutionInputWire,
  InstitutionPatchWire,
  InstitutionWire,
  ManualRateWire,
  MarketDataCredentialStatusWire,
  RecurringRuleInputWire,
  RecurringRulePatchWire,
  RecurringRuleWire,
  RecurringTemplateWire,
  RuleImportItemWire,
  RulePackWire,
  TransactionInputWire,
  TransactionPatchWire,
  TransactionWire,
} from './wire-dtos';

const has = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const nullable = <T>(value: T | undefined): T | null => value ?? null;

export const mapAccount = (wire: AccountWire): Account => ({
  id: wire.id,
  name: wire.name,
  type: wire.type,
  currency: wire.currency,
  openingBalance: wire.opening_balance,
  institutionId: wire.institution_id ?? undefined,
  archived: wire.archived,
  creditLimit: wire.credit_limit ?? undefined,
  closingDay: wire.closing_day ?? undefined,
  dueDay: wire.due_day ?? undefined,
  paymentAccountId: wire.payment_account_id ?? undefined,
  autoPay: wire.auto_pay,
});

export const mapAccountCreate = (input: Omit<Account, 'id'>): AccountInputWire => ({
  name: input.name,
  type: input.type,
  currency: input.currency,
  opening_balance: input.openingBalance,
  institution_id: nullable(input.institutionId),
  archived: input.archived,
  credit_limit: nullable(input.creditLimit),
  closing_day: nullable(input.closingDay),
  due_day: nullable(input.dueDay),
  payment_account_id: nullable(input.paymentAccountId),
  auto_pay: input.autoPay ?? false,
});

export function mapAccountPatch(input: Partial<Omit<Account, 'id'>>): AccountPatchWire {
  const wire: AccountPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'type')) wire.type = nullable(input.type);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'openingBalance')) wire.opening_balance = nullable(input.openingBalance);
  if (has(input, 'institutionId')) wire.institution_id = nullable(input.institutionId);
  if (has(input, 'archived')) wire.archived = nullable(input.archived);
  if (has(input, 'creditLimit')) wire.credit_limit = nullable(input.creditLimit);
  if (has(input, 'closingDay')) wire.closing_day = nullable(input.closingDay);
  if (has(input, 'dueDay')) wire.due_day = nullable(input.dueDay);
  if (has(input, 'paymentAccountId')) wire.payment_account_id = nullable(input.paymentAccountId);
  if (has(input, 'autoPay')) wire.auto_pay = nullable(input.autoPay);
  return wire;
}

export const mapAccountBalance = (wire: AccountBalanceWire): AccountBalance => ({
  accountId: wire.account_id,
  currency: wire.currency,
  balance: wire.balance,
});

export const mapCardInvoice = (wire: CardInvoiceWire): CardInvoice => ({
  closeDate: wire.close_date,
  dueDate: wire.due_date,
  periodStart: wire.period_start,
  periodEnd: wire.period_end,
  currency: wire.currency,
  total: wire.total,
  paid: wire.paid,
  remaining: wire.remaining,
  status: wire.status,
});

export const mapCardInvoicePayment = (input: CardInvoicePayment): CardInvoicePaymentWire => ({
  account_id: nullable(input.accountId),
  date: nullable(input.date),
  amount: nullable(input.amount),
  description: nullable(input.description),
});

export const mapInstitution = (wire: InstitutionWire): Institution => ({
  id: wire.id,
  name: wire.name,
  icon: wire.icon,
  color: wire.color ?? undefined,
  archived: wire.archived,
  position: wire.position,
});
export const mapInstitutionCreate = (input: Omit<Institution, 'id'>): InstitutionInputWire => ({
  ...input,
  color: nullable(input.color),
});
export function mapInstitutionPatch(input: Partial<Omit<Institution, 'id'>>): InstitutionPatchWire {
  const wire: InstitutionPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'icon')) wire.icon = nullable(input.icon);
  if (has(input, 'color')) wire.color = nullable(input.color);
  if (has(input, 'archived')) wire.archived = nullable(input.archived);
  if (has(input, 'position')) wire.position = nullable(input.position);
  return wire;
}

export const mapCategoryGroup = (wire: CategoryGroupWire): CategoryGroup => ({
  id: wire.id,
  name: wire.name,
  kind: wire.kind,
  color: wire.color,
  icon: wire.icon,
  position: wire.position,
});
export const mapCategoryGroupCreate = (
  input: Omit<CategoryGroup, 'id' | 'position'>,
): CategoryGroupInputWire => ({
  name: input.name,
  kind: input.kind,
  color: input.color,
  icon: input.icon,
});
export function mapCategoryGroupPatch(
  input: Partial<Omit<CategoryGroup, 'id'>>,
): CategoryGroupPatchWire {
  const wire: CategoryGroupPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'kind')) wire.kind = nullable(input.kind);
  if (has(input, 'color')) wire.color = nullable(input.color);
  if (has(input, 'icon')) wire.icon = nullable(input.icon);
  if (has(input, 'position')) wire.position = nullable(input.position);
  return wire;
}

export const mapCategory = (wire: CategoryWire): Category => ({
  id: wire.id,
  name: wire.name,
  kind: wire.kind,
  groupId: wire.group_id,
  color: wire.color,
  icon: wire.icon,
  position: wire.position,
});
export const mapCategoryCreate = (input: Omit<Category, 'id' | 'position'>): CategoryInputWire => ({
  name: input.name,
  kind: input.kind,
  group_id: input.groupId,
  color: input.color,
  icon: input.icon,
});
export function mapCategoryPatch(input: Partial<Omit<Category, 'id'>>): CategoryPatchWire {
  const wire: CategoryPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'kind')) wire.kind = nullable(input.kind);
  if (has(input, 'groupId')) wire.group_id = nullable(input.groupId);
  if (has(input, 'color')) wire.color = nullable(input.color);
  if (has(input, 'icon')) wire.icon = nullable(input.icon);
  if (has(input, 'position')) wire.position = nullable(input.position);
  return wire;
}

export const mapBudget = (wire: BudgetWire): Budget => ({
  id: wire.id,
  groupId: wire.group_id,
  month: wire.month,
  amount: wire.amount,
  currency: wire.currency,
});
export const mapBudgetInput = (input: Omit<Budget, 'id'>): BudgetInputWire => ({
  group_id: input.groupId,
  month: input.month,
  amount: input.amount,
  currency: input.currency,
});
export const mapBudgetAllocation = (wire: BudgetAllocationWire): BudgetAllocation => ({
  id: wire.id,
  groupId: wire.group_id,
  percentage: wire.percentage,
});
export const mapBudgetAllocationInput = (
  input: Omit<BudgetAllocation, 'id'>,
): BudgetAllocationInputWire => ({
  group_id: input.groupId,
  percentage: input.percentage,
});
export const mapExpectedIncome = (wire: ExpectedIncomeWire): ExpectedIncome => ({
  id: wire.id,
  month: wire.month,
  amount: wire.amount,
  currency: wire.currency,
});
export const mapExpectedIncomeInput = (
  input: Omit<ExpectedIncome, 'id'>,
): ExpectedIncomeInputWire => ({
  month: input.month,
  amount: input.amount,
  currency: input.currency,
});

const mapConversion = (wire: ConversionWire): TransactionConversion => ({
  amount: wire.amount!,
  currency: wire.currency,
  fee: wire.fee ?? undefined,
  rate: wire.rate,
  source: wire.source,
});
const mapConversionInput = (input: TransactionConversion): ConversionWire => ({
  amount: input.amount,
  currency: input.currency,
  fee: nullable(input.fee),
  rate: input.rate,
  source: input.source,
});

export const mapTransaction = (wire: TransactionWire): Transaction => ({
  id: wire.id,
  type: wire.type,
  date: wire.date,
  amount: wire.amount,
  currency: wire.currency,
  accountId: wire.account_id,
  toAccountId: wire.to_account_id ?? undefined,
  categoryId: wire.category_id ?? undefined,
  description: wire.description,
  notes: wire.notes ?? undefined,
  recurringRuleId: wire.recurring_rule_id ?? undefined,
  loanId: wire.loan_id ?? undefined,
  cardInvoiceCloseDate: wire.card_invoice_close_date ?? undefined,
  installmentGroupId: wire.installment_group_id ?? undefined,
  installmentNumber: wire.installment_number ?? undefined,
  installmentCount: wire.installment_count ?? undefined,
  conversion: wire.conversion ? mapConversion(wire.conversion) : undefined,
});
export const mapTransactionCreate = (
  input: Omit<Transaction, 'id'> & { installments?: number },
): TransactionInputWire => ({
  type: input.type,
  date: input.date,
  amount: input.amount,
  currency: input.currency,
  account_id: input.accountId,
  to_account_id: nullable(input.toAccountId),
  category_id: nullable(input.categoryId),
  description: input.description,
  notes: nullable(input.notes),
  recurring_rule_id: nullable(input.recurringRuleId),
  loan_id: nullable(input.loanId),
  card_invoice_close_date: nullable(input.cardInvoiceCloseDate),
  conversion: input.conversion ? mapConversionInput(input.conversion) : null,
  ...(input.installments ? { installments: input.installments } : {}),
});
export function mapTransactionPatch(input: Partial<Omit<Transaction, 'id'>>): TransactionPatchWire {
  const wire: TransactionPatchWire = {};
  if (has(input, 'type')) wire.type = nullable(input.type);
  if (has(input, 'date')) wire.date = nullable(input.date);
  if (has(input, 'amount')) wire.amount = nullable(input.amount);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'accountId')) wire.account_id = nullable(input.accountId);
  if (has(input, 'toAccountId')) wire.to_account_id = nullable(input.toAccountId);
  if (has(input, 'categoryId')) wire.category_id = nullable(input.categoryId);
  if (has(input, 'description')) wire.description = nullable(input.description);
  if (has(input, 'notes')) wire.notes = nullable(input.notes);
  if (has(input, 'recurringRuleId')) wire.recurring_rule_id = nullable(input.recurringRuleId);
  if (has(input, 'loanId')) wire.loan_id = nullable(input.loanId);
  if (has(input, 'cardInvoiceCloseDate'))
    wire.card_invoice_close_date = nullable(input.cardInvoiceCloseDate);
  if (has(input, 'conversion'))
    wire.conversion = input.conversion ? mapConversionInput(input.conversion) : null;
  return wire;
}

const mapImportOptions = (options: ImportOptions): ImportOptionsWire => ({
  date_format: options.dateFormat,
  decimal_separator: options.decimalSeparator,
  invert_sign: options.invertSign,
});
export const mapImportPreviewRequest = (
  request: ImportPreviewRequest,
): ImportPreviewRequestWire => ({
  content: request.content,
  account_id: request.accountId,
  mapping: request.mapping ?? null,
  options: mapImportOptions(request.options),
});
export const mapImportPreview = (wire: ImportPreviewWire): ImportPreview => ({
  headers: wire.headers,
  mapping: wire.mapping,
  rows: wire.rows.map((row) => ({
    index: row.index,
    date: row.date ?? undefined,
    description: row.description,
    type: row.type ?? undefined,
    amount: row.amount ?? undefined,
    categoryId: row.category_id ?? undefined,
    categoryName: row.category_name ?? undefined,
    ruleName: row.rule_name ?? undefined,
    notes: row.notes ?? undefined,
    counterpartyAccountId: row.counterparty_account_id ?? undefined,
    counterpartyAccountName: row.counterparty_account_name ?? undefined,
    transferDirection: row.transfer_direction ?? undefined,
    error: row.error ?? undefined,
    duplicate: row.duplicate,
  })),
});

export const mapCategorizationRule = (wire: CategorizationRuleWire): CategorizationRule => ({
  id: wire.id,
  name: wire.name,
  priority: wire.priority,
  isActive: wire.is_active,
  matchOp: wire.match_op,
  conditions: wire.conditions as RuleConditionEntry[],
  categoryId: wire.category_id,
});

export const mapCategorizationRuleCreate = (
  input: Omit<CategorizationRule, 'id'>,
): CategorizationRuleInputWire => ({
  name: input.name,
  priority: input.priority,
  is_active: input.isActive,
  match_op: input.matchOp,
  conditions: input.conditions,
  category_id: input.categoryId,
});

export function mapCategorizationRulePatch(
  input: Partial<Omit<CategorizationRule, 'id'>>,
): CategorizationRulePatchWire {
  const wire: CategorizationRulePatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'priority')) wire.priority = nullable(input.priority);
  if (has(input, 'isActive')) wire.is_active = nullable(input.isActive);
  if (has(input, 'matchOp')) wire.match_op = nullable(input.matchOp);
  if (has(input, 'conditions')) wire.conditions = nullable(input.conditions);
  if (has(input, 'categoryId')) wire.category_id = nullable(input.categoryId);
  return wire;
}

export const mapRulePack = (wire: RulePackWire): RulePack => ({
  code: wire.code,
  ruleCount: wire.rule_count,
  installed: wire.installed,
});

export const mapRuleImportItem = (input: RuleExportItem): RuleImportItemWire => ({
  name: input.name,
  match_op: input.matchOp,
  priority: input.priority,
  is_active: input.isActive,
  category: input.category,
  conditions: input.conditions,
});

const mapRecurringTemplate = (wire: RecurringTemplateWire): RecurringRule['template'] => ({
  type: wire.type,
  amount: wire.amount,
  currency: wire.currency,
  accountId: wire.account_id,
  toAccountId: wire.to_account_id ?? undefined,
  categoryId: wire.category_id ?? undefined,
  description: wire.description,
  notes: wire.notes ?? undefined,
  conversion: wire.conversion ? mapConversion(wire.conversion) : undefined,
});
const mapRecurringTemplateInput = (input: RecurringRule['template']): RecurringTemplateWire => ({
  type: input.type,
  amount: input.amount,
  currency: input.currency,
  account_id: input.accountId,
  to_account_id: nullable(input.toAccountId),
  category_id: nullable(input.categoryId),
  description: input.description,
  notes: nullable(input.notes),
  conversion: input.conversion ? mapConversionInput(input.conversion) : null,
});
export const mapRecurringRule = (wire: RecurringRuleWire): RecurringRule => ({
  id: wire.id,
  frequency: wire.frequency,
  interval: wire.interval,
  startDate: wire.start_date,
  endDate: wire.end_date ?? undefined,
  lastPostedDate: wire.last_posted_date ?? undefined,
  template: mapRecurringTemplate(wire.template),
});
export const mapRecurringRuleCreate = (
  input: Omit<RecurringRule, 'id'>,
): RecurringRuleInputWire => ({
  frequency: input.frequency,
  interval: input.interval,
  start_date: input.startDate,
  end_date: nullable(input.endDate),
  template: mapRecurringTemplateInput(input.template),
});
export function mapRecurringRulePatch(
  input: Partial<Omit<RecurringRule, 'id'>>,
): RecurringRulePatchWire {
  const wire: RecurringRulePatchWire = {};
  if (has(input, 'frequency')) wire.frequency = nullable(input.frequency);
  if (has(input, 'interval')) wire.interval = nullable(input.interval);
  if (has(input, 'startDate')) wire.start_date = nullable(input.startDate);
  if (has(input, 'endDate')) wire.end_date = nullable(input.endDate);
  if (has(input, 'template'))
    wire.template = input.template ? mapRecurringTemplateInput(input.template) : null;
  return wire;
}

export const mapManualRate = (wire: ManualRateWire): ManualRate => ({
  id: wire.id,
  baseCode: wire.base_code,
  quoteCode: wire.quote_code,
  rate: wire.rate,
  asOf: wire.as_of,
});
export const mapExchangeRate = (wire: ExchangeRateWire): ExchangeRate => ({
  baseCode: wire.base_code,
  quoteCode: wire.quote_code,
  rate: wire.rate,
  isFallback: wire.is_fallback,
  source: wire.is_fallback ? 'fallback' : wire.source === 'manual' ? 'manual' : 'quote',
  asOf: wire.as_of,
});
export const mapRateRefresh = (wire: ExchangeRateRefreshWire): RateRefresh => ({
  asOf: wire.as_of,
  updated: wire.updated,
  throttled: wire.throttled,
  refreshedAt: wire.refreshed_at,
});
export const mapGoal = (wire: GoalWire): Goal => ({
  id: wire.id,
  accountId: wire.account_id,
  name: wire.name,
  targetAmount: wire.target_amount,
  currency: wire.currency,
  targetDate: wire.target_date ?? undefined,
  frequency: wire.frequency ?? undefined,
  interval: wire.interval ?? undefined,
  archived: wire.archived,
});
export const mapGoalCreate = (input: Omit<Goal, 'id' | 'accountId'>): GoalWithAccountInputWire => ({
  name: input.name,
  target_amount: input.targetAmount,
  currency: input.currency,
  target_date: nullable(input.targetDate),
  frequency: nullable(input.frequency),
  interval: nullable(input.interval),
  archived: input.archived,
});
export function mapGoalPatch(
  input: Partial<Omit<Goal, 'id' | 'accountId' | 'archived'>>,
): GoalWithAccountPatchWire {
  const wire: GoalWithAccountPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'targetAmount')) wire.target_amount = nullable(input.targetAmount);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'targetDate')) wire.target_date = nullable(input.targetDate);
  if (has(input, 'frequency')) wire.frequency = nullable(input.frequency);
  if (has(input, 'interval')) wire.interval = nullable(input.interval);
  return wire;
}

export const mapLoan = (wire: LoanWire): Loan => ({
  id: wire.id,
  name: wire.name,
  categoryId: wire.category_id,
  currency: wire.currency,
  amountBorrowed: wire.amount_borrowed,
  fees: wire.fees,
  interestRate: wire.interest_rate,
  ratePeriod: wire.rate_period,
  installmentCount: wire.installment_count,
  installmentAmount: wire.installment_amount,
  firstPaymentDate: wire.first_payment_date,
  autoPost: wire.auto_post,
  paymentAccountId: wire.payment_account_id ?? undefined,
  notes: wire.notes ?? undefined,
  archived: wire.archived,
  installmentsPaid: wire.installments_paid,
});
export const mapLoanCreate = (
  input: Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid'>,
): LoanInputWire => ({
  name: input.name,
  category_id: input.categoryId,
  currency: input.currency,
  amount_borrowed: input.amountBorrowed,
  fees: input.fees,
  interest_rate: input.interestRate,
  rate_period: input.ratePeriod,
  installment_count: input.installmentCount,
  first_payment_date: input.firstPaymentDate,
  auto_post: input.autoPost,
  payment_account_id: nullable(input.paymentAccountId),
  notes: nullable(input.notes),
  archived: input.archived,
});
export function mapLoanPatch(
  input: Partial<Omit<Loan, 'id' | 'installmentAmount' | 'installmentsPaid' | 'archived'>>,
): LoanPatchWire {
  const wire: LoanPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'categoryId')) wire.category_id = nullable(input.categoryId);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'amountBorrowed')) wire.amount_borrowed = nullable(input.amountBorrowed);
  if (has(input, 'fees')) wire.fees = nullable(input.fees);
  if (has(input, 'interestRate')) wire.interest_rate = nullable(input.interestRate);
  if (has(input, 'ratePeriod')) wire.rate_period = nullable(input.ratePeriod);
  if (has(input, 'installmentCount')) wire.installment_count = nullable(input.installmentCount);
  if (has(input, 'firstPaymentDate')) wire.first_payment_date = nullable(input.firstPaymentDate);
  if (has(input, 'autoPost')) wire.auto_post = nullable(input.autoPost);
  if (has(input, 'paymentAccountId')) wire.payment_account_id = nullable(input.paymentAccountId);
  if (has(input, 'notes')) wire.notes = nullable(input.notes);
  return wire;
}
export const mapLoanPayment = (input: {
  amount?: string;
  date?: string;
  accountId?: string;
  description?: string;
}): LoanPaymentWire => ({
  amount: nullable(input.amount),
  date: nullable(input.date),
  account_id: nullable(input.accountId),
  description: nullable(input.description),
});

export const mapInvestmentWallet = (wire: InvestmentWalletWire): InvestmentWallet => ({
  id: wire.id,
  accountId: wire.account_id,
  name: wire.name,
  currency: wire.currency,
  cashAccountId: wire.cash_account_id ?? undefined,
  institutionId: wire.institution_id ?? undefined,
  archived: wire.archived,
});
export const mapInvestmentWalletCreate = (
  input: InvestmentWalletCreate,
): InvestmentWalletInputWire => ({
  name: input.name,
  currency: input.currency,
  cash_account_id: nullable(input.cashAccountId),
  institution_id: nullable(input.institutionId),
  archived: input.archived ?? false,
});
export function mapInvestmentWalletPatch(
  input: InvestmentWalletUpdate,
): InvestmentWalletPatchWire {
  const wire: InvestmentWalletPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'cashAccountId')) wire.cash_account_id = nullable(input.cashAccountId);
  if (has(input, 'institutionId')) wire.institution_id = nullable(input.institutionId);
  return wire;
}

export const mapInvestmentAsset = (wire: InvestmentAssetWire): InvestmentAsset => ({
  id: wire.id,
  symbol: wire.symbol,
  name: wire.name,
  assetClass: wire.asset_class,
  currency: wire.currency,
  quoteProvider: wire.quote_provider,
  manualPrice: wire.manual_price ?? undefined,
  archived: wire.archived,
});
export const mapInvestmentAssetCreate = (
  input: InvestmentAssetCreate,
): InvestmentAssetInputWire => ({
  symbol: input.symbol,
  name: input.name,
  asset_class: input.assetClass,
  currency: input.currency,
  quote_provider: input.quoteProvider,
  manual_price: nullable(input.manualPrice),
  archived: input.archived ?? false,
});
export function mapInvestmentAssetPatch(
  input: InvestmentAssetUpdate,
): InvestmentAssetPatchWire {
  const wire: InvestmentAssetPatchWire = {};
  if (has(input, 'symbol')) wire.symbol = nullable(input.symbol);
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'assetClass')) wire.asset_class = nullable(input.assetClass);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'quoteProvider')) wire.quote_provider = nullable(input.quoteProvider);
  if (has(input, 'manualPrice')) wire.manual_price = nullable(input.manualPrice);
  return wire;
}

export const mapInvestmentTransaction = (
  wire: InvestmentTransactionWire,
): InvestmentTransaction => ({
  id: wire.id,
  walletId: wire.wallet_id,
  assetId: wire.asset_id ?? undefined,
  type: wire.type,
  date: wire.date,
  quantity: wire.quantity ?? undefined,
  price: wire.price ?? undefined,
  amount: wire.amount,
  fee: wire.fee,
  currency: wire.currency,
  transactionId: wire.transaction_id ?? undefined,
  notes: wire.notes ?? undefined,
});
export const mapInvestmentTransactionCreate = (
  input: InvestmentTransactionCreate,
): InvestmentTransactionInputWire => ({
  wallet_id: input.walletId,
  asset_id: nullable(input.assetId),
  type: input.type,
  date: input.date,
  quantity: nullable(input.quantity),
  price: nullable(input.price),
  amount: input.amount,
  fee: input.fee,
  currency: input.currency,
  notes: nullable(input.notes),
});
export function mapInvestmentTransactionPatch(
  input: InvestmentTransactionUpdate,
): InvestmentTransactionPatchWire {
  const wire: InvestmentTransactionPatchWire = {};
  if (has(input, 'assetId')) wire.asset_id = nullable(input.assetId);
  if (has(input, 'type')) wire.type = nullable(input.type);
  if (has(input, 'date')) wire.date = nullable(input.date);
  if (has(input, 'quantity')) wire.quantity = nullable(input.quantity);
  if (has(input, 'price')) wire.price = nullable(input.price);
  if (has(input, 'amount')) wire.amount = nullable(input.amount);
  if (has(input, 'fee')) wire.fee = nullable(input.fee);
  if (has(input, 'currency')) wire.currency = nullable(input.currency);
  if (has(input, 'notes')) wire.notes = nullable(input.notes);
  return wire;
}

export const mapInvestmentPosition = (wire: InvestmentPositionWire): InvestmentPosition => ({
  asset: mapInvestmentAsset(wire.asset),
  quantity: wire.quantity,
  averageCost: wire.average_cost,
  bookValue: wire.book_value,
  price: wire.price ?? undefined,
  priceAsOf: wire.price_as_of ?? undefined,
  priceIsStale: wire.price_is_stale,
  marketValue: wire.market_value ?? undefined,
  unrealizedGain: wire.unrealized_gain ?? undefined,
  realizedGain: wire.realized_gain,
  dividendIncome: wire.dividend_income,
  feesPaid: wire.fees_paid,
  marketValueIsFallback: wire.market_value_is_fallback,
});
export const mapInvestmentSummary = (wire: InvestmentSummaryWire): InvestmentSummary => ({
  totalBookValue: wire.total_book_value,
  totalMarketValue: wire.total_market_value ?? undefined,
  totalUnrealizedGain: wire.total_unrealized_gain ?? undefined,
  walletCount: wire.wallet_count,
});

export const mapMarketDataCredentialStatus = (
  wire: MarketDataCredentialStatusWire,
): MarketDataCredentialStatus => ({
  provider: wire.provider,
  configured: wire.configured,
  source: wire.source,
});

export const mapAgentProviderStatus = (wire: AgentProviderStatusWire): AgentProviderStatus => ({
  provider: wire.provider,
  configured: wire.configured,
  source: wire.source,
  authMode: wire.auth_mode ?? undefined,
  authModes: wire.auth_modes,
  accountLabel: wire.account_label ?? undefined,
  model: wire.model,
  defaultModel: wire.default_model,
  models: wire.models,
  reasoningEffort: wire.reasoning_effort ?? undefined,
  reasoningEfforts: wire.reasoning_efforts,
});
export const mapAgentProviderLink = (input: AgentProviderLink): AgentProviderLinkWire => ({
  ...(input.apiKey !== undefined ? { api_key: input.apiKey } : {}),
  ...(input.baseUrl !== undefined ? { base_url: input.baseUrl } : {}),
  ...(input.model !== undefined ? { model: input.model } : {}),
  ...(input.reasoningEffort !== undefined ? { reasoning_effort: input.reasoningEffort } : {}),
});
export const mapAgentOAuthStart = (wire: AgentOAuthStartWire): AgentOAuthStart => ({
  authorizeUrl: wire.authorize_url,
  verifier: wire.verifier,
  state: wire.state,
});
export const mapAgentProviderTest = (wire: AgentProviderTestWire): AgentProviderTestResult => ({
  ok: wire.ok,
  errorCode: wire.error_code ?? undefined,
});
