import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { InvestmentAssetRepository } from '../../data/investment-asset.repository';
import { InvestmentTransactionRepository } from '../../data/investment-transaction.repository';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import {
  InvestmentAsset,
  InvestmentPosition,
  InvestmentTransaction,
} from '../../domain/models/investment';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { isNegative, money, ratio, sum, Money } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { InfiniteScroll } from '../../shared/ui/infinite-scroll/infinite-scroll';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { InvestmentAssetFormModal } from './investment-asset-form-modal';
import { InvestmentAssetsCard } from './investment-assets-card';
import { InvestmentTransactionFormModal } from './investment-transaction-form-modal';
import { InvestmentWalletFormModal } from './investment-wallet-form-modal';

const PAGE_SIZE = 30;

/**
 * Confirmation and error keys are dynamic values, so keep them marked for
 * transloco-keys-manager:
 * t(investments.archive.title, investments.archive.message, investments.transactions.delete.title, investments.transactions.delete.message, investments.assets.archive.title, investments.assets.archive.message)
 */

@Component({
  selector: 'app-investment-detail',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    ExchangeRateWarning,
    Icon,
    InfiniteScroll,
    PageHeader,
    Skeleton,
    InvestmentAssetFormModal,
    InvestmentAssetsCard,
    InvestmentTransactionFormModal,
    InvestmentWalletFormModal,
  ],
  templateUrl: './investment-detail.html',
})
export class InvestmentDetail {
  private readonly wallets = inject(InvestmentWalletRepository);
  private readonly assets = inject(InvestmentAssetRepository);
  private readonly transactions = inject(InvestmentTransactionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();

  protected readonly walletResource = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.wallets.get(params),
  });
  protected readonly positionsResource = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.wallets.positions(params),
  });
  protected readonly assetsResource = rxResource({ stream: () => this.assets.list() });

  protected readonly rows = signal<InvestmentTransaction[]>([]);
  private readonly offset = signal(0);
  protected readonly exhausted = signal(false);
  private loadingMore = false;
  private loadSubscription?: Subscription;

  protected readonly transactionFormOpen = signal(false);
  protected readonly editingTransaction = signal<InvestmentTransaction | undefined>(undefined);
  protected readonly assetFormOpen = signal(false);
  protected readonly editingAsset = signal<InvestmentAsset | undefined>(undefined);
  protected readonly walletFormOpen = signal(false);

  protected readonly wallet = computed(() => this.walletResource.value());
  protected readonly positions = computed(() => this.positionsResource.value() ?? []);
  protected readonly totalBookValue = computed<Money | null>(() => {
    const wallet = this.wallet();
    if (!wallet) return null;
    return sum(
      this.positions().map((position) => money(position.bookValue, wallet.currency)),
      wallet.currency,
    );
  });

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.loadSubscription?.unsubscribe();
        this.loadingMore = false;
        this.rows.set([]);
        this.offset.set(0);
        this.exhausted.set(false);
        this.loadMore();
      });
    });
    openOnNewParam(() => this.openCreateTransaction());
  }

  protected loadMore(): void {
    if (this.loadingMore || this.exhausted()) return;
    this.loadingMore = true;
    this.loadSubscription = this.transactions
      .list({ walletId: this.id(), limit: PAGE_SIZE, offset: this.offset() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.rows.update((current) => [...current, ...page]);
          this.offset.update((current) => current + page.length);
          if (page.length < PAGE_SIZE) this.exhausted.set(true);
          this.loadingMore = false;
        },
        error: (error: unknown) => {
          this.loadingMore = false;
          this.mutationErrors.show(error);
        },
      });
  }

  protected allocation(position: InvestmentPosition): number {
    const total = this.totalBookValue();
    if (!total || total.amount === '0.0000') return 0;
    return ratio(money(position.bookValue, total.currency), total) * 100;
  }

  protected amountClass(amount: string | undefined): string {
    if (!amount) return 'text-content-muted';
    return isNegative(money(amount, this.wallet()?.currency ?? 'USD'))
      ? 'text-negative'
      : 'text-positive';
  }

  protected typeLabel(type: InvestmentTransaction['type']): string {
    return this.transloco.translate(`investments.type.${type}`);
  }

  protected openCreateTransaction(): void {
    this.editingTransaction.set(undefined);
    this.transactionFormOpen.set(true);
  }

  protected openEditTransaction(transaction: InvestmentTransaction): void {
    this.editingTransaction.set(transaction);
    this.transactionFormOpen.set(true);
  }

  protected openCreateAsset(): void {
    this.editingAsset.set(undefined);
    this.assetFormOpen.set(true);
  }

  protected openEditAsset(asset: InvestmentAsset): void {
    this.editingAsset.set(asset);
    this.assetFormOpen.set(true);
  }

  protected openEditWallet(): void {
    this.walletFormOpen.set(true);
  }

  protected onTransactionSaved(): void {
    this.positionsResource.reload();
    this.resetLedger();
  }

  protected onAssetSaved(): void {
    this.assetsResource.reload();
    this.positionsResource.reload();
  }

  protected async archiveAsset(asset: InvestmentAsset): Promise<void> {
    if (!asset.archived) {
      const confirmed = await this.confirmService.confirm(
        'investments.assets.archive.title',
        'investments.assets.archive.message',
        'default',
        { symbol: asset.symbol },
      );
      if (!confirmed) return;
    }
    this.assets.setArchived(asset.id, !asset.archived).subscribe({
      next: () => this.onAssetSaved(),
      error: (error: unknown) => this.mutationErrors.show(error),
    });
  }

  protected onWalletSaved(): void {
    this.walletResource.reload();
    this.positionsResource.reload();
  }

  protected async deleteTransaction(transaction: InvestmentTransaction): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'investments.transactions.delete.title',
      'investments.transactions.delete.message',
      'danger',
      { date: transaction.date },
    );
    if (!confirmed) return;
    this.transactions.delete(transaction.id).subscribe({
      next: () => this.onTransactionSaved(),
      error: (error: unknown) => this.mutationErrors.show(error),
    });
  }

  protected async toggleArchived(): Promise<void> {
    const wallet = this.wallet();
    if (!wallet) return;
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
      next: () => this.onWalletSaved(),
      error: (error: unknown) => this.mutationErrors.show(error),
    });
  }

  protected goBack(): void {
    this.router.navigate(['/investments']);
  }

  private resetLedger(): void {
    this.loadSubscription?.unsubscribe();
    this.loadingMore = false;
    this.rows.set([]);
    this.offset.set(0);
    this.exhausted.set(false);
    this.loadMore();
  }
}
