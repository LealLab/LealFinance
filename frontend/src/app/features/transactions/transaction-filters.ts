import { TransactionFilters as RepoFilters } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Institution } from '../../domain/models/institution';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { IconName } from '../../shared/ui/icon/icon';

/**
 * The transactions page's own filter model - a flat record of non-optional
 * strings, easy to bind to `<select>`/`<input>` and to reset in one shot.
 * The repository's own `TransactionFilters` (all fields optional) is the
 * wire shape `toQuery` maps this onto.
 */
export interface TransactionFilters {
  accountId: string;
  categoryId: string;
  groupId: string;
  institutionId: string;
  type: TransactionType | '';
  from: string;
  to: string;
  amountMin: string;
  amountMax: string;
  /** Kept for matchesFilters() on projected rows; the paginated query uses
   * a separately debounced copy of the search text. */
  search: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  accountId: '',
  categoryId: '',
  groupId: '',
  institutionId: '',
  type: '',
  from: '',
  to: '',
  amountMin: '',
  amountMax: '',
  search: '',
};

/** A removable active-filter pill. `key` names the field(s) "remove" clears. */
export interface FilterChip {
  key: 'account' | 'category' | 'group' | 'institution' | 'type' | 'date' | 'amount';
  icon: IconName;
  /** Transloco key for the filter's name (e.g. 'transactions.filters.account'). */
  labelKey: string;
  /** Already-localised current value. */
  value: string;
}

export interface ChipContext {
  accountsById: ReadonlyMap<string, Account>;
  categoriesById: ReadonlyMap<string, Category>;
  groupsById: ReadonlyMap<string, CategoryGroup>;
  institutionsById: ReadonlyMap<string, Institution>;
  /** Translates a key with optional params. */
  t: (key: string, params?: Record<string, unknown>) => string;
  formatDate: (iso: string) => string;
}

/** The active filters as chips, in a stable display order. */
export function activeChips(f: TransactionFilters, ctx: ChipContext): FilterChip[] {
  const chips: FilterChip[] = [];

  if (f.accountId) {
    chips.push({
      key: 'account',
      icon: 'bank',
      labelKey: 'transactions.filters.account',
      value: ctx.accountsById.get(f.accountId)?.name ?? f.accountId,
    });
  }
  if (f.categoryId) {
    chips.push({
      key: 'category',
      icon: 'tag',
      labelKey: 'transactions.filters.category',
      value: ctx.categoriesById.get(f.categoryId)?.name ?? f.categoryId,
    });
  }
  if (f.groupId) {
    chips.push({
      key: 'group',
      icon: 'grip',
      labelKey: 'transactions.filters.group',
      value: ctx.groupsById.get(f.groupId)?.name ?? f.groupId,
    });
  }
  if (f.institutionId) {
    chips.push({
      key: 'institution',
      icon: 'building',
      labelKey: 'transactions.filters.institution',
      value: ctx.institutionsById.get(f.institutionId)?.name ?? f.institutionId,
    });
  }
  if (f.type) {
    chips.push({
      key: 'type',
      icon: 'swap',
      labelKey: 'transactions.filters.type',
      value: ctx.t('transactions.type.' + f.type),
    });
  }
  if (f.from || f.to) {
    chips.push({
      key: 'date',
      icon: 'calendar',
      labelKey: 'transactions.filters.date',
      value: ctx.t('transactions.filters.dateRange', {
        from: f.from ? ctx.formatDate(f.from) : '…',
        to: f.to ? ctx.formatDate(f.to) : '…',
      }),
    });
  }
  if (f.amountMin || f.amountMax) {
    chips.push({
      key: 'amount',
      icon: 'coins',
      labelKey: 'transactions.filters.amount',
      value: ctx.t('transactions.filters.amountRange', {
        min: f.amountMin || '…',
        max: f.amountMax || '…',
      }),
    });
  }

  return chips;
}

/** Clears the field(s) a chip's `key` covers, returning a new filter object. */
export function clearChip(f: TransactionFilters, key: FilterChip['key']): TransactionFilters {
  switch (key) {
    case 'account':
      return { ...f, accountId: '' };
    case 'category':
      return { ...f, categoryId: '' };
    case 'group':
      return { ...f, groupId: '' };
    case 'institution':
      return { ...f, institutionId: '' };
    case 'type':
      return { ...f, type: '' };
    case 'date':
      return { ...f, from: '', to: '' };
    case 'amount':
      return { ...f, amountMin: '', amountMax: '' };
  }
}

/** Maps the UI filter model onto the repository's wire filters (the fields
 * other than type/search/sort/paging, which the caller adds). */
export function toQuery(
  f: TransactionFilters,
): Pick<
  RepoFilters,
  | 'accountId'
  | 'categoryId'
  | 'groupId'
  | 'institutionId'
  | 'dateFrom'
  | 'dateTo'
  | 'amountMin'
  | 'amountMax'
> {
  return {
    accountId: f.accountId || undefined,
    categoryId: f.categoryId || undefined,
    groupId: f.groupId || undefined,
    institutionId: f.institutionId || undefined,
    dateFrom: f.from || undefined,
    dateTo: f.to || undefined,
    amountMin: f.amountMin || undefined,
    amountMax: f.amountMax || undefined,
  };
}

/**
 * Client-side filter predicate - used only for the projected/recurring
 * ghost rows, which never hit the server. Shaped closely enough to
 * `Transaction` that one predicate covers both. `accountsById` resolves
 * each leg's account for the institution check; `categoriesById` resolves
 * a category's group for the group check.
 */
export function matchesFilters(
  tx: Pick<
    Transaction,
    'type' | 'accountId' | 'toAccountId' | 'categoryId' | 'description' | 'date' | 'amount' | 'currency'
  >,
  filters: TransactionFilters,
  accountsById: ReadonlyMap<string, Account>,
  categoriesById?: ReadonlyMap<string, Category>,
): boolean {
  if (filters.type && tx.type !== filters.type) return false;
  if (
    filters.accountId &&
    tx.accountId !== filters.accountId &&
    tx.toAccountId !== filters.accountId
  ) {
    return false;
  }
  if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
  if (filters.groupId) {
    const group = tx.categoryId ? categoriesById?.get(tx.categoryId)?.groupId : undefined;
    if (group !== filters.groupId) return false;
  }
  if (filters.from && tx.date < filters.from) return false;
  if (filters.to && tx.date > filters.to) return false;
  if (filters.amountMin && Number(tx.amount) < Number(filters.amountMin)) return false;
  if (filters.amountMax && Number(tx.amount) > Number(filters.amountMax)) return false;
  if (
    filters.search &&
    !tx.description.toLowerCase().includes(filters.search.toLowerCase())
  ) {
    return false;
  }
  if (filters.institutionId) {
    const fromInstitutionId = accountsById.get(tx.accountId)?.institutionId;
    const toInstitutionId = tx.toAccountId
      ? accountsById.get(tx.toAccountId)?.institutionId
      : undefined;
    if (
      fromInstitutionId !== filters.institutionId &&
      toInstitutionId !== filters.institutionId
    ) {
      return false;
    }
  }
  return true;
}
