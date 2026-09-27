import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCardInvoiceRepository } from '../../data/mock/mock-card-invoice.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { money } from '../../shared/money/money';
import { AccountDetail } from './account-detail';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

// Route target for the post-delete navigation test below - deleteAccount()
// only needs somewhere for Router.navigate(['/accounts']) to resolve to.
@Component({ selector: 'app-accounts-list-stub', template: '' })
class AccountsListStub {}

describe('AccountDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountDetail,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'accounts', component: AccountsListStub }]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CardInvoiceRepository, useClass: MockCardInvoiceRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('shows a not-found state for an unknown id without throwing', async () => {
    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', 'does-not-exist');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['account']()).toBeUndefined();
  });

  it('renders a seeded account by id', async () => {
    const repository = TestBed.inject(AccountRepository);
    const [account] = await new Promise<Account[]>((resolve) => {
      repository.list().subscribe((accounts) => resolve(accounts));
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', account.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['account']()).toEqual(account);
  });

  it('shows the display-currency equivalent next to a foreign-currency account balance', async () => {
    TestBed.inject(DisplayCurrencyService).setCurrency('USD');
    const repository = TestBed.inject(AccountRepository);
    const account = await new Promise<Account>((resolve) => {
      repository.list().subscribe((accounts) => resolve(accounts.find((a) => a.currency === 'EUR')!));
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', account.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const balance = fixture.componentInstance['balance']();
    expect(balance).toBeDefined();
    expect(fixture.componentInstance['convertedBalance']()).toEqual(money(balance!.amount, 'USD'));
  });

  it('asks for confirmation before archiving from the detail page', async () => {
    const repository = TestBed.inject(AccountRepository);
    const account = await new Promise<Account>((resolve) => {
      repository.list().subscribe((accounts) => resolve(accounts.find((item) => !item.archived)!));
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', account.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // No stable hook for the desktop-only archive button - queried by its
    // Transloco-resolved label, not hardcoded copy.
    const archiveLabel = TestBed.inject(TranslocoService).translate('accounts.actions.archive');
    const archiveButton = Array.from(
      fixture.nativeElement.querySelectorAll('app-page-header button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.includes(archiveLabel))!;
    archiveButton.click();
    fixture.detectChanges();

    const request = TestBed.inject(ConfirmService).request();
    expect(request?.titleKey).toBe('accounts.archive.title');
    expect(request?.params).toEqual({ name: account.name });

    TestBed.inject(ConfirmService).respond(false);
  });

  it('asks for confirmation before deleting from the detail page, then navigates to the list on confirm', async () => {
    const repository = TestBed.inject(AccountRepository);
    const account = await new Promise<Account>((resolve) => {
      repository.list().subscribe((accounts) => resolve(accounts[0]));
    });

    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', account.id);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const deleteLabel = TestBed.inject(TranslocoService).translate('accounts.actions.delete');
    const deleteButton = Array.from(
      fixture.nativeElement.querySelectorAll('app-page-header button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.includes(deleteLabel))!;
    deleteButton.click();
    fixture.detectChanges();

    const request = TestBed.inject(ConfirmService).request();
    expect(request?.titleKey).toBe('accounts.delete.title');
    expect(request?.params).toEqual({ name: account.name });

    TestBed.inject(ConfirmService).respond(true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/accounts');
  });
});
