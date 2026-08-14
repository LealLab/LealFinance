import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, of } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { GoalRepository } from '../../data/goal.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { convertedOrNull, converterFromRates, CurrencyConverter } from '../../domain/calc/aggregations';
import { GoalProgress, goalProgress } from '../../domain/calc/goals';
import { Account } from '../../domain/models/account';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { Goal } from '../../domain/models/goal';
import { Money } from '../../shared/money/money';
import { Transaction } from '../../domain/models/transaction';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { GoalEntryModal, GoalEntryMode } from './goal-entry-modal';
import { GoalFormModal } from './goal-form-modal';

interface GoalRow {
  goal: Goal;
  account: Account;
  progress: GoalProgress;
  /** progress.current converted to the display currency - null when it's already in that currency, or no rate could convert it. */
  convertedCurrent: Money | null;
  convertedTarget: Money | null;
}

@Component({
  selector: 'app-goals',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    ProgressBar,
    GoalFormModal,
    GoalEntryModal,
  ],
  templateUrl: './goals.html',
  styleUrl: './goals.scss',
})
export class Goals {
  private readonly goalRepository = inject(GoalRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly exchangeRateRepository = inject(ExchangeRateRepository);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  protected readonly goalsResource = rxResource({ stream: () => this.goalRepository.list() });
  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list(),
  });
  protected readonly showArchived = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingGoal = signal<Goal | undefined>(undefined);
  protected readonly entryOpen = signal(false);
  protected readonly entryMode = signal<GoalEntryMode>('deposit');
  protected readonly entryGoal = signal<Goal | undefined>(undefined);

  protected readonly accountsById = computed(
    () => new Map(this.accountsResource.value()?.map((account) => [account.id, account]) ?? []),
  );

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  /** Currencies any goal is denominated in, other than the display currency - drives the rate fetch below, mirroring features/dashboard/dashboard.ts. */
  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const currencies = (this.goalsResource.value() ?? []).map((goal) => goal.currency);
    return Array.from(new Set(currencies.filter((currency) => currency !== display)));
  });

  protected readonly ratesResource = rxResource({
    params: () => ({ currencies: this.foreignCurrencies(), display: this.displayCurrency() }),
    stream: ({ params }) =>
      params.currencies.length === 0
        ? of([] as ExchangeRate[])
        : forkJoin(params.currencies.map((currency) => this.exchangeRateRepository.getRate(currency, params.display)))
  });

  private readonly converter = computed<CurrencyConverter>(() => converterFromRates(this.ratesResource.value() ?? []));

  protected readonly rows = computed<GoalRow[]>(() => {
    const accounts = this.accountsById();
    const transactions = this.transactionsResource.value() ?? [];
    const display = this.displayCurrency();
    const convert = this.converter();
    return (this.goalsResource.value() ?? [])
      .filter((goal) => this.showArchived() || !goal.archived)
      .map((goal) => {
        const account = accounts.get(goal.accountId);
        if (!account) return undefined;
        const progress = goalProgress(goal, account, transactions);
        return {
          goal,
          account,
          progress,
          convertedCurrent: convertedOrNull(progress.current, display, convert),
          convertedTarget: convertedOrNull(progress.target, display, convert)
        };
      })
      .filter((row): row is GoalRow => Boolean(row));
  });
  protected readonly isEmpty = computed(
    () => !this.goalsResource.isLoading() && this.rows().length === 0,
  );
  protected readonly activeGoalCount = computed(
    () => this.rows().filter((row) => !row.goal.archived).length,
  );

  protected openCreate(): void {
    this.editingGoal.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(goal: Goal): void {
    this.editingGoal.set(goal);
    this.formOpen.set(true);
  }

  protected openEntry(goal: Goal, mode: GoalEntryMode): void {
    this.entryGoal.set(goal);
    this.entryMode.set(mode);
    this.entryOpen.set(true);
  }

  protected onGoalSaved(): void {
    this.goalsResource.reload();
    this.accountsResource.reload();
  }

  protected onEntrySaved(): void {
    this.transactionsResource.reload();
    this.accountsResource.reload();
  }

  protected archive(goal: Goal): void {
    this.goalRepository.update(goal.id, { archived: !goal.archived }).subscribe(() => {
      this.accountRepository.setArchived(goal.accountId, !goal.archived).subscribe(() => {
        this.goalsResource.reload();
        this.accountsResource.reload();
      });
    });
  }

  protected goalTransactions(goal: Goal): Transaction[] {
    return (this.transactionsResource.value() ?? [])
      .filter((tx) => tx.accountId === goal.accountId || tx.toAccountId === goal.accountId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  protected transactionSign(goal: Goal, tx: { accountId: string; type: string }): '+' | '−' {
    return tx.type === 'interest' || tx.accountId !== goal.accountId ? '+' : '−';
  }
}
