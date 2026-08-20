import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Accounts } from './accounts';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Accounts', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Accounts,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('creates and renders the seeded accounts without error', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Contas');
  });

  it('creates a new account end-to-end through the modal and shows it in the list', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Nova conta')
    );
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
    expect(el.textContent).toContain('Conta de Teste E2E');
  });

  it('groups accounts by institution, including the "Sem instituição" bucket for accounts without one', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Seeded fixtures: Banco Leal groups 3 BRL accounts, Corretora XP
    // Europe groups the single EUR investment account, and the cash
    // account has no institution - see data/mock/fixtures.ts.
    expect(text).toContain('Banco Leal');
    expect(text).toContain('Corretora XP Europe');
    expect(text).toContain('Sem instituição');
  });

  it('makes a newly created institution visible in the list and the new-account form', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = el.querySelector('app-page-header button') as HTMLButtonElement;
    expect(newButton.textContent).toContain('Nova instituição');
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
    expect(el.textContent).toContain('Banco sem contas');

    const newAccountButton = Array.from(el.querySelectorAll('app-page-header button')).find(
      (button) => button.textContent?.includes('Nova conta')
    ) as HTMLButtonElement;
    newAccountButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const institutionSelect = el.querySelector('#account-institution') as HTMLSelectElement;
    const institutionNames = Array.from(institutionSelect.options).map((option) => option.textContent?.trim());
    expect(institutionNames).toContain('Banco sem contas');
  });

  it('shows the display-currency equivalent next to a foreign-currency account balance', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const row = Array.from(el.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Investimentos (Europa)')
    )!;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('€');
    expect(row.textContent).toMatch(/\(US\$\s*[\d.,]+\)/);
  });

  it('gives account actions a visible row-hover contrast and confirms before archiving', async () => {
    const fixture = TestBed.createComponent(Accounts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const archiveButton = fixture.nativeElement.querySelector(
      'button[aria-label="Arquivar"]'
    ) as HTMLButtonElement;
    expect(archiveButton.classList).toContain('hover:!bg-surface-raised');

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
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'accounts', component: Accounts }]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
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
