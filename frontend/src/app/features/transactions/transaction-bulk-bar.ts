import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Transaction } from '../../domain/models/transaction';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Dropdown } from '../../shared/ui/dropdown/dropdown';
import { Icon } from '../../shared/ui/icon/icon';
import { groupCategoriesByGroup } from './category-grouping';

/**
 * Floating action bar shown while one or more table rows are selected.
 * Offers exactly two bulk actions - assign a category, or delete.
 */
@Component({
  selector: 'app-transaction-bulk-bar',
  imports: [TranslocoDirective, MoneyPipe, Button, Dropdown, Icon],
  templateUrl: './transaction-bulk-bar.html',
})
export class TransactionBulkBar {
  readonly selected = input.required<readonly Transaction[]>();
  readonly categories = input.required<readonly Category[]>();
  readonly categoryGroups = input.required<readonly CategoryGroup[]>();
  readonly displayCurrency = input.required<string>();
  /** Signed sum of the selection in the display currency; null while rates
   * aren't ready. */
  readonly signedTotal = input<string | null>(null);
  readonly busy = input(false);

  readonly assignCategory = output<string>();
  readonly deleteSelected = output<void>();
  readonly clear = output<void>();

  /**
   * Bulk-categorize can't touch transfers/interest (DB CHECK) and a
   * category's kind must match every row, so the picker is only offered for
   * a homogeneous income-or-expense selection.
   */
  protected readonly assignableKind = computed<'income' | 'expense' | null>(() => {
    const types = new Set(this.selected().map((tx) => tx.type));
    if (types.size !== 1) return null;
    const [type] = types;
    return type === 'income' || type === 'expense' ? type : null;
  });

  protected readonly categoryOptions = computed(() =>
    groupCategoriesByGroup(
      this.categories().filter((category) => category.kind === this.assignableKind()),
      this.categoryGroups(),
    ),
  );
}
