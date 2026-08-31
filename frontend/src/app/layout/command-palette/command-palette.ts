import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { BalanceVisibilityService } from '../../core/balance-visibility.service';
import { CommandPaletteService } from '../../core/command-palette.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { SessionService } from '../../core/session.service';
import { ThemeService } from '../../core/theme.service';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Icon, IconName } from '../../shared/ui/icon/icon';
import { navSectionsFor } from '../sidebar';
import { fuzzyScore } from './fuzzy';

const RECENT_TRANSACTIONS_LIMIT = 20;

interface PaletteItem {
  id: string;
  /** Translation key, when the label is static UI copy. */
  labelKey?: string;
  /** Literal text, when the label is real data (an account/category name…). */
  label?: string;
  /** Short trailing hint, rendered right-aligned and never shrunk - a route
   * like `/transactions`. Long text here squeezes the label to nothing. */
  sublabelKey?: string;
  sublabel?: string;
  /** Translation key for extra search terms. Matched against, never
   * rendered: synonyms people type ("2FA", "authenticator") belong in the
   * query text, not in the row. */
  keywordsKey?: string;
  icon: IconName;
  run: () => void;
}

interface PaletteGroup {
  key: string;
  labelKey: string;
  items: PaletteItem[];
}

/**
 * Ctrl+K / Cmd+K command palette: quick actions, "go to" for every nav
 * route, and live results from the mock repositories. Mounted once in
 * layout/shell.html (Shell also owns the global keydown listener that
 * calls CommandPaletteService.toggle()).
 *
 * Built on the same native-`<dialog>` + `showModal()`/`close()` pattern as
 * shared/ui/modal/modal.ts, but with its own chromeless template (a search
 * input as the header, not a title bar) rather than reusing `Modal`.
 *
 * Every labelKey/sublabelKey below is read dynamically in
 * command-palette.html (worded that way, not as a literal call, so this
 * docstring itself doesn't register as a false usage site - see
 * docs/i18n.md's "one gotcha" and core/api-error.ts for the same
 * wording pattern), which transloco-keys-manager's static extractor can't
 * resolve back to a literal - same "dynamic markings" situation as
 * layout/sidebar.ts (whose layout.nav.* keys are reused
 * as-is here for the "Go to" group, via NAV_SECTIONS, and so don't need
 * re-marking). Admin-only items reuse the same keys as layout/sidebar.ts.
 *
 * t(layout.commandPalette.groups.quickActions, layout.commandPalette.groups.goTo, layout.commandPalette.groups.accounts, layout.commandPalette.groups.categories, layout.commandPalette.groups.budgets, layout.commandPalette.groups.transactions, layout.commandPalette.actions.newTransaction, layout.commandPalette.actions.newAccount, layout.commandPalette.actions.newCategory, layout.commandPalette.actions.newBudget, layout.commandPalette.actions.configureLanguage, layout.commandPalette.actions.configureCurrency, layout.commandPalette.actions.configureTwoFactor, layout.commandPalette.actions.configureTwoFactorHint, layout.commandPalette.actions.toggleTheme, layout.commandPalette.actions.toggleBalances, settings.backup.export.action, settings.backup.restore.action, layout.nav.providers, layout.nav.adminUsers, layout.nav.sections.admin)
 */
