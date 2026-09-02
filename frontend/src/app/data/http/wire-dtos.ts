import type { AccountType } from '../../domain/models/account';
import type { CardInvoiceStatus } from '../../domain/models/card-invoice';
import type {
  AgentAuthMode,
  AgentCredentialSource,
  AgentProviderId,
  AgentReasoningEffort,
} from '../../domain/models/agent-provider';
import type { CategoryKind } from '../../domain/models/category';
import type { RecurringFrequency } from '../../domain/models/recurring';
import type { ConversionSource, TransactionType } from '../../domain/models/transaction';
import type {
  InvestmentAssetClass,
  InvestmentQuoteProvider,
  InvestmentTransactionType,
} from '../../domain/models/investment';
import type {
  MarketDataCredentialSource,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
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
  payment_account_id: string | null;
  auto_pay: boolean;
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

export interface CategoryGroupWire {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: IconName;
  position: number;
}
export type CategoryGroupInputWire = Omit<CategoryGroupWire, 'id' | 'position'>;
export type CategoryGroupPatchWire = NullablePatch<Omit<CategoryGroupWire, 'id'>>;

export interface CategoryWire {
  id: string;
  name: string;
  kind: CategoryKind;
  group_id: string;
  color: string;
  icon: IconName;
  position: number;
}
export type CategoryInputWire = Omit<CategoryWire, 'id' | 'position'>;
export type CategoryPatchWire = NullablePatch<Omit<CategoryWire, 'id'>>;

export interface BudgetWire {
  id: string;
  group_id: string;
  month: string;
  amount: string;
  currency: string;
}
export type BudgetInputWire = Omit<BudgetWire, 'id'>;

export interface BudgetAllocationWire {
  id: string;
  group_id: string;
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
  loan_id: string | null;
  card_invoice_close_date: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  conversion: ConversionWire | null;
}
/** `installments` is create-only - it makes the backend write N rows. The
 * stored installment_* fields are read-only, so they're dropped from the
 * input/patch shapes. */
type TransactionWritableWire = Omit<
  TransactionWire,
  'id' | 'installment_group_id' | 'installment_number' | 'installment_count'
>;
export type TransactionInputWire = TransactionWritableWire & { installments?: number };
export type TransactionPatchWire = NullablePatch<TransactionWritableWire>;

export interface LoanWire {
  id: string;
  name: string;
  category_id: string;
  currency: string;
  amount_borrowed: string;
  fees: string;
  interest_rate: string;
  rate_period: 'annual' | 'monthly';
  installment_count: number;
  installment_amount: string;
  first_payment_date: string;
  auto_post: boolean;
  payment_account_id: string | null;
  notes: string | null;
  archived: boolean;
  installments_paid: number;
}
export type LoanInputWire = Omit<LoanWire, 'id' | 'installment_amount' | 'installments_paid'>;
export type LoanPatchWire = NullablePatch<Omit<LoanInputWire, 'archived'>>;
export interface LoanPaymentWire {
  amount?: string | null;
  date?: string | null;
  account_id?: string | null;
  description?: string | null;
}

export interface ImportOptionsWire {
  date_format: 'auto' | 'iso' | 'dmy' | 'mdy';
  decimal_separator: 'auto' | '.' | ',';
  invert_sign: boolean;
}

export interface ImportPreviewRequestWire {
  content: string;
  account_id: string;
  mapping: Record<string, string> | null;
  options: ImportOptionsWire;
}

export interface ImportRowWire {
  index: number;
  date: string | null;
  description: string;
  type: 'income' | 'expense' | null;
  amount: string | null;
  category_id: string | null;
  category_name: string | null;
  rule_name: string | null;
  notes: string | null;
  error: string | null;
  duplicate: boolean;
}

export interface ImportPreviewWire {
  headers: string[];
  mapping: Record<string, string | null>;
  rows: ImportRowWire[];
}

export interface ImportCommitWire {
  created: number;
}

export interface AccountBalanceWire {
  account_id: string;
  currency: string;
  balance: string;
}

export interface CardInvoiceWire {
  close_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: string;
  paid: string;
  remaining: string;
  status: CardInvoiceStatus;
}

export interface CardInvoicePaymentWire {
  account_id: string | null;
  date: string | null;
  amount: string | null;
  description: string | null;
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

export interface CategorizationRuleWire {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  match_op: 'and' | 'or';
  conditions: unknown[];
  category_id: string;
}
export type CategorizationRuleInputWire = Omit<CategorizationRuleWire, 'id'>;
export type CategorizationRulePatchWire = NullablePatch<CategorizationRuleInputWire>;

export interface RulePackWire {
  code: string;
  rule_count: number;
  installed: boolean;
}

export interface RuleImportItemWire {
  name: string;
  match_op: 'and' | 'or';
  priority: number;
  is_active: boolean;
  category: string;
  conditions: unknown[];
}

export interface RuleImportRequestWire {
  rules: RuleImportItemWire[];
  replace: boolean;
}

export interface RuleImportResultWire {
  imported: number;
  skipped: number;
}

export interface RulePackInstallResultWire {
  installed: number;
  skipped: number;
}

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

export interface ExchangeRateRefreshWire {
  as_of: string;
  updated: number;
  throttled: boolean;
  refreshed_at: string | null;
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

export interface InvestmentWalletWire {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  cash_account_id: string | null;
  institution_id: string | null;
  archived: boolean;
}
export type InvestmentWalletInputWire = Omit<InvestmentWalletWire, 'id' | 'account_id'>;
export type InvestmentWalletPatchWire = NullablePatch<
  Omit<InvestmentWalletInputWire, 'archived'>
>;

export interface InvestmentAssetWire {
  id: string;
  symbol: string;
  name: string;
  asset_class: InvestmentAssetClass;
  currency: string;
  quote_provider: InvestmentQuoteProvider;
  manual_price: string | null;
  archived: boolean;
}
export type InvestmentAssetInputWire = Omit<InvestmentAssetWire, 'id'>;
export type InvestmentAssetPatchWire = NullablePatch<InvestmentAssetInputWire>;

export interface InvestmentTransactionWire {
  id: string;
  wallet_id: string;
  asset_id: string | null;
  type: InvestmentTransactionType;
  date: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  currency: string;
  transaction_id: string | null;
  notes: string | null;
}
export type InvestmentTransactionInputWire = Omit<InvestmentTransactionWire, 'id' | 'transaction_id'>;
export type InvestmentTransactionPatchWire = NullablePatch<
  Omit<InvestmentTransactionInputWire, 'wallet_id'>
>;

export interface InvestmentPositionWire {
  asset: InvestmentAssetWire;
  quantity: string;
  average_cost: string;
  book_value: string;
  price: string | null;
  price_as_of: string | null;
  price_is_stale: boolean;
  market_value: string | null;
  unrealized_gain: string | null;
  realized_gain: string;
  dividend_income: string;
  fees_paid: string;
  market_value_is_fallback: boolean;
}

export interface InvestmentSummaryWire {
  total_book_value: string;
  total_market_value: string | null;
  total_unrealized_gain: string | null;
  wallet_count: number;
}

export interface MarketDataCredentialStatusWire {
  provider: MarketDataProvider;
  configured: boolean;
  source: MarketDataCredentialSource;
}

export interface AgentProviderStatusWire {
  provider: AgentProviderId;
  configured: boolean;
  source: AgentCredentialSource;
  auth_mode: AgentAuthMode | null;
  auth_modes: string[];
  account_label: string | null;
  model: string;
  default_model: string;
  models: string[];
  reasoning_effort: AgentReasoningEffort | null;
  reasoning_efforts: string[];
}

export interface AgentProviderLinkWire {
  api_key?: string;
  base_url?: string;
  model?: string;
  reasoning_effort?: AgentReasoningEffort;
}

export interface AgentOAuthStartWire {
  authorize_url: string;
  verifier: string;
  state: string;
}

export interface AgentOAuthCompleteWire {
  verifier: string;
  state: string;
  code: string;
}

export interface AgentProviderTestWire {
  ok: boolean;
  error_code: string | null;
}
