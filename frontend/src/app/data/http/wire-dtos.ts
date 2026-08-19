import type { AccountType } from '../../domain/models/account';
import type { CategoryKind } from '../../domain/models/category';
import type { RecurringFrequency } from '../../domain/models/recurring';
import type { ConversionSource, TransactionType } from '../../domain/models/transaction';
import type { IconName } from '../../shared/ui/icon/icon';

type NullablePatch<T> = { [K in keyof T]?: T[K] | null };

export interface AccountWire {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: string;
  institution_id: string | null;
  archived: boolean;
  credit_limit: string | null;
  closing_day: number | null;
  due_day: number | null;
}

export type AccountInputWire = Omit<AccountWire, 'id'>;
export type AccountPatchWire = NullablePatch<AccountInputWire>;

export interface InstitutionWire {
  id: string;
  name: string;
  icon: IconName;
  color: string | null;
  archived: boolean;
  position: number;
}
export type InstitutionInputWire = Omit<InstitutionWire, 'id'>;
export type InstitutionPatchWire = NullablePatch<InstitutionInputWire>;

export interface CategoryWire {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string;
  icon: IconName;
  archived: boolean;
  position: number;
}
export type CategoryInputWire = Omit<CategoryWire, 'id' | 'position'>;
export type CategoryPatchWire = NullablePatch<Omit<CategoryWire, 'id'>>;

export interface BudgetWire {
  id: string;
  category_id: string;
  month: string;
  amount: string;
  currency: string;
}
export type BudgetInputWire = Omit<BudgetWire, 'id'>;

export interface BudgetAllocationWire {
  id: string;
  category_id: string;
  percentage: string;
}
export type BudgetAllocationInputWire = Omit<BudgetAllocationWire, 'id'>;

export interface ExpectedIncomeWire {
  id: string;
  month: string;
  amount: string;
  currency: string;
}
export type ExpectedIncomeInputWire = Omit<ExpectedIncomeWire, 'id'>;

export interface ConversionWire {
  amount: string | null;
  currency: string;
  fee: string | null;
  rate: string;
  source: ConversionSource;
}

export interface TransactionWire {
  id: string;
  type: TransactionType;
  date: string;
  amount: string;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  notes: string | null;
  recurring_rule_id: string | null;
  conversion: ConversionWire | null;
}
export type TransactionInputWire = Omit<TransactionWire, 'id'>;
export type TransactionPatchWire = NullablePatch<TransactionInputWire>;

export interface AccountBalanceWire {
  account_id: string;
  currency: string;
  balance: string;
}

export interface RecurringTemplateWire {
  type: TransactionType;
  amount: string;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  notes: string | null;
  conversion: ConversionWire | null;
}

export interface RecurringRuleWire {
  id: string;
  frequency: RecurringFrequency;
  interval: number;
  start_date: string;
  end_date: string | null;
  last_posted_date: string | null;
  template: RecurringTemplateWire;
}
// last_posted_date is a server-managed posting cursor - never written by the client.
export type RecurringRuleInputWire = Omit<RecurringRuleWire, 'id' | 'last_posted_date'>;
export type RecurringRulePatchWire = NullablePatch<RecurringRuleInputWire>;

export interface ManualRateWire {
  id: string;
  base_code: string;
  quote_code: string;
  rate: string;
  as_of: string;
}

export interface ExchangeRateWire {
  base_code: string;
  quote_code: string;
  rate: string;
  is_fallback: boolean;
  source: string;
  as_of: string;
}

export interface GoalWire {
  id: string;
  account_id: string;
  name: string;
  target_amount: string;
  currency: string;
  target_date: string | null;
  frequency: RecurringFrequency | null;
  interval: number | null;
  archived: boolean;
}

export type GoalWithAccountInputWire = Omit<GoalWire, 'id' | 'account_id'>;
export type GoalWithAccountPatchWire = NullablePatch<Omit<GoalWithAccountInputWire, 'archived'>>;
export interface GoalWithAccountWire {
  goal: GoalWire;
  account: AccountWire;
}
