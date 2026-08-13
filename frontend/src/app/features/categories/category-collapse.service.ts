import { effect, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'lealfinance.categories.collapsed';

/**
 * Tracks which parent categories the user has collapsed on the Categories
 * screen, persisted to localStorage (serialized as a JSON array of ids) —
 * like ThemeService's theme preference, this is a UI setting, not mock
 * domain data, so it survives a reload on purpose.
 */
@Injectable({ providedIn: 'root' })
export class CategoryCollapseService {
  private readonly collapsedIds = signal<Set<string>>(this.readInitial());

  readonly collapsed = this.collapsedIds.asReadonly();

  constructor() {
    effect(() => {
      this.persist(this.collapsedIds());
    });
  }

  isCollapsed(categoryId: string): boolean {
    return this.collapsedIds().has(categoryId);
  }

  toggle(categoryId: string): void {
    this.collapsedIds.update((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  private readInitial(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
      // Private browsing / storage disabled / malformed JSON — start empty.
      return new Set();
    }
  }

  private persist(ids: Set<string>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
      // Storage unavailable — collapse state still applies for the current session.
    }
  }
}
