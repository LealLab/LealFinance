import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CardInvoice, CardInvoicePayment, CardInvoiceStatus } from '../../domain/models/card-invoice';
import { Transaction } from '../../domain/models/transaction';
import { add, isNegative, money, subtract, zero } from '../../shared/money/money';
import { addMonthsClamped, formatIsoDate, parseIsoDate } from '../../domain/calc/dates';
import { CardInvoiceRepository } from '../card-invoice.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

/**
 * Test double only. It re-derives the same billing-cycle math the backend
 * owns (app/services/card_invoices.py) so component specs render against
 * the seeded ledger - a deliberate mock-only duplication, not production
 * cycle math.
 */
@Injectable({ providedIn: 'root' })
export class MockCardInvoiceRepository extends CardInvoiceRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(accountId: string, months?: { back?: number; ahead?: number }): Observable<CardInvoice[]> {
    return mockResult(() => this.derive(accountId, months?.back ?? 6, months?.ahead ?? 6), this.latencyMs);
  }

  pay(accountId: string, closeDate: string, payment: CardInvoicePayment): Observable<Transaction> {
    return mockResult(() => {
      const card = this.store.accounts().find((a) => a.id === accountId);
      if (!card) throw new Error(`Account ${accountId} not found`);
      const invoice = this.derive(accountId, 24, 24).find((i) => i.closeDate === closeDate);
      const amount = payment.amount ?? invoice?.remaining ?? '0';
      const source = payment.accountId ?? card.paymentAccountId;
      if (!source) throw new Error('An invoice payment needs a source account.');
      return this.store.createTransaction({
        type: 'transfer',
        date: payment.date ?? formatIsoDate(new Date()),
        amount,
        currency: card.currency,
        accountId: source,
        toAccountId: accountId,
        description: payment.description ?? card.name,
        cardInvoiceCloseDate: closeDate,
      });
    }, this.latencyMs);
  }

  private derive(accountId: string, monthsBack: number, monthsAhead: number): CardInvoice[] {
    const card = this.store.accounts().find((a) => a.id === accountId);
    if (!card || card.type !== 'credit_card' || card.closingDay == null || card.dueDay == null) {
      return [];
    }
    const closingDay = card.closingDay;
    const dueDay = card.dueDay;
    const today = new Date();
    const current = this.cycleCloseFor(today, closingDay);
    const closes: Date[] = [];
    for (let i = -monthsBack; i <= monthsAhead; i++) {
      closes.push(this.clampDay(addMonthsClamped(current, i), closingDay));
    }

    const txns = this.store.transactions().filter(
      (tx) => tx.accountId === accountId || tx.toAccountId === accountId,
    );

    return closes.map((close, index) => {
      const prev = index > 0 ? closes[index - 1] : addMonthsClamped(close, -1);
      let total = zero(card.currency);
      let paid = zero(card.currency);
      for (const tx of txns) {
        const txDate = parseIsoDate(tx.date);
        const inPeriod = txDate > prev && txDate <= close;
        if (tx.type === 'transfer' && tx.toAccountId === accountId) {
          const targetsThis = tx.cardInvoiceCloseDate
            ? tx.cardInvoiceCloseDate === formatIsoDate(close)
            : inPeriod;
          if (targetsThis) paid = add(paid, money(tx.amount, card.currency));
          continue;
        }
        if (!inPeriod || tx.accountId !== accountId) continue;
        if (tx.type === 'expense') total = add(total, money(tx.amount, card.currency));
        else if (tx.type === 'income' || tx.type === 'interest')
          total = subtract(total, money(tx.amount, card.currency));
        else if (tx.type === 'transfer') total = add(total, money(tx.amount, card.currency));
      }
      const remaining = subtract(total, paid);
      const due = this.dueDateFor(close, dueDay);
      return {
        closeDate: formatIsoDate(close),
        dueDate: formatIsoDate(due),
        periodStart: formatIsoDate(this.nextDay(prev)),
        periodEnd: formatIsoDate(close),
        currency: card.currency,
        total: total.amount,
        paid: paid.amount,
        remaining: remaining.amount,
        status: this.statusFor(today, prev, close, due, remaining),
      };
    });
  }

  private statusFor(
    today: Date,
    prev: Date,
    close: Date,
    due: Date,
    remaining: { amount: string; currency: string },
  ): CardInvoiceStatus {
    if (today <= prev) return 'projected';
    if (today <= close) return 'open';
    if (!isNegative(remaining) && Number(remaining.amount) <= 0) return 'paid';
    return today <= due ? 'closed' : 'overdue';
  }

  private clampDay(reference: Date, day: number): Date {
    const last = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
    return new Date(reference.getFullYear(), reference.getMonth(), Math.min(day, last));
  }

  private cycleCloseFor(charge: Date, closingDay: number): Date {
    const thisMonth = this.clampDay(charge, closingDay);
    return thisMonth >= charge ? thisMonth : this.clampDay(addMonthsClamped(thisMonth, 1), closingDay);
  }

  private dueDateFor(close: Date, dueDay: number): Date {
    const sameMonth = this.clampDay(close, dueDay);
    return sameMonth > close ? sameMonth : this.clampDay(addMonthsClamped(close, 1), dueDay);
  }

  private nextDay(date: Date): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return next;
  }
}
