import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { LoanRepository } from '../../data/loan.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MockLoanRepository } from '../../data/mock/mock-loan.repository';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockStore } from '../../data/mock/mock-store';
import { Loans } from './loans';
import { LoanPaymentModal } from './loan-payment-modal';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Loans', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Loans,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: LoanRepository, useClass: MockLoanRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
      ],
    }).compileComponents();
  });

  it('renders the seeded loan with its computed installment and progress', async () => {
    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.componentInstance['rows']().find((candidate) => candidate.loan.id === 'loan-car');
    expect(row).toBeDefined();
    expect(row!.progress).toMatchObject({ paid: 0, total: 48 });
  });

  it('hides archived loans until the toggle is on', async () => {
    const store = TestBed.inject(MockStore);
    const loanId = store.listLoans()[0].id;
    store.updateLoan(loanId, { archived: true });

    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['rows']()).toHaveLength(0);

    fixture.componentInstance['showArchived'].set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance['rows']()).toEqual(
      expect.arrayContaining([expect.objectContaining({ loan: expect.objectContaining({ id: loanId }) })])
    );
  });

  it('shows only the ledger entries linked to each loan', async () => {
    const store = TestBed.inject(MockStore);
    const loan = store.listLoans()[0];
    const linked = store.createTransaction({
      type: 'expense',
      date: '2026-02-01',
      amount: loan.installmentAmount,
      currency: loan.currency,
      accountId: 'account-checking',
      categoryId: loan.categoryId,
      description: 'Loan payment',
      loanId: loan.id,
      installmentNumber: 1,
      installmentCount: loan.installmentCount,
    });
    store.createTransaction({
      type: 'expense',
      date: '2026-02-02',
      amount: '10',
      currency: loan.currency,
      accountId: 'account-checking',
      categoryId: loan.categoryId,
      description: 'Unrelated',
    });

    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['loanTransactions'](loan).map((tx) => tx.id)).toEqual([
      linked.id,
    ]);
  });

  it('keeps the chosen payment mode across unrelated change-detection cycles', async () => {
    const store = TestBed.inject(MockStore);
    const loan = store.listLoans()[0];

    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['openPayment'](loan);
    fixture.detectChanges();

    const modal = fixture.debugElement.query(By.directive(LoanPaymentModal))
      .componentInstance as LoanPaymentModal;
    modal['form'].controls.mode.setValue('last');

    // `[transactions]="paymentLoanTransactions()"` must stay referentially
    // stable across re-renders, or the modal's reset effect fires again and
    // snaps `mode` back to "next" - see the regression this guards against.
    fixture.detectChanges();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(modal['form'].controls.mode.value).toBe('last');
  });
});
