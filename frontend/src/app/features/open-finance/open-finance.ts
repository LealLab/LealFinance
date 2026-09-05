import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { OpenFinanceRepository } from '../../data/open-finance.repository';
import {
  PluggyAccount,
  PluggyCredentialStatus,
  PluggyItem,
} from '../../domain/models/open-finance';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge, BadgeTone } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PluggyConnectButton } from './pluggy-connect-button';
import { PluggyCredentialsSection } from './pluggy-credentials-section';

interface RawRow {
  label: string;
  value: string;
}

/** t(openFinance.title, openFinance.description, openFinance.loading, openFinance.errors.action, openFinance.credentials.title, openFinance.credentials.description, openFinance.items.title, openFinance.items.empty.credentialsTitle, openFinance.items.empty.credentialsDescription, openFinance.items.empty.title, openFinance.items.empty.description, openFinance.accounts.title, openFinance.accounts.loading, openFinance.accounts.empty, openFinance.accounts.syncedBalance, openFinance.accounts.ledgerBalance, openFinance.accounts.drift, openFinance.accounts.noLedger, openFinance.accounts.holdings, openFinance.accounts.loanSchedule, openFinance.accounts.detail, openFinance.accounts.value, openFinance.accounts.noData, openFinance.accounts.lastTransaction, openFinance.actions.connect, openFinance.actions.sync, openFinance.actions.disconnect, openFinance.lastSynced, openFinance.disconnect.title, openFinance.disconnect.message, openFinance.disconnect.keep, openFinance.disconnect.delete) */
@Component({
  selector: 'app-open-finance',
  imports: [
    DatePipe,
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    PluggyConnectButton,
    PluggyCredentialsSection,
  ],
  templateUrl: './open-finance.html',
  styleUrl: './open-finance.scss',
})
export class OpenFinance {
  private readonly repository = inject(OpenFinanceRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly credentialsResource = rxResource({
    stream: () => this.repository.getCredentialStatus(),
  });
  protected readonly itemsResource = rxResource({
    stream: () => this.repository.listItems(),
  });
  protected readonly balancesResource = rxResource({
    stream: () => this.accountRepository.balances(),
  });
  protected readonly accountsByItem = signal<Record<string, PluggyAccount[]>>({});
  protected readonly actionErrorKey = signal<string | undefined>(undefined);
  protected readonly syncingItemId = signal<string | undefined>(undefined);
  protected readonly credentials = computed<PluggyCredentialStatus | undefined>(() =>
    this.credentialsResource.value(),
  );
  protected readonly itemsEmpty = computed(
    () => !this.itemsResource.isLoading() && (this.itemsResource.value() ?? []).length === 0,
  );

  constructor() {
    effect(() => {
      const items = this.itemsResource.value();
      if (!items) return;
      for (const item of items) this.loadAccounts(item.id);
    });
  }

  protected reloadCredentials(): void {
    this.actionErrorKey.set(undefined);
    this.credentialsResource.reload();
  }

  protected onConnected(): void {
    this.itemsResource.reload();
  }

  protected syncItem(item: PluggyItem): void {
    if (this.syncingItemId()) return;
    this.actionErrorKey.set(undefined);
    this.syncingItemId.set(item.id);
    this.repository.syncItem(item.id).subscribe({
      next: (result) => {
        this.syncingItemId.set(undefined);
        if (result.error) this.actionErrorKey.set('openFinance.errors.action');
        this.itemsResource.reload();
        this.balancesResource.reload();
      },
      error: () => {
        this.syncingItemId.set(undefined);
        this.actionErrorKey.set('openFinance.errors.action');
      },
    });
  }

  protected async disconnect(item: PluggyItem): Promise<void> {
    const mode = await this.confirmService.choose(
      'openFinance.disconnect.title',
      'openFinance.disconnect.message',
      [
        { labelKey: 'openFinance.disconnect.keep', value: 'keep' },
        { labelKey: 'openFinance.disconnect.delete', value: 'delete', tone: 'danger' },
      ],
    );
    if (mode !== 'keep' && mode !== 'delete') return;

    this.actionErrorKey.set(undefined);
    this.repository.disconnectItem(item.id, mode).subscribe({
      next: () => this.itemsResource.reload(),
      error: () => this.actionErrorKey.set('openFinance.errors.action'),
    });
  }

  protected derivedBalance(account: PluggyAccount): string | undefined {
    if (!account.accountId) return undefined;
    return this.balancesResource
      .value()
      ?.find((balance) => balance.accountId === account.accountId)?.balance;
  }

  protected drift(account: PluggyAccount): number | undefined {
    const derived = this.derivedBalance(account);
    return derived === undefined ? undefined : Number(derived) - account.syncedBalance;
  }

  protected hasDrift(account: PluggyAccount): boolean {
    const drift = this.drift(account);
    return drift !== undefined && Math.abs(drift) >= 0.01;
  }

  protected balanceText(value: number): string {
    return value.toFixed(4);
  }

  protected statusTone(status: string): BadgeTone {
    const normalized = status.toUpperCase();
    if (normalized.includes('ERROR') || normalized.includes('FAILED')) return 'negative';
    if (
      normalized.includes('WAIT') ||
      normalized.includes('UPDATING') ||
      normalized.includes('OUTDATED') ||
      normalized.includes('PARTIAL') ||
      normalized.includes('UNHEALTHY') ||
      normalized.includes('LOGIN')
    ) {
      return 'warning';
    }
    return 'positive';
  }

  protected isRawAccount(account: PluggyAccount): boolean {
    const type = account.type.toUpperCase();
    return type === 'INVESTMENT' || type === 'LOAN';
  }

  protected isLoanAccount(account: PluggyAccount): boolean {
    return account.type.toUpperCase() === 'LOAN';
  }

  protected rawRows(account: PluggyAccount): RawRow[] {
    const key = account.type.toUpperCase() === 'LOAN' ? 'loans' : 'investments';
    const snapshot = this.asRecord(account.raw[key]);
    const results = snapshot?.['results'];
    if (!Array.isArray(results)) return [];

    return results.slice(0, 10).flatMap((value, index) => {
      const row = this.asRecord(value);
      if (!row) return [];
      const label = this.firstValue(row, ['name', 'description', 'dueDate', 'due_date']) ?? `#${index + 1}`;
      const amount = this.firstValue(row, [
        'value',
        'amount',
        'installmentAmount',
        'installment_amount',
        'quantity',
      ]);
      return amount === undefined ? [] : [{ label, value: this.rawValue(amount) }];
    });
  }

  private loadAccounts(itemId: string): void {
    this.repository.getItemAccounts(itemId).subscribe({
      next: (accounts) => this.accountsByItem.update((current) => ({ ...current, [itemId]: accounts })),
      error: () => this.accountsByItem.update((current) => ({ ...current, [itemId]: [] })),
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private firstValue(row: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
    return undefined;
  }

  private rawValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value) ?? '';
  }
}
