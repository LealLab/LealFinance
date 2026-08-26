import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { InvestmentAssetRepository } from '../../data/investment-asset.repository';
import { InvestmentTransactionRepository } from '../../data/investment-transaction.repository';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockInvestmentAssetRepository } from '../../data/mock/mock-investment-asset.repository';
import { MockInvestmentTransactionRepository } from '../../data/mock/mock-investment-transaction.repository';
import { MockInvestmentWalletRepository } from '../../data/mock/mock-investment-wallet.repository';
import { InvestmentDetail } from './investment-detail';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('InvestmentDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        InvestmentDetail,
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
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: InvestmentAssetRepository, useClass: MockInvestmentAssetRepository },
        { provide: InvestmentTransactionRepository, useClass: MockInvestmentTransactionRepository },
        { provide: InvestmentWalletRepository, useClass: MockInvestmentWalletRepository },
      ],
    }).compileComponents();
  });

  it('renders the seeded wallet positions', async () => {
    const fixture = TestBed.createComponent(InvestmentDetail);
    fixture.componentRef.setInput('id', 'investment-wallet-europe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('ACME');
    expect(fixture.nativeElement.textContent).toContain('WORLD');
    expect(fixture.nativeElement.textContent).toContain('Bitcoin');
  });
});
