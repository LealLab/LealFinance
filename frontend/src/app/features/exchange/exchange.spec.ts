import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { ManualRateRepository } from '../../data/manual-rate.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockManualRateRepository } from '../../data/mock/mock-manual-rate.repository';
import { MockRecurringRuleRepository } from '../../data/mock/mock-recurring-rule.repository';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { MetadataService } from '../../core/metadata.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { Exchange } from './exchange';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Exchange', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Exchange,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ManualRateRepository, useClass: MockManualRateRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
        { provide: RecurringRuleRepository, useClass: MockRecurringRuleRepository }
      ]
    }).compileComponents();
    TestBed.inject(MetadataService).currencies.set(
      ['BRL', 'USD', 'EUR', 'GBP'].map((code) => ({
        code,
        name: code,
        symbol: code,
        decimalDigits: 2,
        isActive: true,
      })),
    );
    TestBed.inject(DisplayCurrencyService).setCurrency('USD');
  });

  it('renders the "needs attention" and "manual rates" empty states when there is no cross-currency activity', async () => {
    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['needsAttentionRows']()).toHaveLength(0);
    expect(fixture.componentInstance['manualRates']()).toHaveLength(0);
  });

  it('flags an account currency with no real rate to the display currency, even with no transaction involved', async () => {
    // The seeded EUR investment account (see data/mock/fixtures.ts) has no
    // known rate to the default USD display currency in the mock table -
    // this is a live coverage gap, not tied to any saved transaction, and
    // must be surfaced even though `needsAttentionRows` (transaction-only)
    // stays empty.
    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['currenciesNeedingRate']()).toEqual(['EUR']);

    // No stable hook; queried by a Transloco-resolved label, not hardcoded copy.
    const setRateLabel = TestBed.inject(TranslocoService).translate('currency.fallbackRateWarningAction');
    const setRateButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.includes(setRateLabel))!;
    expect(setRateButton).toBeTruthy();
    setRateButton.click();
    fixture.detectChanges();

    const dialog = Array.from(
      fixture.nativeElement.querySelectorAll('dialog') as NodeListOf<HTMLDialogElement>
    ).find((d) => d.open)!;
    expect(dialog).toBeTruthy();
    expect((dialog.querySelector('#manual-rate-base') as HTMLSelectElement).value).toBe('EUR');
    expect((dialog.querySelector('#manual-rate-quote') as HTMLSelectElement).value).toBe('USD');
  });

  it('lists the live provider rate converting a foreign account to the display currency', async () => {
    // Default display currency is USD; the seeded BRL accounts resolve
    // through the mock table's BRL_USD "quote" rate (not a fallback, not
    // manual), so it belongs in the automatic-rates section.
    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      automaticRates(): { baseCode: string; quoteCode: string; source: string }[];
    };
    const row = component.automaticRates().find((r) => r.baseCode === 'BRL');
    expect(row).toBeDefined();
    expect(row!.quoteCode).toBe('USD');
    expect(row!.source).toBe('quote');

  });

  it('stops flagging a currency once a manual rate covers it', async () => {
    const manualRateRepository = TestBed.inject(ManualRateRepository);
    await new Promise<void>((resolve) => {
      manualRateRepository
        .upsert({ baseCode: 'USD', quoteCode: 'EUR', rate: '0.86', asOf: '2020-01-01' })
        .subscribe(() => resolve());
    });

    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['currenciesNeedingRate']()).toHaveLength(0);
  });

  it('lists a transaction whose conversion used a fallback rate, and opens it for editing via "Fix"', async () => {
    const accountRepository = TestBed.inject(AccountRepository);
    const transactionRepository = TestBed.inject(TransactionRepository);
    const [checking, investment] = await new Promise<Account[]>((resolve) => {
      accountRepository.list().subscribe((accounts) => resolve(accounts));
    }).then((accounts) => [
      accounts.find((a) => a.currency === 'BRL')!,
      accounts.find((a) => a.currency === 'EUR')!
    ]);

    await new Promise<void>((resolve) => {
      transactionRepository
        .create({
          type: 'transfer',
          date: '2026-01-05',
          amount: '100',
          currency: 'EUR',
          accountId: investment.id,
          toAccountId: checking.id,
          description: 'Aporte convertido às pressas',
          conversion: { amount: '100', currency: 'BRL', rate: '1', source: 'fallback' }
        })
        .subscribe(() => resolve());
    });

    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Aporte convertido às pressas');

    // No stable hook in the template, so this is queried by label - but the
    // label is resolved through Transloco rather than hardcoded, so rewording
    // the catalog moves both sides together and cannot break the query.
    const fixLabel = TestBed.inject(TranslocoService).translate('exchange.needsAttention.actions.fix');
    const fixButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.trim() === fixLabel)!;
    fixButton.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
  });

  it('adds a manual rate through the form and lists it', async () => {
    const fixture = TestBed.createComponent(Exchange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // No stable hook; queried by a Transloco-resolved label, not hardcoded copy.
    const addLabel = TestBed.inject(TranslocoService).translate('exchange.manualRates.actions.add');
    const addButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(addLabel)
    )!;
    addButton.click();
    fixture.detectChanges();

    const dialog = Array.from(el.querySelectorAll('dialog') as NodeListOf<HTMLDialogElement>).find(
      (d) => d.open
    )!;
    expect(dialog).toBeTruthy();

    const rateInput = dialog.querySelector('#manual-rate-rate') as HTMLInputElement;
    rateInput.value = '5.35';
    rateInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(fixture.componentInstance['manualRates']()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ baseCode: 'USD', quoteCode: 'BRL', rate: '5.35' }),
      ]),
    );
  });
});
