import type { Account, AccountBalance } from '../../domain/models/account';
import type { Budget } from '../../domain/models/budget';
import type { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import type { Category } from '../../domain/models/category';
import type { ExchangeRate } from '../../domain/models/exchange-rate';
import type { Goal } from '../../domain/models/goal';
import type { Institution } from '../../domain/models/institution';
import type { ManualRate } from '../../domain/models/manual-rate';
import type { RecurringRule } from '../../domain/models/recurring';
import type { Transaction, TransactionConversion } from '../../domain/models/transaction';
import type {
  AccountBalanceWire,
  AccountInputWire,
  AccountPatchWire,
  AccountWire,
  BudgetAllocationInputWire,
  BudgetAllocationWire,
  BudgetInputWire,
  BudgetWire,
  CategoryInputWire,
  CategoryPatchWire,
  CategoryWire,
  ConversionWire,
  ExchangeRateWire,
  ExpectedIncomeInputWire,
  ExpectedIncomeWire,
  GoalWire,
  GoalWithAccountInputWire,
  GoalWithAccountPatchWire,
  InstitutionInputWire,
  InstitutionPatchWire,
  InstitutionWire,
  ManualRateWire,
  RecurringRuleInputWire,
  RecurringRulePatchWire,
  RecurringRuleWire,
  RecurringTemplateWire,
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
  return wire;
}

export const mapAccountBalance = (wire: AccountBalanceWire): AccountBalance => ({
  accountId: wire.account_id,
  currency: wire.currency,
  balance: wire.balance,
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

export const mapCategory = (wire: CategoryWire): Category => ({
  id: wire.id,
  name: wire.name,
  kind: wire.kind,
  parentId: wire.parent_id ?? undefined,
  color: wire.color,
  icon: wire.icon,
  archived: wire.archived,
  position: wire.position,
});
export const mapCategoryCreate = (input: Omit<Category, 'id' | 'position'>): CategoryInputWire => ({
  name: input.name,
  kind: input.kind,
  parent_id: nullable(input.parentId),
  color: input.color,
  icon: input.icon,
  archived: input.archived,
});
export function mapCategoryPatch(input: Partial<Omit<Category, 'id'>>): CategoryPatchWire {
  const wire: CategoryPatchWire = {};
  if (has(input, 'name')) wire.name = nullable(input.name);
  if (has(input, 'kind')) wire.kind = nullable(input.kind);
  if (has(input, 'parentId')) wire.parent_id = nullable(input.parentId);
  if (has(input, 'color')) wire.color = nullable(input.color);
  if (has(input, 'icon')) wire.icon = nullable(input.icon);
  if (has(input, 'archived')) wire.archived = nullable(input.archived);
  if (has(input, 'position')) wire.position = nullable(input.position);
  return wire;
}

export const mapBudget = (wire: BudgetWire): Budget => ({
  id: wire.id,
  categoryId: wire.category_id,
  month: wire.month,
  amount: wire.amount,
  currency: wire.currency,
});
export const mapBudgetInput = (input: Omit<Budget, 'id'>): BudgetInputWire => ({
  category_id: input.categoryId,
  month: input.month,
  amount: input.amount,
  currency: input.currency,
});
export const mapBudgetAllocation = (wire: BudgetAllocationWire): BudgetAllocation => ({
  id: wire.id,
  categoryId: wire.category_id,
  percentage: wire.percentage,
});
export const mapBudgetAllocationInput = (
  input: Omit<BudgetAllocation, 'id'>,
): BudgetAllocationInputWire => ({
  category_id: input.categoryId,
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
  conversion: wire.conversion ? mapConversion(wire.conversion) : undefined,
});
export const mapTransactionCreate = (input: Omit<Transaction, 'id'>): TransactionInputWire => ({
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
  conversion: input.conversion ? mapConversionInput(input.conversion) : null,
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
  if (has(input, 'conversion'))
    wire.conversion = input.conversion ? mapConversionInput(input.conversion) : null;
  return wire;
}

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
