import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
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

  it('shows the display-currency equivalent for a goal in a different currency', async () => {
    // The seeded "Viagem para Portugal" goal is BRL, while the default
    // display currency is USD - a real (non-fallback) quote exists for
    // BRL_USD in the mock exchange-rate table, so this exercises the
    // converted-amount path end-to-end.
    const fixture = TestBed.createComponent(Goals);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('R$');
    expect(text).toMatch(/\(US\$\s*[\d.,]+\)/);
  });
});
