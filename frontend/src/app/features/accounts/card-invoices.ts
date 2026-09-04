import { Component, computed, inject, input, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { CardInvoice, CardInvoiceStatus } from '../../domain/models/card-invoice';
import { Account } from '../../domain/models/account';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';

const STATUS_TONE: Record<CardInvoiceStatus, BadgeTone> = {
  open: 'accent',
  closed: 'warning',
  overdue: 'negative',
  paid: 'positive',
  projected: 'neutral',
};

/**
 * The credit-card invoices ("faturas") section of an account's detail
 * page. Read-only apart from paying an invoice, which posts a transfer
 * from the card's payment account (or prompts for one server-side).
 *
 * All cycle math is the backend's - this only renders CardInvoice rows.
 * Status labels are reached by property path, so the extractor needs them
 * spelled out:
 * t(accounts.detail.invoices.status.open, accounts.detail.invoices.status.closed, accounts.detail.invoices.status.overdue, accounts.detail.invoices.status.paid, accounts.detail.invoices.status.projected)
 * t(accounts.detail.invoices.payConfirm.title, accounts.detail.invoices.payConfirm.message)
 */
@Component({
  selector: 'app-card-invoices',
  imports: [TranslocoDirective, MoneyPipe, Badge, Button, Card, EmptyState, Icon],
  templateUrl: './card-invoices.html',
})
export class CardInvoices {
  private readonly repository = inject(CardInvoiceRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);

  readonly accountId = input.required<string>();
  readonly card = input<Account | undefined>();
  readonly paid = output<void>();

  protected readonly invoicesResource = rxResource({
    params: () => this.accountId(),
    stream: ({ params }) => this.repository.list(params),
  });

  protected readonly paying = signal<string | null>(null);

  protected readonly invoices = computed(() => this.invoicesResource.value() ?? []);

  /** The cycle still accumulating, or - if none is open - the most recent closed one. */
  protected readonly current = computed(() => {
    const all = this.invoices();
    return (
      all.find((inv) => inv.status === 'open') ??
      [...all].reverse().find((inv) => inv.status !== 'projected')
    );
  });

  protected readonly past = computed(() => {
    const current = this.current();
    return this.invoices()
      .filter((inv) => inv.status !== 'projected' && inv !== current)
      .reverse();
  });

  protected readonly upcoming = computed(() =>
    this.invoices().filter((inv) => inv.status === 'projected'),
  );

  protected readonly cycleConfigured = computed(() => {
    const card = this.card();
    return !!card && card.closingDay != null && card.dueDay != null;
  });

  protected tone(status: CardInvoiceStatus): BadgeTone {
    return STATUS_TONE[status];
  }

  protected canPay(invoice: CardInvoice): boolean {
    return invoice.status !== 'projected' && Number(invoice.remaining) > 0;
  }

  protected async pay(invoice: CardInvoice): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'accounts.detail.invoices.payConfirm.title',
      'accounts.detail.invoices.payConfirm.message',
      'default',
      { amount: invoice.remaining, currency: invoice.currency },
    );
    if (!confirmed) return;

    this.paying.set(invoice.closeDate);
    this.repository.pay(this.accountId(), invoice.closeDate, {}).subscribe({
      next: () => {
        this.paying.set(null);
        this.invoicesResource.reload();
        this.paid.emit();
      },
      error: () => {
        this.paying.set(null);
        this.mutationErrors.show();
      },
    });
  }
}
