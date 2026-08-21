import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { money } from '../../shared/money/money';
import { Dashboard } from './dashboard';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Dashboard,
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
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders the pt-BR title from the translation file', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Painel');
  });

  it('renders stat tiles, the fallback-rate warning, and the seeded account summary', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Patrimônio líquido');
    // The EUR investment account (see data/mock/fixtures.ts) has no known
    // rate in the mock exchange-rate repository on purpose, to exercise
    // this warning on a real screen.
    expect(text).toContain('Taxa de câmbio indisponível');
    expect(text).toContain('Conta Corrente');
  });

  it('colors balances by sign and transfers blue', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const component = fixture.componentInstance;

    expect(component['amountClass'](money('-1', 'BRL'))).toBe('text-negative');
    expect(component['amountClass'](money('1', 'BRL'))).toBe('text-positive');
    expect(component['amountClass'](money('0', 'BRL'))).toBe('text-content-primary');
    expect(component['transactionClass']({ type: 'transfer', amount: '10', currency: 'BRL' })).toBe(
      'text-accent',
    );
  });

  it('navigates to /exchange when the fallback-rate warning action is clicked', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((el) =>
      (el as HTMLButtonElement).textContent?.includes('Definir taxa')
    ) as HTMLButtonElement | undefined;
    button?.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/exchange']);
  });
});
