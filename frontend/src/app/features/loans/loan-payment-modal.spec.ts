import { ComponentRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { of } from 'rxjs';
import { LoanRepository } from '../../data/loan.repository';
import { Account } from '../../domain/models/account';
import { Loan } from '../../domain/models/loan';
import { LoanPaymentModal } from './loan-payment-modal';
import ptBR from '../../../../public/i18n/pt-BR.json';

class StubLoanRepository {
  readonly payments: unknown[] = [];
  list = () => of([]);
  create = () => of({} as never);
  update = () => of({} as never);
  setArchived = () => of({} as never);
  recordPayment = (id: string, payment: unknown) => {
    this.payments.push({ id, payment });
    return of({ id: 't' } as never);
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
      TranslocoTestingModule.forRoot({
        langs: { 'pt-BR': ptBR },
        translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
      }),
    ],
    providers: [
      provideZonelessChangeDetection(),
      provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
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
});
