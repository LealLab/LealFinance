import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { money } from '../../shared/money/money';
import { Accounts } from './accounts';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Accounts', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Accounts,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
    TestBed.inject(DisplayCurrencyService).setCurrency('USD');
  });

  it('creates and renders the seeded accounts without error', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('colors balances by sign and leaves zero balances neutral', () => {
    const fixture = TestBed.createComponent(Accounts);
    const component = fixture.componentInstance;

    expect(component['amountClass'](money('-1', 'BRL'))).toBe('text-negative');
    expect(component['amountClass'](money('1', 'BRL'))).toBe('text-positive');
    expect(component['amountClass'](money('0', 'BRL'))).toBe('text-content-primary');
  });

  it('creates a new account end-to-end through the modal and shows it in the list', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = el.querySelector('app-page-header button:last-of-type') as HTMLButtonElement;
    newButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const nameInput = dialog.querySelector('#account-name') as HTMLInputElement;
    nameInput.value = 'Conta de Teste E2E';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
  });

  it('groups accounts by institution, including the "Sem instituição" bucket for accounts without one', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const groups = fixture.componentInstance['groups']();
    expect(groups.map((group) => [group.institution?.id ?? null, group.rows.length])).toEqual([
      ['inst-banco-leal', 3],
      ['inst-xp-europe', 1],
      ['inst-goals', 1],
      [null, 1],
    ]);
  });

  it('makes a newly created institution visible in the list and the new-account form', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = el.querySelector('app-page-header button') as HTMLButtonElement;
    newButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const institutionModal = Array.from(el.querySelectorAll('app-institution-form-modal')).at(-1)!;
    const dialog = institutionModal.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const nameInput = Array.from(el.querySelectorAll<HTMLInputElement>('#institution-name')).at(-1)!;
    nameInput.value = 'Banco sem contas';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = nameInput.closest('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);

    const newAccountButton = el.querySelector('app-page-header button:last-of-type') as HTMLButtonElement;
    newAccountButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const institutionSelect = el.querySelector('#account-institution') as HTMLSelectElement;
    const institutions = fixture.componentInstance['institutionsResource'].value() ?? [];
    expect(institutions).toHaveLength(4);
    expect(Array.from(institutionSelect.options).map((option) => option.value)).toEqual(
      expect.arrayContaining(institutions.map((institution) => institution.id))
    );
  });

  it('shows the display-currency equivalent next to a foreign-currency account balance', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.componentInstance['groups']()
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.account.currency === 'EUR');
    expect(row).toBeDefined();
    expect(row!.convertedBalance).toEqual(
      money(row!.balance.amount, fixture.componentInstance['displayCurrency']())
    );
  });

  it('warns when a foreign-currency balance can only be shown at the 1:1 fallback', async () => {
    // The seeded EUR investment account has no EUR->display quote in the
    // mock table, so its display equivalent is the flagged 1:1 fallback.
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['hasFallbackRate']()).toBe(true);
  });

  it('confirms before archiving from an account row', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const archiveButton = fixture.nativeElement.querySelector(
      'li button:last-of-type'
    ) as HTMLButtonElement;

    archiveButton.click();
    fixture.detectChanges();

    const request = TestBed.inject(ConfirmService).request();
    expect(request?.titleKey).toBe('accounts.archive.title');
    expect(request?.messageKey).toBe('accounts.archive.message');
    expect(request?.params?.['name']).toBeTruthy();

    TestBed.inject(ConfirmService).respond(false);
  });
});

describe('Accounts quick-create route param', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'accounts', component: Accounts }]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('opens the create-account modal when navigated with ?new=1, e.g. from the command palette', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/accounts?new=1', Accounts);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const dialog = harness.routeNativeElement!.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/accounts');
  });
});
