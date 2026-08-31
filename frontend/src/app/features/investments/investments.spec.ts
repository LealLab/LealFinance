import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockInvestmentWalletRepository } from '../../data/mock/mock-investment-wallet.repository';
import { Investments } from './investments';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Investments', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Investments,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: InvestmentWalletRepository, useClass: MockInvestmentWalletRepository },
      ],
    }).compileComponents();
  });

  it('renders the seeded investment wallet', async () => {
    const fixture = TestBed.createComponent(Investments);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['walletsResource'].value()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'investment-wallet-europe', currency: 'EUR' }),
      ])
    );
  });
});
