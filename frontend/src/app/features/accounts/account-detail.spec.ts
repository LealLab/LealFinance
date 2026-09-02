import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

describe('AccountDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountDetail,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
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

    const archiveButton = fixture.nativeElement.querySelector(
      'app-page-header button:last-of-type'
    ) as HTMLButtonElement;
    archiveButton.click();
    fixture.detectChanges();

    const request = TestBed.inject(ConfirmService).request();
    expect(request?.titleKey).toBe('accounts.archive.title');
    expect(request?.params).toEqual({ name: account.name });

    TestBed.inject(ConfirmService).respond(false);
  });
});
