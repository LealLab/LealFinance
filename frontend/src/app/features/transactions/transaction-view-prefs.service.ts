import { computed, effect, Injectable, signal } from '@angular/core';
import { ALL_COLUMNS, DEFAULT_COLUMNS, TransactionColumn } from './transaction-columns';

const STORAGE_KEY = 'lealfinance.transactions.view';
/** All <= the backend's `limit` cap of 200. */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

interface StoredPrefs {
  pageSize: number;
  columns: TransactionColumn[];
}

/**
 * Persists the transactions table's view settings - page size and which
 * columns are visible - to localStorage, in the shape of
 * CategoryCollapseService: a signal seeded from storage, an effect that
 * writes it back, and try/catch on both ends for private browsing.
 */
@Injectable({ providedIn: 'root' })
export class TransactionViewPrefsService {
  private readonly state = signal<StoredPrefs>(this.readInitial());

  readonly pageSize = computed(() => this.state().pageSize);
  readonly columns = computed<ReadonlySet<TransactionColumn>>(() => new Set(this.state().columns));
  readonly pageSizes = PAGE_SIZES;

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
        columns: ALL_COLUMNS.filter((c) => visible.has(c)),
      };
    });
  }

  private readInitial(): StoredPrefs {
    const fallback: StoredPrefs = {
      pageSize: DEFAULT_PAGE_SIZE,
      columns: [...DEFAULT_COLUMNS],
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      const columns = Array.isArray(parsed.columns)
        ? ALL_COLUMNS.filter((c) => (parsed.columns as unknown[]).includes(c))
        : [];
      return {
        pageSize: PAGE_SIZES.includes(parsed.pageSize as number)
          ? (parsed.pageSize as number)
          : DEFAULT_PAGE_SIZE,
        columns: columns.length > 0 ? columns : [...DEFAULT_COLUMNS],
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
