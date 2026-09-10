import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ReconciliationRepository } from '../../data/reconciliation.repository';
import { AccountRepository } from '../../data/account.repository';
import { MockReconciliationRepository } from '../../data/mock/mock-reconciliation.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { isZero, money } from '../../shared/money/money';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { Reconciliation } from './reconciliation';

describe('Reconciliation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reconciliation, provideTestTransloco('en-US')],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale('en-US'),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: ReconciliationRepository, useClass: MockReconciliationRepository },
      ],
    }).compileComponents();
  });

  it('creates a reconciliation and renders its detail', async () => {
    const accounts = await firstValueFrom(TestBed.inject(AccountRepository).list());
    const account = accounts[0];
    const balance = (await firstValueFrom(TestBed.inject(AccountRepository).balances('2026-12-31')))
      .find((item) => item.accountId === account.id)!;
    const fixture = TestBed.createComponent(Reconciliation);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance['form'].setValue({
      accountId: account.id,
      statementDate: '2026-12-31',
      statementBalance: balance.balance,
    });
    fixture.componentInstance['submit']();
    await fixture.whenStable();
    fixture.detectChanges();

    const detail = fixture.componentInstance['selected']();
    expect(detail?.reconciliation.accountId).toBe(account.id);
    if (detail && detail.entries.length > 0) {
      const marked = await firstValueFrom(
        TestBed.inject(ReconciliationRepository).setEntries(
          detail.reconciliation.id,
          detail.entries.map((entry) => entry.transactionId),
          true,
        ),
      );
      expect(marked.difference).toBe('0.0000');
    }
    fixture.componentInstance['detailResource'].reload();
    await fixture.whenStable();
    fixture.componentInstance['complete']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['selected']()?.reconciliation.status).toBe('completed');
  });

  it('uses decimal money comparison for the completion condition', () => {
    expect(isZero(money('0.0000', 'BRL'))).toBe(true);
    expect(isZero(money('0.0001', 'BRL'))).toBe(false);
  });
});
