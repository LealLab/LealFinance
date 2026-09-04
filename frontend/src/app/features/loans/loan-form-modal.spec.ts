import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LoanRepository } from '../../data/loan.repository';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Loan } from '../../domain/models/loan';
import { LoanFormModal } from './loan-form-modal';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

class StubLoanRepository {
  readonly created: unknown[] = [];
  readonly updated: unknown[] = [];
  list = () => of([]);
  create = (input: unknown) => {
    this.created.push(input);
    return of({ ...(input as object), id: 'new' } as Loan);
  };
  update = (id: string, changes: unknown) => {
    this.updated.push({ id, changes });
    return of({ id } as Loan);
  };
  setArchived = () => of({} as Loan);
  recordPayment = () => of({} as never);
  advancePayments = () => of([]);
}

const CATEGORY: Category = {
  id: 'cat-1',
  name: 'Comfort',
  kind: 'expense',
  groupId: 'g',
  color: '#123456',
  icon: 'car',
  position: 0,
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
      LoanFormModal,
      provideTestTransloco(),
    ],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTestTranslocoLocale(),
      { provide: LoanRepository, useValue: repo },
    ],
  });
  const fixture = TestBed.createComponent(LoanFormModal);
  const ref = fixture.componentRef as ComponentRef<LoanFormModal>;
  ref.setInput('open', true);
  ref.setInput('expenseCategories', [CATEGORY]);
  ref.setInput('accounts', [ACCOUNT]);
  ref.setInput('institutions', []);
  fixture.detectChanges();
  return { fixture, repo, component: fixture.componentInstance };
}

describe('LoanFormModal', () => {
  it('previews the installment from the current form values', async () => {
    const { fixture, component } = setup();
    component['form'].patchValue({
      amountBorrowed: '1200',
      fees: '300',
      interestRate: '0',
      ratePeriod: 'annual',
      installmentCount: 12,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['installmentPreview']().amount).toBe('125.0000');
  });

  it('creates a loan without sending a client-side installment amount', () => {
    const { component, repo } = setup();
    component['form'].patchValue({
      name: 'Car',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '40000',
      fees: '0',
      interestRate: '1.2',
      ratePeriod: 'monthly',
      installmentCount: 48,
      firstPaymentDate: '2026-01-10',
    });
    component['submit']();
    expect(repo.created).toHaveLength(1);
    expect(repo.created[0]).not.toHaveProperty('installmentAmount');
    expect(repo.created[0]).toMatchObject({ name: 'Car', autoPost: false, archived: false });
  });

  it('sends the contracted installment and adjusts the rate when requested', () => {
    const { component, repo } = setup();
    component['form'].patchValue({
      name: 'Car',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '40000',
      fees: '0',
      ratePeriod: 'monthly',
      installmentCount: 48,
      contractedInstallmentAmount: '1101.1021',
      adjustInterestRate: true,
      firstPaymentDate: '2026-01-10',
    });
    expect(component['form'].controls.interestRate.value).toBe('1.2000');

    component['submit']();
    expect(repo.created[0]).toMatchObject({
      contractedInstallmentAmount: '1101.1021',
      interestRate: '1.2000',
    });
    expect(repo.created[0]).not.toHaveProperty('adjustInterestRate');
  });

  it('locks the interest rate input while the rate adjustment is on', () => {
    const { fixture, component } = setup();
    const rateInput = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#loan-rate');
    expect(rateInput()?.readOnly).toBe(false);

    component['form'].patchValue({ adjustInterestRate: true });
    fixture.detectChanges();
    expect(rateInput()?.readOnly).toBe(true);

    component['form'].patchValue({ adjustInterestRate: false });
    fixture.detectChanges();
    expect(rateInput()?.readOnly).toBe(false);
  });

  it('blocks auto-post without a payment account', () => {
    const { component, repo } = setup();
    component['form'].patchValue({
      name: 'Car',
      categoryId: 'cat-1',
      amountBorrowed: '40000',
      installmentCount: 48,
      autoPost: true,
      paymentAccountId: '',
    });
    component['submit']();
    expect(repo.created).toHaveLength(0);
    expect(component['form'].controls.paymentAccountId.errors).toEqual({ required: true });
  });

  it('edits an existing loan through update()', () => {
    const { fixture, component, repo } = setup();
    const loan: Loan = {
      id: 'l-1',
      name: 'Old',
      categoryId: 'cat-1',
      currency: 'BRL',
      amountBorrowed: '10000',
      fees: '0',
      interestRate: '1',
      ratePeriod: 'monthly',
      installmentCount: 12,
      installmentAmount: '900',
      firstPaymentDate: '2026-01-10',
      autoPost: false,
      archived: false,
      installmentsPaid: 0,
    };
    (fixture.componentRef as ComponentRef<LoanFormModal>).setInput('loan', loan);
    fixture.detectChanges();
    component['form'].patchValue({ name: 'New name', installmentCount: 24 });
    component['submit']();
    expect(repo.updated).toEqual([
      { id: 'l-1', changes: expect.objectContaining({ name: 'New name', installmentCount: 24 }) },
    ]);
  });
});
