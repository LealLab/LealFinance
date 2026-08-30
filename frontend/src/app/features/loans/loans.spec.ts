import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { LoanRepository } from '../../data/loan.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MockLoanRepository } from '../../data/mock/mock-loan.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockStore } from '../../data/mock/mock-store';
import { Loans } from './loans';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Loans', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Loans,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: LoanRepository, useClass: MockLoanRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
      ],
    }).compileComponents();
  });

  it('renders the seeded loan with its computed installment and progress', async () => {
    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Empréstimos');
    expect(fixture.nativeElement.textContent).toContain('Financiamento do carro');
    expect(fixture.nativeElement.textContent).toContain('de 48 parcelas pagas');
  });

  it('hides archived loans until the toggle is on', async () => {
    const store = TestBed.inject(MockStore);
    const loanId = store.listLoans()[0].id;
    store.updateLoan(loanId, { archived: true });

    const fixture = TestBed.createComponent(Loans);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Financiamento do carro');

    fixture.componentInstance['showArchived'].set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Financiamento do carro');
  });
});
