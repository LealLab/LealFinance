import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { addDays, formatIsoDate } from '../../domain/calc/dates';
import { projectOccurrences } from '../../domain/calc/recurrence';
import { Category } from '../../domain/models/category';
import { ProjectedTransaction, RecurringRule } from '../../domain/models/recurring';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { EMPTY_FILTERS, matchesFilters, TransactionFilters } from './transaction-filters';
import { TransactionFormModal } from './transaction-form-modal';
import { RecurringRuleFormModal } from './recurring-rule-form-modal';

const PROJECTION_HORIZON_DAYS = 60;
const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];

interface DateGroup {
  date: string;
  rows: Transaction[];
}

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them — same "dynamic
 * markings" situation as account-form-modal.ts / layout/sidebar.ts:
 * t(transactions.delete.title, transactions.delete.message, transactions.recurring.delete.title, transactions.recurring.delete.message)
 */
@Component({
  selector: 'app-transactions',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    TransactionFormModal,
    RecurringRuleFormModal
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss'
})
export class Transactions {
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly recurringRuleRepository = inject(RecurringRuleRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly transactionTypes = TRANSACTION_TYPES;

  protected readonly transactionsResource = rxResource({ stream: () => this.transactionRepository.list() });
  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly recurringRulesResource = rxResource({
    stream: () => this.recurringRuleRepository.list()
  });
  protected readonly institutionsResource = rxResource({ stream: () => this.institutionRepository.list() });

  protected readonly tab = signal<'transactions' | 'recurring'>('transactions');
  protected readonly filters = signal<TransactionFilters>(EMPTY_FILTERS);

  protected readonly accountsById = computed(
    () => new Map(this.accountsResource.value()?.map((a) => [a.id, a]) ?? [])
  );
  protected readonly categoriesById = computed(
    () => new Map(this.categoriesResource.value()?.map((c) => [c.id, c]) ?? [])
  );

  protected readonly filteredGroups = computed<DateGroup[]>(() => {
    const filters = this.filters();
    const accountsById = this.accountsById();
    const rows = (this.transactionsResource.value() ?? [])
      .filter((tx) => tx.type !== 'interest')
      .filter((tx) => matchesFilters(tx, filters, accountsById))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    const groups: DateGroup[] = [];
    for (const row of rows) {
      const lastGroup = groups.at(-1);
      if (lastGroup?.date === row.date) {
        lastGroup.rows.push(row);
      } else {
        groups.push({ date: row.date, rows: [row] });
      }
    }
    return groups;
  });

  protected readonly projectedRows = computed<ProjectedTransaction[]>(() => {
    const rules = this.recurringRulesResource.value() ?? [];
    const filters = this.filters();
    const accountsById = this.accountsById();
    const from = formatIsoDate(new Date());
    const to = formatIsoDate(addDays(new Date(), PROJECTION_HORIZON_DAYS));

    return rules
      .flatMap((rule) => projectOccurrences(rule, from, to))
      .filter((occurrence) => matchesFilters(occurrence, filters, accountsById))
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  protected readonly isEmpty = computed(
    () => !this.transactionsResource.isLoading() && this.filteredGroups().length === 0
  );

  protected readonly txFormOpen = signal(false);
  protected readonly editingTx = signal<Transaction | undefined>(undefined);
  protected readonly ruleFormOpen = signal(false);
  protected readonly editingRule = signal<RecurringRule | undefined>(undefined);

  protected setFilter<K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]): void {
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  protected clearFilters(): void {
    this.filters.set(EMPTY_FILTERS);
  }

  protected topLevelCategories = computed(() =>
    (this.categoriesResource.value() ?? []).filter((c) => !c.archived)
  );

  protected categoryLabel(category: Category): string {
    return category.parentId ? `— ${category.name}` : category.name;
  }

  protected openCreateTx(): void {
    this.editingTx.set(undefined);
    this.txFormOpen.set(true);
  }

  protected openEditTx(tx: Transaction): void {
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  protected onTxSaved(): void {
    this.transactionsResource.reload();
    this.recurringRulesResource.reload();
  }

  protected async deleteTx(tx: Transaction): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'transactions.delete.title',
      'transactions.delete.message',
      'danger'
    );
    if (!confirmed) return;
    this.transactionRepository.delete(tx.id).subscribe(() => this.transactionsResource.reload());
  }

  protected openCreateRule(): void {
    this.editingRule.set(undefined);
    this.ruleFormOpen.set(true);
  }

  protected openEditRule(rule: RecurringRule): void {
    this.editingRule.set(rule);
    this.ruleFormOpen.set(true);
  }

  protected onRuleSaved(): void {
    this.recurringRulesResource.reload();
  }

  protected async deleteRule(rule: RecurringRule): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'transactions.recurring.delete.title',
      'transactions.recurring.delete.message',
      'danger'
    );
    if (!confirmed) return;
    this.recurringRuleRepository.delete(rule.id).subscribe(() => this.recurringRulesResource.reload());
  }

  protected nextOccurrence(rule: RecurringRule): string | undefined {
    const from = formatIsoDate(new Date());
    const to = formatIsoDate(addDays(new Date(), 366));
    return projectOccurrences(rule, from, to)[0]?.date;
  }

  protected rowTone(tx: Pick<Transaction, 'type'>): 'positive' | 'negative' | 'neutral' {
    if (tx.type === 'income') return 'positive';
    if (tx.type === 'expense') return 'negative';
    return 'neutral';
  }

  protected rowSign(tx: Pick<Transaction, 'type'>): string {
    if (tx.type === 'income') return '+';
    if (tx.type === 'expense') return '−';
    return '';
  }
}
