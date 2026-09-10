import { CardInvoice } from '../models/card-invoice';
import { Account } from '../models/account';
import { Loan } from '../models/loan';
import { RecurringRule } from '../models/recurring';
import { Transaction } from '../models/transaction';
import { add, compare, Money, money, negate, zero } from '../../shared/money/money';
import { openLoanInstallments, loanSchedule } from './loans';
import { addDays, formatIsoDate, parseIsoDate } from './dates';
import { projectOccurrences } from './recurrence';

export type AgendaSource = 'recurrence' | 'invoice' | 'installment';
export type AgendaDirection = 'inflow' | 'outflow';

export interface AgendaInvoice {
  accountId: string;
  invoice: CardInvoice;
}

export interface AgendaEntry {
  date: string;
  source: AgendaSource;
  direction: AgendaDirection;
  amount: Money;
  /** Signed cash movement: positive for money in, negative for money out. */
  cashImpact: Money;
  realized: boolean;
  description: string;
}

export interface AgendaSummary {
  inflow: Money;
  outflow: Money;
  cashImpact: Money;
}

export interface AgendaResult {
  entries: AgendaEntry[];
  realized: AgendaSummary;
  projected: AgendaSummary;
}

export interface AgendaInput {
  rangeStart: string;
  rangeEnd: string;
  accounts: readonly Account[];
  recurringRules: readonly RecurringRule[];
  invoices: readonly AgendaInvoice[];
  loans: readonly Loan[];
  transactions: readonly Transaction[];
}

export type AgendaConverter = (amount: Money, targetCurrency: string) => Money;

const identityConverter: AgendaConverter = (amount, targetCurrency) => {
  if (amount.currency === targetCurrency) return amount;
  throw new Error(
    `No conversion available from ${amount.currency} to ${targetCurrency} (pass a real AgendaConverter)`,
  );
};

function inRange(date: string, rangeStart: string, rangeEnd: string): boolean {
  return date >= rangeStart && date <= rangeEnd;
}

function effectiveAmount(
  transaction: Pick<Transaction, 'amount' | 'currency' | 'conversion'>,
): Money {
  return transaction.conversion
    ? money(transaction.conversion.amount, transaction.conversion.currency)
    : money(transaction.amount, transaction.currency);
}

function sourceAmount(transaction: Pick<Transaction, 'amount' | 'currency'>): Money {
  return money(transaction.amount, transaction.currency);
}

function isCard(
  accountId: string | undefined,
  accountsById: ReadonlyMap<string, Account>,
): boolean {
  return accountId !== undefined && accountsById.get(accountId)?.type === 'credit_card';
}

function transactionDirection(
  transaction: Pick<Transaction, 'type' | 'accountId' | 'toAccountId'>,
  accountsById: ReadonlyMap<string, Account>,
): AgendaDirection {
  if (transaction.type === 'income' || transaction.type === 'interest') return 'inflow';
  if (transaction.type === 'expense') return 'outflow';
  return isCard(transaction.toAccountId, accountsById) ||
    !isCard(transaction.accountId, accountsById)
    ? 'outflow'
    : 'inflow';
}

function transactionCashImpact(
  transaction: Pick<
    Transaction,
    'type' | 'accountId' | 'toAccountId' | 'amount' | 'currency' | 'conversion'
  >,
  accountsById: ReadonlyMap<string, Account>,
): Money {
  const amount =
    transaction.type === 'transfer' ? sourceAmount(transaction) : effectiveAmount(transaction);
  if (transaction.type === 'income' || transaction.type === 'interest') return amount;
  if (transaction.type === 'expense') return negate(amount);
  if (isCard(transaction.toAccountId, accountsById)) return negate(amount);
  if (isCard(transaction.accountId, accountsById)) return amount;
  return zero(amount.currency);
}

function entryFromTransaction(
  transaction: Omit<Transaction, 'id'>,
  source: AgendaSource,
  realized: boolean,
  accountsById: ReadonlyMap<string, Account>,
): AgendaEntry {
  const amount =
    transaction.type === 'transfer' ? sourceAmount(transaction) : effectiveAmount(transaction);
  return {
    date: transaction.date,
    source,
    direction: transactionDirection(transaction, accountsById),
    amount,
    cashImpact: transactionCashImpact(transaction, accountsById),
    realized,
    description: transaction.description,
  };
}

