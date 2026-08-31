import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { InvestmentTransactionFormModal } from './investment-transaction-form-modal';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('InvestmentDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        InvestmentDetail,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
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

    expect(fixture.componentInstance['positions']().map((position) => position.asset.id)).toEqual(
      expect.arrayContaining([
        'investment-asset-acme',
        'investment-asset-world',
        'investment-asset-bitcoin',
      ])
    );
  });

  it('submits a buy transaction through the real form validation path', async () => {
    // Regression test: the transaction form's `currency` control is
    // disabled (always programmatically set to the wallet's own currency,
    // never user-edited) - an Angular FormControl's `valid` is always
    // false while disabled regardless of its validators, so a submit
    // check that read `form.controls.currency.valid` directly made every
    // submission fail. This drives the real component's `submit()` with a
    // fully valid buy and asserts it actually succeeds.
    const fixture = TestBed.createComponent(InvestmentDetail);
    fixture.componentRef.setInput('id', 'investment-wallet-europe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      openCreateTransaction: () => void;
      assetsResource: { value: () => { id: string }[] | undefined };
    };
    const assetId = component.assetsResource.value()?.[0]?.id;
    expect(assetId).toBeDefined();

    component.openCreateTransaction();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const modalDebug = fixture.debugElement.query(By.directive(InvestmentTransactionFormModal));
    const modal = modalDebug.componentInstance as InvestmentTransactionFormModal & {
      form: { patchValue: (value: Record<string, unknown>) => void };
      saveErrorKey: () => string | null;
      submit: () => void;
    };
    modal.form.patchValue({ assetId, quantity: '2', price: '50' });
    modal.submit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(modal.saveErrorKey()).toBeNull();
  });
});
