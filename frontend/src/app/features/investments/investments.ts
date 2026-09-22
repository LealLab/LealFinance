import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, map, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { InvestmentPosition, InvestmentWallet } from '../../domain/models/investment';
import { isNegative, money, Money, sum } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { InvestmentWalletFormModal } from './investment-wallet-form-modal';

/** Figures derived from one wallet's positions, for its card on the list page. */
interface WalletStats {
  positionCount: number;
  bookValue: Money;
  marketValue: Money | null;
  unrealizedGain: Money | null;
  marketValueIsFallback: boolean;
}

@Component({
  selector: 'app-investments',
  imports: [
    RouterLink,
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    ExchangeRateWarning,
    Icon,
    LoadError,
    PageHeader,
    Skeleton,
    StatTile,
    InvestmentWalletFormModal,
  ],
  templateUrl: './investments.html',
})
export class Investments {
  private readonly wallets = inject(InvestmentWalletRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);

  protected readonly walletsResource = rxResource({ stream: () => this.wallets.list() });
  protected readonly summaryResource = rxResource({ stream: () => this.wallets.summary() });
  /** One positions fetch per wallet, keyed by wallet id - powers each card's figures. */
  protected readonly positionsResource = rxResource({
    params: () => (this.walletsResource.value() ?? []).map((wallet) => wallet.id),
    stream: ({ params }) =>
      params.length === 0
        ? of(new Map<string, InvestmentPosition[]>())
        : forkJoin(Object.fromEntries(params.map((id) => [id, this.wallets.positions(id)]))).pipe(
            map((byId) => new Map(Object.entries(byId))),
          ),
  });
  protected readonly dataError = computed(
    () => this.walletsResource.status() === 'error' || this.summaryResource.status() === 'error',
  );
  protected readonly formOpen = signal(false);
  protected readonly editingWallet = signal<InvestmentWallet | undefined>(undefined);
  protected readonly isEmpty = computed(
    () => !this.walletsResource.isLoading() && (this.walletsResource.value() ?? []).length === 0,
  );
  protected readonly summaryCurrency = computed(
    () => this.walletsResource.value()?.[0]?.currency ?? 'USD',
  );
  protected readonly hasOtherCurrencyWallets = computed(() =>
    (this.walletsResource.value() ?? []).some(
      (wallet) => wallet.currency !== this.summaryCurrency(),
    ),
  );

  constructor() {
    openOnNewParam(() => this.openCreate());
  }

  protected walletStats(wallet: InvestmentWallet): WalletStats {
    const positions = this.positionsResource.value()?.get(wallet.id) ?? [];
    const missingPrice = positions.some((position) => !position.marketValue);
    return {
      positionCount: positions.length,
      bookValue: sum(
        positions.map((position) => money(position.bookValue, wallet.currency)),
        wallet.currency,
      ),
      marketValue: missingPrice
        ? null
        : sum(
            positions.map((position) => money(position.marketValue!, wallet.currency)),
            wallet.currency,
          ),
      unrealizedGain: missingPrice
        ? null
        : sum(
            positions.map((position) => money(position.unrealizedGain!, wallet.currency)),
            wallet.currency,
          ),
      marketValueIsFallback: positions.some((position) => position.marketValueIsFallback),
    };
  }

  protected amountClass(amount: Money | null): string {
    if (!amount) return 'text-content-muted';
    return isNegative(amount) ? 'text-negative' : 'text-positive';
  }

  protected retryAll(): void {
    this.walletsResource.reload();
    this.summaryResource.reload();
  }

  protected openCreate(): void {
    this.editingWallet.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(wallet: InvestmentWallet): void {
    this.editingWallet.set(wallet);
    this.formOpen.set(true);
  }

  protected onSaved(): void {
    this.walletsResource.reload();
    this.summaryResource.reload();
  }

  protected async archive(wallet: InvestmentWallet): Promise<void> {
    if (!wallet.archived) {
      const confirmed = await this.confirmService.confirm(
        'investments.archive.title',
        'investments.archive.message',
        'default',
        { name: wallet.name },
      );
      if (!confirmed) return;
    }
    this.wallets.setArchived(wallet.id, !wallet.archived).subscribe({
      next: () => this.onSaved(),
      error: (error: unknown) => this.mutationErrors.show(error),
    });
  }
}
