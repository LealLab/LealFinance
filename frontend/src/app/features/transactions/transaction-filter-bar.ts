import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Institution } from '../../domain/models/institution';
import { TransactionType } from '../../domain/models/transaction';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';
import { Modal } from '../../shared/ui/modal/modal';
import { groupCategoriesByGroup } from './category-grouping';
import { activeChips, clearChip, FilterChip, TransactionFilters } from './transaction-filters';

const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];

/**
 * The filter bar: a search box, the everyday filters (type, account,
 * category) inline from `md` up, and a "Filters" button that opens every
 * filter in one sheet (bottom sheet on phones, where the inline selects are
 * hidden and the sheet also carries type/account/category). Active filters
 * show as removable chips - a horizontal rail on phones, wrapped on wider
 * screens.
 *
 * All filter state is owned by the parent - this component only emits
 * `filtersChange` / `searchChange`. Search is debounced by the parent, so
 * this fires `searchChange` on every keystroke.
 *
 * Chip labels and values are looked up through `chip.labelKey` /
 * `activeChips`, so transloco-keys-manager can't see them statically:
 * t(transactions.filters.account, transactions.filters.category, transactions.filters.group, transactions.filters.institution, transactions.filters.type, transactions.filters.date, transactions.filters.amount, transactions.filters.dateRange, transactions.filters.amountRange, transactions.filters.removeChip)
 */
@Component({
  selector: 'app-transaction-filter-bar',
  imports: [TranslocoDirective, Button, Icon, Modal],
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

  protected readonly sheetOpen = signal(false);

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

  protected readonly hasActive = computed(() => this.chips().length > 0 || this.search() !== '');

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
    this.sheetOpen.set(false);
    this.clearAll.emit();
  }
}