function invoicePaymentEntry(
  payment: Transaction,
  accountsById: ReadonlyMap<string, Account>,
): AgendaEntry {
  // A settled invoice has no remaining amount to project. Its realized row
  // therefore comes from the transfer that actually paid it.
  return entryFromTransaction(payment, 'invoice', true, accountsById);
}

function summaryFor(
  entries: readonly AgendaEntry[],
  realized: boolean,
  targetCurrency: string,
  convert: AgendaConverter,
): AgendaSummary {
  let inflow = zero(targetCurrency);
  let outflow = zero(targetCurrency);
  let cashImpact = zero(targetCurrency);

  for (const entry of entries) {
    if (entry.realized !== realized) continue;
    if (entry.direction === 'inflow') inflow = add(inflow, convert(entry.amount, targetCurrency));
    else outflow = add(outflow, convert(entry.amount, targetCurrency));
    cashImpact = add(cashImpact, convert(entry.cashImpact, targetCurrency));
  }

  return { inflow, outflow, cashImpact };
}

export function buildAgenda(
  input: AgendaInput,
  targetCurrency: string,
  convert: AgendaConverter = identityConverter,
): AgendaResult {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const transactionsInWindow = input.transactions.filter((transaction) =>
    inRange(transaction.date, input.rangeStart, input.rangeEnd),
  );
  const postedOccurrences = new Set(
    transactionsInWindow
      .filter((transaction) => transaction.recurringRuleId)
      .map((transaction) => `${transaction.recurringRuleId}|${transaction.date}`),
  );
  const entries: AgendaEntry[] = [];

  for (const transaction of transactionsInWindow) {
    if ((!transaction.recurringRuleId && !transaction.loanId) || transaction.cardInvoiceCloseDate)
      continue;
    if (isCard(transaction.accountId, accountsById)) continue;
    entries.push(
      entryFromTransaction(
        transaction,
        transaction.loanId ? 'installment' : 'recurrence',
        true,
        accountsById,
      ),
    );
  }

  for (const rule of input.recurringRules) {
    if (isCard(rule.template.accountId, accountsById)) continue;
    for (const occurrence of projectOccurrences(rule, input.rangeStart, input.rangeEnd)) {
      if (postedOccurrences.has(`${occurrence.recurringRuleId}|${occurrence.date}`)) continue;
      entries.push(entryFromTransaction(occurrence, 'recurrence', false, accountsById));
    }
  }

  for (const { accountId, invoice } of input.invoices) {
    const payments = transactionsInWindow.filter(
      (transaction) =>
        transaction.type === 'transfer' &&
        transaction.toAccountId === accountId &&
        transaction.cardInvoiceCloseDate === invoice.closeDate,
    );
    const remaining = money(invoice.remaining, invoice.currency);
    const settled = invoice.status === 'paid' || compare(remaining, zero(invoice.currency)) <= 0;

    for (const payment of payments) entries.push(invoicePaymentEntry(payment, accountsById));
    if (settled) continue;
    if (!inRange(invoice.dueDate, input.rangeStart, input.rangeEnd)) continue;
    entries.push({
      date: invoice.dueDate,
      source: 'invoice',
      direction: 'outflow',
      amount: remaining,
      cashImpact: negate(remaining),
      realized: false,
      description: accountsById.get(accountId)?.name ?? invoice.closeDate,
    });
  }

  // Fetching the full transaction history lets openLoanInstallments/loanSchedule
  // detect payments by installment number; a 30-day-only transaction query would
  // misclassify older paid installments as open.
  for (const loan of input.loans.filter((item) => !item.archived)) {
    const openByNumber = new Map(
      openLoanInstallments(loan, input.transactions).map((installment) => [
        installment.number,
        installment,
      ]),
    );
    for (const row of loanSchedule(loan, input.transactions)) {
      const open = openByNumber.get(row.number);
      if (!open || row.status === 'paid' || !inRange(row.dueDate, input.rangeStart, input.rangeEnd))
        continue;
      entries.push({
        date: row.dueDate,
        source: 'installment',
        direction: 'outflow',
        amount: open.amount,
        cashImpact: negate(open.amount),
        realized: false,
        description: loan.name,
      });
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
  return {
    entries,
    realized: summaryFor(entries, true, targetCurrency, convert),
    projected: summaryFor(entries, false, targetCurrency, convert),
  };
}

export function agendaRange(today: string): { rangeStart: string; rangeEnd: string } {
  return { rangeStart: today, rangeEnd: formatIsoDate(addDays(parseIsoDate(today), 30)) };
}
