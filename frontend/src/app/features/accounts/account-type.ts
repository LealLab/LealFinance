import { AccountType } from '../../domain/models/account';
import { IconName } from '../../shared/ui/icon/icon';

export interface AccountTypeOption {
  type: AccountType;
  labelKey: string;
  icon: IconName;
}

/**
 * One entry per AccountType, each carrying its own translation key as a
 * plain field - deliberately not a function called with the type from
 * templates. transloco-keys-manager's template extractor can follow a
 * translation call whose argument is a plain property path, but not one
 * whose argument is itself a function call - the same reason
 * layout/sidebar.ts's NAV_ITEMS carries its labels as data instead of
 * building them at the call site. Display order for both the type
 * <select> and the accounts-list grouping.
 *
 * These keys are only ever reached through that property path (never a
 * literal call the extractor can follow), so - again as in sidebar.ts -
 * they need restating here as a literal "dynamic markings" block:
 * t(accounts.type.checking, accounts.type.savings, accounts.type.cash, accounts.type.credit_card, accounts.type.investment, accounts.type.goal)
 */
export const ACCOUNT_TYPE_OPTIONS: readonly AccountTypeOption[] = [
  { type: 'checking', labelKey: 'accounts.type.checking', icon: 'wallet' },
  { type: 'savings', labelKey: 'accounts.type.savings', icon: 'archive' },
  { type: 'cash', labelKey: 'accounts.type.cash', icon: 'wallet' },
  { type: 'credit_card', labelKey: 'accounts.type.credit_card', icon: 'swap' },
  { type: 'investment', labelKey: 'accounts.type.investment', icon: 'chart' },
  { type: 'goal', labelKey: 'accounts.type.goal', icon: 'target' }
];

const OPTIONS_BY_TYPE = new Map<AccountType, AccountTypeOption>(
  ACCOUNT_TYPE_OPTIONS.map((option) => [option.type, option])
);

export function accountTypeOption(type: AccountType): AccountTypeOption {
  const option = OPTIONS_BY_TYPE.get(type);
  if (!option) throw new Error(`Unknown account type: ${type}`);
  return option;
}
