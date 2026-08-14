import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockRecurringRuleRepository } from '../../data/mock/mock-recurring-rule.repository';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Transactions } from './transactions';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Transactions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Transactions,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: RecurringRuleRepository, useClass: MockRecurringRuleRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders the seeded transactions list without error', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Transações');
  });

  it('renders the recurring rules tab without error', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['tab'].set('recurring');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Recorrências');
  });

  it('creates a new expense transaction end-to-end through the modal', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Nova transação')
    );
    newButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const accountSelect = dialog.querySelector('#tx-account') as HTMLSelectElement;
    const firstRealAccountOption = accountSelect.options[1];
    accountSelect.value = firstRealAccountOption.value;
    accountSelect.dispatchEvent(new Event('change'));

    const categorySelect = dialog.querySelector('#tx-category') as HTMLSelectElement;
    const firstRealCategoryOption = categorySelect.options[1];
    categorySelect.value = firstRealCategoryOption.value;
    categorySelect.dispatchEvent(new Event('change'));

    const amountInput = dialog.querySelector('#tx-amount') as HTMLInputElement;
    amountInput.value = '42.50';
    amountInput.dispatchEvent(new Event('input'));

    const descriptionInput = dialog.querySelector('#tx-description') as HTMLInputElement;
    descriptionInput.value = 'Transação de teste E2E';
    descriptionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(el.textContent).toContain('Transação de teste E2E');
    expect(el.textContent).toContain('42,50');
  });
});
