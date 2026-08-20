import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { GoalRepository } from '../../data/goal.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockGoalRepository } from '../../data/mock/mock-goal.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Money, multiply } from '../../shared/money/money';
import { Goals } from './goals';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Goals', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Goals,
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
        { provide: GoalRepository, useClass: MockGoalRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
      ],
    }).compileComponents();
  });

  it('renders seeded account-backed goals and their progress', async () => {
    const fixture = TestBed.createComponent(Goals);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Metas');
    expect(fixture.nativeElement.textContent).toContain('Viagem para Portugal');
    expect(fixture.nativeElement.textContent).toContain('Aporte sugerido');
  });

  it('converts a goal to the display currency via the resolved exchange rate', async () => {
    // The seeded "Viagem para Portugal" goal is BRL; pin the display
    // currency to USD explicitly rather than relying on the ambient
    // default, so this doesn't depend on what ran before it. A real
    // (non-fallback) BRL_USD quote exists in the mock exchange-rate
    // table (see mock-exchange-rate.repository.ts's KNOWN_RATES), so this
    // exercises the converted-amount path end-to-end.
    TestBed.inject(DisplayCurrencyService).setCurrency('USD');
    const fixture = TestBed.createComponent(Goals);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      rows(): {
        goal: { currency: string };
        progress: { current: Money; target: Money };
        convertedCurrent: Money | null;
        convertedTarget: Money | null;
      }[];
    };
    const row = component.rows().find((r) => r.goal.currency === 'BRL');
    expect(row).toBeDefined(); // no BRL-denominated goal in seeded fixtures

    expect(row!.convertedCurrent).toEqual(multiply(row!.progress.current, '0.1923', 'USD'));
    expect(row!.convertedTarget).toEqual(multiply(row!.progress.target, '0.1923', 'USD'));
  });
});
