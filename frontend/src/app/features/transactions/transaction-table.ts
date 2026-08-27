import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Transaction } from '../../domain/models/transaction';
import { SortOrder, TransactionSort } from '../../data/transaction.repository';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';
import { TransactionColumn } from './transaction-columns';
import { rowSign, rowToneClass } from './transaction-tone';

/** A page number, or an elision marker between runs of them. */
type PageToken = number | '…';

/**
 * The flat, sortable transactions table with per-row selection and a
 * pagination footer. Purely presentational - every piece of state comes in
 * as an input and every change goes out as an output.
 */
@Component({
  selector: 'app-transaction-table',
  imports: [TranslocoDirective, MoneyPipe, Badge, Button, Icon],
  templateUrl: './transaction-table.html',
  styleUrl: './transaction-table.scss',
})
export class TransactionTable {
  readonly rows = input.required<readonly Transaction[]>();
  readonly accountsById = input.required<ReadonlyMap<string, Account>>();
  readonly categoriesById = input.required<ReadonlyMap<string, Category>>();
  readonly columns = input.required<ReadonlySet<TransactionColumn>>();
  readonly selectedIds = input.required<ReadonlySet<string>>();
  readonly sort = input.required<TransactionSort>();
  readonly order = input.required<SortOrder>();
  readonly loading = input(false);
  readonly page = input.required<number>();
  readonly pageCount = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageSizes = input.required<readonly number[]>();

  readonly sortChange = output<TransactionSort>();
  readonly toggleRow = output<string>();
  readonly toggleAll = output<boolean>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly edit = output<Transaction>();
  readonly remove = output<Transaction>();

  protected readonly rowToneClass = rowToneClass;
  protected readonly rowSign = rowSign;

  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((r) => this.selectedIds().has(r.id)),
  );
  protected readonly someSelected = computed(() =>
    this.rows().some((r) => this.selectedIds().has(r.id)),
  );

  protected readonly showingFrom = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  protected readonly showingTo = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total()),
  );

  /** ‹ 1 … 6 7 8 … 42 › - at most 7 slots, always first/last/current. */
  protected readonly pageNumbers = computed<PageToken[]>(() => {
    const count = this.pageCount();
    const current = this.page();
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

    const pages = new Set<number>([1, count, current, current - 1, current + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);

    const tokens: PageToken[] = [];
    let previous = 0;
    for (const p of sorted) {
      if (p - previous > 1) tokens.push('…');
      tokens.push(p);
      previous = p;
    }
    return tokens;
  });

  protected isSorted(column: TransactionSort): 'ascending' | 'descending' | 'none' {
    if (this.sort() !== column) return 'none';
    return this.order() === 'asc' ? 'ascending' : 'descending';
  }

  protected category(tx: Transaction): Category | undefined {
    return tx.categoryId ? this.categoriesById().get(tx.categoryId) : undefined;
  }

  protected accountName(id: string | undefined): string {
    return id ? (this.accountsById().get(id)?.name ?? '') : '';
  }

  protected onToggleAll(event: Event): void {
    this.toggleAll.emit((event.target as HTMLInputElement).checked);
  }
}
