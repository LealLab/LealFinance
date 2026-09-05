import { ComponentRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LoanRepository } from '../../data/loan.repository';
import { Account } from '../../domain/models/account';
import { Loan } from '../../domain/models/loan';
import { LoanPaymentModal } from './loan-payment-modal';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

class StubLoanRepository {
  readonly payments: unknown[] = [];
  readonly advances: unknown[] = [];
  list = () => of([]);
  create = () => of({} as never);
  update = () => of({} as never);
  setArchived = () => of({} as never);
  recordPayment = (id: string, payment: unknown) => {
    this.payments.push({ id, payment });
    return of({ id: 't' } as never);
  };
  advancePayments = (id: string, payment: unknown) => {
    this.advances.push({ id, payment });
    return of([]);
  };
}

const LOAN: Loan = {
  id: 'l-1',
  name: 'Car',
  categoryId: 'cat-1',
  currency: 'BRL',
  amountBorrowed: '10000',
  fees: '0',
  interestRate: '1',
  ratePeriod: 'monthly',
  installmentCount: 12,
  installmentAmount: '900.0000',
  firstPaymentDate: '2026-01-10',
  autoPost: false,
  paymentAccountId: 'acc-1',
  archived: false,
  installmentsPaid: 2,
};

const ACCOUNT: Account = {
  id: 'acc-1',
  name: 'Checking',
  type: 'checking',
  currency: 'BRL',
  openingBalance: '0',
  archived: false,
};

function setup() {
  const repo = new StubLoanRepository();
  TestBed.configureTestingModule({
    imports: [
      LoanPaymentModal,
      provideTestTransloco(),
    ],
    providers: [
      provideZonelessChangeDetection(),
      provideTestTranslocoLocale(),
      { provide: LoanRepository, useValue: repo },
    ],
  });
  const fixture = TestBed.createComponent(LoanPaymentModal);
  const ref = fixture.componentRef as ComponentRef<LoanPaymentModal>;
  ref.setInput('loan', LOAN);
  ref.setInput('accounts', [ACCOUNT]);
  ref.setInput('institutions', []);
  ref.setInput('open', true);
  fixture.detectChanges();
  return { fixture, repo, component: fixture.componentInstance };
}

describe('LoanPaymentModal', () => {
  it('prefills the installment, the next due date, and the loan payment account', () => {
    const { component } = setup();
    const value = component['form'].getRawValue();
    expect(value.amount).toBe('900.0000');
    // firstPaymentDate 2026-01-10 + 2 paid installments -> 2026-03-10
    expect(value.date).toBe('2026-03-10');
    expect(value.accountId).toBe('acc-1');
    expect(value.description).toContain('3/12');
  });

  it('records the payment through the repository', () => {
    const { component, repo } = setup();
    component['submit']();
    expect(repo.payments).toEqual([
      {
        id: 'l-1',
        payment: {
          amount: '900.0000',
          date: '2026-03-10',
          accountId: 'acc-1',
          description: expect.stringContaining('3/12'),
        },
      },
    ]);
  });

  it('recalculates the suggestion when the payment date changes but keeps the field editable', () => {
    const { component } = setup();
    component['form'].controls.date.setValue('2026-01-10');
    const discounted = component['form'].controls.amount.value;
    expect(Number(discounted)).toBeLessThan(900);
    expect(component['form'].controls.amount.disabled).toBe(false);

    component['form'].controls.amount.setValue('850');
    expect(component['form'].controls.amount.value).toBe('850');
    component['form'].controls.date.setValue('2026-01-09');
    expect(component['form'].controls.amount.value).not.toBe('850');
  });

  it('shows the prorate warning only for a batch mode, not for the next installment', () => {
    const { fixture, component } = setup();
    const warning = () => fixture.nativeElement.querySelector('.border-warning\\/30');
    expect(warning()).toBeNull();

    component['form'].controls.mode.setValue('all');
    fixture.detectChanges();
    expect(warning()).not.toBeNull();

    component['form'].controls.mode.setValue('next');
    fixture.detectChanges();
    expect(warning()).toBeNull();
  });

  it('records the last N installments as one advance request with an editable total', () => {
    const { component, repo } = setup();
    component['form'].controls.mode.setValue('last');
    component['form'].controls.count.setValue(2);
    component['form'].controls.date.setValue('2025-12-01');
    component['form'].controls.amount.setValue('1500');
    component['submit']();

    expect(repo.advances).toEqual([
      {
        id: 'l-1',
        payment: expect.objectContaining({
          mode: 'last',
          count: 2,
          amount: '1500',
          date: '2025-12-01',
        }),
      },
    ]);
  });
});
