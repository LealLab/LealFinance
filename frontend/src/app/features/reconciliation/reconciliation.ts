import { Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { ConfirmService } from '../../core/confirm.service';
import { ReconciliationRepository } from '../../data/reconciliation.repository';
import { AccountRepository } from '../../data/account.repository';
import {
  Reconciliation as ReconciliationModel,
  ReconciliationEntry,
} from '../../domain/models/reconciliation';
import { isNegative, isZero, money } from '../../shared/money/money';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { todayIso } from '../../domain/calc/dates';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile, StatTone } from '../../shared/ui/stat-tile/stat-tile';

@Component({
  selector: 'app-reconciliation',
  imports: [
    ReactiveFormsModule,
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    LoadError,
    PageHeader,
    StatTile,
  ],
  templateUrl: './reconciliation.html',
  styleUrl: './reconciliation.scss',
})
export class Reconciliation {
  private readonly accountRepository = inject(AccountRepository);
  private readonly repository = inject(ReconciliationRepository);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmService = inject(ConfirmService);

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list(),
  });
  protected readonly reconciliationsResource = rxResource({
    stream: () => this.repository.list(),
  });
  protected readonly selectedId = signal<string | undefined>(undefined);
  protected readonly detailResource = rxResource({
    params: () => this.selectedId(),
    stream: ({ params }) => (params ? this.repository.detail(params) : of(undefined)),
  });
  protected readonly saving = signal(false);
  protected readonly mutationErrorKey = signal<string | undefined>(undefined);

  protected readonly form = this.formBuilder.nonNullable.group({
    accountId: ['', Validators.required],
    statementDate: [todayIso(), Validators.required],
    statementBalance: ['', [Validators.required, decimalAmountValidator()]],
  });

  protected readonly selected = computed(() => this.detailResource.value());
  protected readonly differenceTone = computed<StatTone>(() => {
    const detail = this.selected();
    if (!detail || isZero(money(detail.difference, detail.reconciliation.currency))) return 'default';
    return isNegative(money(detail.difference, detail.reconciliation.currency)) ? 'negative' : 'positive';
  });
  protected readonly canComplete = computed(() => {
    const detail = this.selected();
    return !!detail && detail.reconciliation.status === 'open' && isZero(
      money(detail.difference, detail.reconciliation.currency),
    );
  });

  constructor() {
    const accountId = this.route.snapshot.queryParamMap.get('accountId');
    if (accountId) this.form.controls.accountId.setValue(accountId);
    effect(() => {
      const items = this.reconciliationsResource.value();
      if (!this.selectedId() && items?.[0]) this.selectedId.set(items[0].id);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const input = this.form.getRawValue();
    this.saving.set(true);
    this.mutationErrorKey.set(undefined);
    this.repository.create(input).subscribe({
      next: (reconciliation) => {
        this.saving.set(false);
        this.selectedId.set(reconciliation.id);
        this.reconciliationsResource.reload();
      },
      error: (error: unknown) => this.showError(error),
    });
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.mutationErrorKey.set(undefined);
  }

  protected setEntry(entry: ReconciliationEntry, event: Event): void {
    const selected = this.selected();
    if (!selected || selected.reconciliation.status !== 'open') return;
    const checked = (event.target as HTMLInputElement).checked;
    this.saving.set(true);
    this.mutationErrorKey.set(undefined);
    this.repository.setEntries(selected.reconciliation.id, [entry.transactionId], checked).subscribe({
      next: () => {
        this.saving.set(false);
        this.detailResource.reload();
      },
      error: (error: unknown) => this.showError(error),
    });
  }

  protected complete(): void {
    const selected = this.selected();
    if (!selected || !this.canComplete()) return;
    this.mutate(() => this.repository.complete(selected.reconciliation.id));
  }

  protected reopen(): void {
    const selected = this.selected();
    if (!selected) return;
    this.mutate(() => this.repository.reopen(selected.reconciliation.id));
  }

  protected async remove(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const confirmed = await this.confirmService.confirm(
      'reconciliation.confirmDelete.title',
      'reconciliation.confirmDelete.message',
      'danger',
    );
    if (!confirmed) return;
    this.saving.set(true);
    this.repository.remove(selected.reconciliation.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.selectedId.set(undefined);
        this.reconciliationsResource.reload();
      },
      error: (error: unknown) => this.showError(error),
    });
  }

  protected accountName(id: string): string {
    return this.accountsResource.value()?.find((account) => account.id === id)?.name ?? '';
  }

  protected errorKey(error: unknown): string {
    return error instanceof ApiError ? `errors.${error.code}` : 'reconciliation.loadError';
  }

  private mutate(operation: () => ReturnType<ReconciliationRepository['complete']>): void {
    this.saving.set(true);
    this.mutationErrorKey.set(undefined);
    operation().subscribe({
      next: () => {
        this.saving.set(false);
        this.detailResource.reload();
        this.reconciliationsResource.reload();
      },
      error: (error: unknown) => this.showError(error),
    });
  }

  private showError(error: unknown): void {
    this.saving.set(false);
    this.mutationErrorKey.set(this.errorKey(error));
  }

  protected readonly reconciliationStatus = (reconciliation: ReconciliationModel): string =>
    `reconciliation.status.${reconciliation.status}`;
}
