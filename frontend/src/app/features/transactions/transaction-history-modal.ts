import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { of } from 'rxjs';
import { TransactionRepository } from '../../data/transaction.repository';
import { TransactionHistoryEntry } from '../../domain/models/transaction-history';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { Modal } from '../../shared/ui/modal/modal';

/**
 * t(transactions.history.operation.create, transactions.history.operation.update,
 * transactions.history.operation.delete, transactions.history.source.manual,
 * transactions.history.source.import, transactions.history.source.import_undo,
 * transactions.history.source.recurring, transactions.history.source.loan,
 * transactions.history.source.card, transactions.history.source.investment,
 * transactions.history.source.bulk, transactions.history.field.type,
 * transactions.history.field.date, transactions.history.field.amount,
 * transactions.history.field.currency, transactions.history.field.account_id,
 * transactions.history.field.to_account_id, transactions.history.field.category_id,
 * transactions.history.field.description, transactions.history.field.notes,
 * transactions.history.field.recurring_rule_id, transactions.history.field.loan_id,
 * transactions.history.field.card_invoice_close_date,
 * transactions.history.field.installment_group_id,
 * transactions.history.field.installment_number,
 * transactions.history.field.installment_count, transactions.history.field.conversion_amount,
 * transactions.history.field.conversion_currency, transactions.history.field.conversion_fee,
 * transactions.history.field.conversion_rate, transactions.history.field.conversion_source)
 */
@Component({
  selector: 'app-transaction-history-modal',
  imports: [TranslocoDirective, DatePipe, LoadError, Modal],
  templateUrl: './transaction-history-modal.html',
  styleUrl: './transaction-history-modal.scss',
})
export class TransactionHistoryModal {
  private readonly repository = inject(TransactionRepository);

  readonly open = model.required<boolean>();
  readonly transactionId = input<string | undefined>();

  protected readonly historyResource = rxResource({
    params: () => ({ id: this.transactionId() }),
    stream: ({ params }) =>
      params.id ? this.repository.history(params.id) : of([] as TransactionHistoryEntry[]),
  });
  protected readonly entries = computed(() => this.historyResource.value() ?? []);
  protected readonly diffs = computed(() => {
    const result = new Map<string, { field: string; before: string | null; after: string | null }[]>();
    for (const entry of this.entries()) {
      if (entry.operation !== 'update') continue;
      const keys = new Set([
        ...Object.keys(entry.before ?? {}),
        ...Object.keys(entry.after ?? {}),
      ]);
      result.set(
        entry.id,
        [...keys]
          .filter((field) => (entry.before?.[field] ?? null) !== (entry.after?.[field] ?? null))
          .map((field) => ({
            field,
            before: entry.before?.[field] ?? null,
            after: entry.after?.[field] ?? null,
          })),
      );
    }
    return result;
  });

  protected diffFor(entry: TransactionHistoryEntry) {
    return this.diffs().get(entry.id) ?? [];
  }
}
