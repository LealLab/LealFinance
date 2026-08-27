import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Institution } from '../../domain/models/institution';
import { TransactionType } from '../../domain/models/transaction';
import { Button } from '../../shared/ui/button/button';
import { Dropdown } from '../../shared/ui/dropdown/dropdown';
import { Icon } from '../../shared/ui/icon/icon';
import { groupCategoriesByGroup } from './category-grouping';
import { activeChips, clearChip, FilterChip, TransactionFilters } from './transaction-filters';

type FilterKey = 'account' | 'category' | 'group' | 'institution' | 'type' | 'date' | 'amount';

const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];

/**
 * The collapsed filter bar: a search box, a row of removable chips for the
 * active filters, and a two-level "Filters" dropdown (a list of filter
 * names; picking one drills into its control).
 *
 * All filter state is owned by the parent - this component only emits
 * `filtersChange` / `searchChange`. Search is debounced by the parent, so
 * this fires `searchChange` on every keystroke.
 *
 * The filter-row labels and chip values are looked up through `row.labelKey`
 * / `activeChips`, so transloco-keys-manager can't see them statically:
 * t(transactions.filters.account, transactions.filters.category, transactions.filters.group, transactions.filters.institution, transactions.filters.type, transactions.filters.date, transactions.filters.amount, transactions.filters.dateRange, transactions.filters.amountRange, transactions.filters.removeChip)
 */
@Component({
  selector: 'app-transaction-filter-bar',
  imports: [TranslocoDirective, Button, Dropdown, Icon],
  templateUrl: './transaction-filter-bar.html',
  styleUrl: './transaction-filter-bar.scss',
})
export class TransactionFilterBar {
  private readonly transloco = inject(TranslocoService);
  private readonly locale = inject(TranslocoLocaleService);

  readonly filters = input.required<TransactionFilters>();
  readonly search = input('');
  readonly accounts = input.required<readonly Account[]>();
  readonly categories = input.required<readonly Category[]>();
  readonly groups = input.required<readonly CategoryGroup[]>();
  readonly institutions = input.required<readonly Institution[]>();

  readonly filtersChange = output<TransactionFilters>();
  readonly searchChange = output<string>();
  readonly clearAll = output<void>();

  protected readonly menuOpen = signal(false);
  /** Which filter's control is expanded in the dropdown; null = the list. */
  protected readonly submenu = signal<FilterKey | null>(null);

  protected readonly transactionTypes = TRANSACTION_TYPES;

  protected readonly categoryOptions = computed(() =>
    groupCategoriesByGroup(this.categories(), this.groups()),
  );

  protected readonly chips = computed<FilterChip[]>(() =>
    activeChips(this.filters(), {
      accountsById: new Map(this.accounts().map((a) => [a.id, a])),
      categoriesById: new Map(this.categories().map((c) => [c.id, c])),
      groupsById: new Map(this.groups().map((g) => [g.id, g])),
      institutionsById: new Map(this.institutions().map((i) => [i.id, i])),
      t: (key, params) => this.transloco.translate(key, params),
      formatDate: (iso) => this.locale.localizeDate(iso, undefined, { dateStyle: 'medium' }),
    }),
  );

  protected openMenu(): void {
    this.submenu.set(null);
  }

  protected patch<K extends keyof TransactionFilters>(
    key: K,
    value: TransactionFilters[K],
  ): void {
    this.filtersChange.emit({ ...this.filters(), [key]: value });
  }

  protected removeChip(key: FilterChip['key']): void {
    this.filtersChange.emit(clearChip(this.filters(), key));
  }

  protected onSearch(value: string): void {
    this.searchChange.emit(value);
  }

  protected clear(): void {
    this.menuOpen.set(false);
    this.clearAll.emit();
  }
}
