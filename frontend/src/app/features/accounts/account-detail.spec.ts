import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { AccountDetail } from './account-detail';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('AccountDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AccountDetail,
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
        { provide: InstitutionRepository, useClass: MockInstitutionRepository }
      ]
    }).compileComponents();
  });

  it('shows a not-found state for an unknown id without throwing', async () => {
    const fixture = TestBed.createComponent(AccountDetail);
    fixture.componentRef.setInput('id', 'does-not-exist');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Conta não encontrada');
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

    expect(fixture.nativeElement.textContent).toContain(account.name);
  });
});
