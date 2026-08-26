import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { InvestmentWallet } from '../../domain/models/investment';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { InvestmentWalletFormModal } from './investment-wallet-form-modal';

/** t(investments.archiveError, investments.placeholder.title, investments.placeholder.description) */

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
    Icon,
    PageHeader,
    StatTile,
    InvestmentWalletFormModal,
  ],
  templateUrl: './investments.html',
  styleUrl: './investments.scss',
})
export class Investments {
  private readonly wallets = inject(InvestmentWalletRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly walletsResource = rxResource({ stream: () => this.wallets.list() });
  protected readonly summaryResource = rxResource({ stream: () => this.wallets.summary() });
  protected readonly formOpen = signal(false);
  protected readonly editingWallet = signal<InvestmentWallet | undefined>(undefined);
  protected readonly actionErrorKey = signal<string | undefined>(undefined);
  protected readonly isEmpty = computed(
    () => !this.walletsResource.isLoading() && (this.walletsResource.value() ?? []).length === 0,
  );
  protected readonly summaryCurrency = computed(
    () => this.walletsResource.value()?.[0]?.currency ?? 'USD',
  );

  constructor() {
    openOnNewParam(() => this.openCreate());
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
      error: () => this.actionErrorKey.set('investments.archiveError'),
    });
  }
}
