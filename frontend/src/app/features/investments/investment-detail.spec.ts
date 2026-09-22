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
import { ConfirmService } from '../../core/confirm.service';
import { InvestmentDetail } from './investment-detail';
import { InvestmentAssetFormModal } from './investment-asset-form-modal';
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

  it('shows a newly created asset even before it has any transaction', async () => {
    // Regression test: positions are derived server-side from the
    // transaction ledger, so an asset with no transactions never appeared
    // anywhere in the old UI. The assets card reads straight from
    // `assetsResource`, not from positions, so a brand-new asset must show
    // up immediately.
    const fixture = TestBed.createComponent(InvestmentDetail);
    fixture.componentRef.setInput('id', 'investment-wallet-europe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      openCreateAsset: () => void;
      assetsResource: { value: () => { id: string; symbol: string }[] | undefined };
      positions: () => { asset: { symbol: string } }[];
    };

    component.openCreateAsset();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const modalDebug = fixture.debugElement.query(By.directive(InvestmentAssetFormModal));
    const modal = modalDebug.componentInstance as InvestmentAssetFormModal & {
      form: { patchValue: (value: Record<string, unknown>) => void };
      saveErrorKey: () => string | null;
      submit: () => void;
    };
    modal.form.patchValue({ symbol: 'NEWCO', name: 'New Co' });
    modal.submit();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(modal.saveErrorKey()).toBeNull();
    expect(component.assetsResource.value()).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbol: 'NEWCO' })]),
    );
    expect(component.positions().some((position) => position.asset.symbol === 'NEWCO')).toBe(
      false,
    );
    expect(fixture.nativeElement.textContent).toContain('NEWCO');
  });

  it('opens the asset form prefilled when editing from the assets card', async () => {
    const fixture = TestBed.createComponent(InvestmentDetail);
    fixture.componentRef.setInput('id', 'investment-wallet-europe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      openEditAsset: (asset: { id: string; symbol: string }) => void;
      assetsResource: { value: () => { id: string; symbol: string }[] | undefined };
    };
    const asset = component.assetsResource.value()?.[0];
    expect(asset).toBeDefined();

    component.openEditAsset(asset!);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const modalDebug = fixture.debugElement.query(By.directive(InvestmentAssetFormModal));
    const modal = modalDebug.componentInstance as InvestmentAssetFormModal & {
      form: { getRawValue: () => { symbol: string } };
    };
    expect(modal.form.getRawValue().symbol).toBe(asset!.symbol);
  });

  it('confirms before archiving an asset from the assets card', async () => {
    const fixture = TestBed.createComponent(InvestmentDetail);
    fixture.componentRef.setInput('id', 'investment-wallet-europe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      archiveAsset: (asset: { id: string; symbol: string; archived: boolean }) => Promise<void>;
      assetsResource: { value: () => { id: string; symbol: string; archived: boolean }[] | undefined; reload: () => void };
    };
    const asset = component.assetsResource.value()?.[0];
    expect(asset).toBeDefined();

    const pending = component.archiveAsset(asset!);
    await Promise.resolve();

    const request = TestBed.inject(ConfirmService).request();
    expect(request?.titleKey).toBe('investments.assets.archive.title');
    expect(request?.messageKey).toBe('investments.assets.archive.message');
    expect(request?.params?.['symbol']).toBe(asset!.symbol);

    TestBed.inject(ConfirmService).respond(true);
    await pending;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      component.assetsResource.value()?.find((current) => current.id === asset!.id)?.archived,
    ).toBe(true);
  });
});
