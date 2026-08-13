import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
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
        { provide: TransactionRepository, useClass: MockTransactionRepository }
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
});