@Component({
  selector: 'app-command-palette',
  imports: [TranslocoDirective, Icon],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export class CommandPalette {
  protected readonly paletteService = inject(CommandPaletteService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(SessionService);
  private readonly metadata = inject(MetadataService);
  private readonly theme = inject(ThemeService);
  private readonly balanceVisibility = inject(BalanceVisibilityService);
  private readonly preferences = inject(PreferenceService);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly budgetRepository = inject(BudgetRepository);
  private readonly transactionRepository = inject(TransactionRepository);

  protected readonly query = signal('');
  protected readonly highlightedIndex = signal(0);

  // Not `.required()`: same reasoning as Modal (shared/ui/modal/modal.ts)
  // - the constructor effect's first pass can beat view-query resolution.
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // Loaded once per "open" - params re-evaluates to a fresh object only
  // when isOpen() actually flips to true, not on every change-detection
  // pass, so re-opening the palette refreshes the lists without polling
  // while it's closed.
  private readonly accountsResource = rxResource({
    params: () => (this.paletteService.isOpen() ? {} : undefined),
    stream: () => this.accountRepository.list(),
  });
  private readonly categoriesResource = rxResource({
    params: () => (this.paletteService.isOpen() ? {} : undefined),
    stream: () => this.categoryRepository.list(),
  });
  private readonly categoryGroupsResource = rxResource({
    params: () => (this.paletteService.isOpen() ? {} : undefined),
    stream: () => this.categoryGroupRepository.list(),
  });
  private readonly budgetsResource = rxResource({
    params: () => (this.paletteService.isOpen() ? {} : undefined),
    stream: () => this.budgetRepository.list(),
  });
  // Transactions are searched server-side (there can be far more of them
  // than fit in memory) rather than fetched whole and fuzzy-filtered like
  // every other group below - re-evaluates on every query() change too, not
  // just on open, but rxResource cancels the superseded request each
  // keystroke so this doesn't need its own debounce.
  private readonly transactionsResource = rxResource({
    params: () => (this.paletteService.isOpen() ? { search: this.query() } : undefined),
    stream: ({ params }) =>
      this.transactionRepository.list({
        search: params.search || undefined,
        limit: RECENT_TRANSACTIONS_LIMIT,
      }),
  });

  protected readonly groups = computed<PaletteGroup[]>(() => {
    const query = this.query();
    const groups: (PaletteGroup | null)[] = [
      this.buildGroup(
        'quickActions',
        'layout.commandPalette.groups.quickActions',
        this.quickActionItems(),
        query,
      ),
      this.buildGroup('goTo', 'layout.commandPalette.groups.goTo', this.goToItems(), query),
      this.buildGroup(
        'accounts',
        'layout.commandPalette.groups.accounts',
        this.accountItems(),
        query,
      ),
      this.buildGroup(
        'categories',
        'layout.commandPalette.groups.categories',
        this.categoryItems(),
        query,
      ),
      this.buildGroup('budgets', 'layout.commandPalette.groups.budgets', this.budgetItems(), query),
      this.transactionGroup(),
    ];
    return groups.filter((group): group is PaletteGroup => group !== null);
  });

  protected readonly flatItems = computed<PaletteItem[]>(() =>
    this.groups().flatMap((group) => group.items),
  );

  protected readonly highlightedId = computed<string | undefined>(
    () => this.flatItems()[this.highlightedIndex()]?.id,
  );

  constructor() {
    // Open/close the native dialog to match the service's isOpen() signal,
    // same effect+native-close pattern as Modal (shared/ui/modal/modal.ts)
    // and Shell's mobile drawer. showModal() natively autofocuses the
    // first focusable element (the search <input>, since it's the dialog's
    // first child) - the explicit .focus() call below is a defensive
    // backstop, not a workaround for that not working.
    effect(() => {
      const element = this.dialog()?.nativeElement;
      if (!element) return;
      if (this.paletteService.isOpen()) {
        if (!element.open) {
          element.showModal();
          this.searchInput()?.nativeElement.focus();
        }
      } else if (element.open) {
        element.close();
      }
    });

    // Reset transient UI state whenever the palette closes, so it reopens
    // fresh rather than showing the previous session's filtered query.
    effect(() => {
      if (!this.paletteService.isOpen()) {
        this.query.set('');
        this.highlightedIndex.set(0);
      }
    });

    // Clamp the highlight when filtering shrinks the result list out from
    // under it.
    effect(() => {
      const count = this.flatItems().length;
      if (count > 0 && this.highlightedIndex() >= count) {
        this.highlightedIndex.set(count - 1);
      }
    });
  }

  protected onNativeClose(): void {
    this.paletteService.hide();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.dialog()?.nativeElement.close();
    }
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    this.highlightedIndex.set(0);
  }

  protected onInputKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveHighlight(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.runHighlighted();
        break;
      default:
      // Escape is left to the native dialog: pressing it while the
      // input is focused still fires the dialog's native `cancel` →
      // `close` sequence, which onNativeClose() above already handles -
      // no explicit handler needed here.
    }
  }

  protected isHighlighted(item: PaletteItem): boolean {
    return item.id === this.highlightedId();
  }

  protected highlightItem(item: PaletteItem): void {
    const index = this.flatItems().findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) this.highlightedIndex.set(index);
  }

  protected selectItem(item: PaletteItem): void {
    this.paletteService.hide();
    item.run();
  }

  private runHighlighted(): void {
    const item = this.flatItems()[this.highlightedIndex()];
    if (!item) return;
    this.selectItem(item);
  }

  private moveHighlight(delta: number): void {
    const count = this.flatItems().length;
    if (count === 0) return;
    this.highlightedIndex.update((index) => (index + delta + count) % count);
  }

  private buildGroup(
    key: string,
    labelKey: string,
    items: PaletteItem[],
    query: string,
  ): PaletteGroup | null {
    const filtered = this.filterItems(items, query);
    return filtered.length > 0 ? { key, labelKey, items: filtered } : null;
  }

  private filterItems(items: PaletteItem[], query: string): PaletteItem[] {
    if (!query.trim()) return items;
    return items
      .map((item) => ({ item, score: fuzzyScore(query, this.itemSearchText(item)) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }

  private itemSearchText(item: PaletteItem): string {
    const label = item.labelKey ? this.transloco.translate(item.labelKey) : (item.label ?? '');
    const sublabel = item.sublabelKey
      ? this.transloco.translate(item.sublabelKey)
      : (item.sublabel ?? '');
    const keywords = item.keywordsKey ? this.transloco.translate(item.keywordsKey) : '';
    return `${label} ${sublabel} ${keywords}`;
  }

  private quickActionItems(): PaletteItem[] {
    return [
      {
        id: 'quick-new-transaction',
        labelKey: 'layout.commandPalette.actions.newTransaction',
        icon: 'plus',
        run: () => this.navigateToCreate('/transactions'),
      },
      {
        id: 'quick-new-account',
        labelKey: 'layout.commandPalette.actions.newAccount',
        icon: 'plus',
        run: () => this.navigateToCreate('/accounts'),
      },
      {
        id: 'quick-new-category',
        labelKey: 'layout.commandPalette.actions.newCategory',
        icon: 'plus',
        run: () => this.navigateToCreate('/categories'),
      },
      {
        id: 'quick-new-budget',
        labelKey: 'layout.commandPalette.actions.newBudget',
        icon: 'plus',
        run: () => this.navigateToCreate('/budgets'),
      },
      {
        id: 'quick-import-transactions',
        // Reuses the import page's own title key (already a literal `t(...)`
        // call in transaction-import.html) rather than adding a new
        // commandPalette.actions.* key across all 28 locale catalogs.
        labelKey: 'transactions.import.title',
        icon: 'arrowUpRight',
        run: () => this.router.navigate(['/transactions/import']),
      },
      {
        id: 'quick-export-backup',
        labelKey: 'settings.backup.export.action',
        icon: 'arrowDownLeft',
        run: () => this.navigateToSetting('settings-backup-export')
      },
      {
        id: 'quick-restore-backup',
        labelKey: 'settings.backup.restore.action',
        icon: 'refresh',
        run: () => this.navigateToSetting('settings-backup-restore')
      },
      {
        id: 'quick-configure-language',
        labelKey: 'layout.commandPalette.actions.configureLanguage',
        icon: 'globe',
        run: () => this.navigateToSetting('settings-language'),
      },
      {
        id: 'quick-configure-currency',
        labelKey: 'layout.commandPalette.actions.configureCurrency',
        icon: 'wallet',
        run: () => this.navigateToSetting('settings-display-currency'),
      },
      {
        id: 'quick-configure-two-factor',
        labelKey: 'layout.commandPalette.actions.configureTwoFactor',
        // Search-only synonyms ("2FA", "authenticator", "recovery"). Not a
        // sublabel: that slot is shrink-0 and would squeeze out the label.
        keywordsKey: 'layout.commandPalette.actions.configureTwoFactorHint',
        icon: 'shield',
        run: () => this.navigateToSetting('settings-two-factor'),
      },
      {
        id: 'quick-toggle-theme',
        labelKey: 'layout.commandPalette.actions.toggleTheme',
        icon: 'sun',
        run: () => this.preferences.setTheme(this.theme.current() === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'quick-toggle-balances',
        labelKey: 'layout.commandPalette.actions.toggleBalances',
        icon: 'eye',
        run: () => this.preferences.setBalancesHidden(!this.balanceVisibility.hidden()),
      },
    ];
  }

  // Navigates with `?new=1` attached; the target feature component reads it
  // via core/open-on-new-param.ts and opens its create-form modal.
  private navigateToCreate(path: string): void {
    this.router.navigate([path], { queryParams: { new: 1 } });
  }

  private navigateToSetting(fragment: string): void {
    this.router.navigate(['/settings'], { fragment });
  }

  private goToItems(): PaletteItem[] {
    const sections = navSectionsFor(
      this.session.user()?.role,
      this.metadata.settings()?.agentsEnabled,
      this.preferences.preferences()?.investmentsEnabled,
      this.session.user()?.aiChatEnabled,
    );

    return sections.flatMap((section) =>
      section.items.map((item) => ({
        id: `goto-${item.path}`,
        labelKey: item.labelKey,
        sublabel: item.path,
        icon: item.icon,
        run: () => this.router.navigate([item.path]),
      })),
    );
  }

  private accountItems(): PaletteItem[] {
    return (this.accountsResource.value() ?? []).map((account) => ({
      id: `account-${account.id}`,
      label: account.name,
      sublabel: account.currency,
      icon: 'wallet' as const,
      run: () => this.router.navigate(['/accounts', account.id]),
    }));
  }

  private categoryItems(): PaletteItem[] {
    return (this.categoriesResource.value() ?? []).map((category) => ({
      id: `category-${category.id}`,
      label: category.name,
      sublabelKey:
        category.kind === 'income' ? 'transactions.type.income' : 'transactions.type.expense',
      icon: category.icon,
      run: () => this.router.navigate(['/categories']),
    }));
  }

  private budgetItems(): PaletteItem[] {
    const categoryGroupsById = new Map(
      (this.categoryGroupsResource.value() ?? []).map((group) => [group.id, group]),
    );
    return (this.budgetsResource.value() ?? []).map((budget) => ({
      id: `budget-${budget.id}`,
      label: categoryGroupsById.get(budget.groupId)?.name ?? budget.groupId,
      sublabel: budget.month,
      icon: 'target' as const,
      run: () => this.router.navigate(['/budgets']),
    }));
  }

  // Already server-filtered by query() and limited to
  // RECENT_TRANSACTIONS_LIMIT (see transactionsResource above), and the
  // API already returns date-desc order - no further sort/slice needed.
  private transactionItems(): PaletteItem[] {
    return (this.transactionsResource.value() ?? []).map((transaction) => ({
      id: `transaction-${transaction.id}`,
      label: transaction.description,
      sublabel: transaction.date,
      icon: (transaction.type === 'income'
        ? 'arrowDownLeft'
        : transaction.type === 'expense'
          ? 'arrowUpRight'
          : 'swap') as IconName,
      run: () => this.router.navigate(['/transactions']),
    }));
  }

  // Bypasses buildGroup's client-side fuzzy filter - the items are already
  // server-filtered by the current query (see transactionsResource above).
  private transactionGroup(): PaletteGroup | null {
    const items = this.transactionItems();
    return items.length > 0
      ? { key: 'transactions', labelKey: 'layout.commandPalette.groups.transactions', items }
      : null;
  }
}
