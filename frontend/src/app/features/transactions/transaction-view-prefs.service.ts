import { computed, effect, Injectable, signal } from '@angular/core';
import {
  DEFAULT_COLUMNS,
  DEFAULT_WIDTHS,
  isTransactionColumn,
  MIN_COLUMN_WIDTH,
  TransactionColumn,
} from './transaction-columns';

const STORAGE_KEY = 'lealfinance.transactions.view';
/** All <= the backend's `limit` cap of 200. */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

interface StoredPrefs {
  pageSize: number;
  columns: TransactionColumn[];
  widths: Partial<Record<TransactionColumn, number>>;
}

/**
 * Persists the transactions table's view settings - page size, visible
 * columns, order, and widths - to localStorage, in the shape of
 * CategoryCollapseService: a signal seeded from storage, an effect that
 * writes it back, and try/catch on both ends for private browsing.
 */
@Injectable({ providedIn: 'root' })
export class TransactionViewPrefsService {
  private readonly state = signal<StoredPrefs>(this.readInitial());

  readonly pageSize = computed(() => this.state().pageSize);
  readonly columns = computed<readonly TransactionColumn[]>(() => this.state().columns);
  readonly pageSizes = PAGE_SIZES;

  readonly widthOf = (column: TransactionColumn): number =>
    this.state().widths[column] ?? DEFAULT_WIDTHS[column];

  constructor() {
    effect(() => this.persist(this.state()));
  }

  isVisible(column: TransactionColumn): boolean {
    return this.state().columns.includes(column);
  }

  setPageSize(size: number): void {
    if (!PAGE_SIZES.includes(size)) return;
    this.state.update((current) => ({ ...current, pageSize: size }));
  }

  toggleColumn(column: TransactionColumn): void {
    this.state.update((current) => {
      const visible = new Set(current.columns);
      if (visible.has(column)) {
        // Never let the user hide the last column.
        if (visible.size === 1) return current;
        visible.delete(column);
      } else {
        visible.add(column);
      }
      return {
        ...current,
        columns: current.columns.filter((c) => visible.has(c)).concat(visible.has(column) ? [column] : []),
      };
    });
  }

  moveColumn(column: TransactionColumn, toIndex: number): void {
    this.state.update((current) => {
      const fromIndex = current.columns.indexOf(column);
      if (fromIndex < 0) return current;
      const columns = [...current.columns];
      const [moved] = columns.splice(fromIndex, 1);
      const targetIndex = Math.max(0, Math.min(Math.round(toIndex), columns.length));
      columns.splice(targetIndex, 0, moved);
      return { ...current, columns };
    });
  }

  setWidth(column: TransactionColumn, width: number): void {
    this.state.update((current) => ({
      ...current,
      widths: {
        ...current.widths,
        [column]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
      },
    }));
  }

  private readInitial(): StoredPrefs {
    const fallback: StoredPrefs = {
      pageSize: DEFAULT_PAGE_SIZE,
      columns: [...DEFAULT_COLUMNS],
      widths: {},
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      const columns: TransactionColumn[] = [];
      if (Array.isArray(parsed.columns)) {
        for (const column of parsed.columns) {
          if (isTransactionColumn(column) && !columns.includes(column)) columns.push(column);
        }
      }
      const widths: Partial<Record<TransactionColumn, number>> = {};
      if (parsed.widths && typeof parsed.widths === 'object') {
        for (const [column, width] of Object.entries(parsed.widths)) {
          if (isTransactionColumn(column) && typeof width === 'number' && Number.isFinite(width)) {
            widths[column] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
          }
        }
      }
      return {
        pageSize: PAGE_SIZES.includes(parsed.pageSize as number)
          ? (parsed.pageSize as number)
          : DEFAULT_PAGE_SIZE,
        columns: columns.length > 0 ? columns : [...DEFAULT_COLUMNS],
        widths,
      };
    } catch {
      return fallback;
    }
  }

  private persist(prefs: StoredPrefs): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable - settings still apply for this session.
    }
  }
}
