import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { Money, money, multiply } from '../../shared/money/money';
import { Goals } from './goals';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Goals', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Goals,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
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

    const row = fixture.componentInstance['rows']()[0]!;
    expect(row.progress.current).toEqual(money('1286.4', 'BRL'));
    expect(row.progress.target).toEqual(money('12000', 'BRL'));
  });

  it('warns when a goal can only be shown at the 1:1 fallback rate', async () => {
    // Seeded goals are BRL; EUR has no BRL_EUR quote in the mock table
    // (see mock-exchange-rate.repository.ts), so display-in-EUR falls
    // through to the flagged 1:1 fallback.
    TestBed.inject(DisplayCurrencyService).setCurrency('EUR');
    const fixture = TestBed.createComponent(Goals);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['hasFallbackRate']()).toBe(true);
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
