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

  it('opens the start form in a sheet from the header and closes it after creating', async () => {
    const account = (await firstValueFrom(TestBed.inject(AccountRepository).list()))[0];
    const fixture = TestBed.createComponent(Reconciliation);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);

    (element.querySelector('app-page-header button[variant="primary"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(element.querySelector('app-modal #reconciliation-account')).not.toBeNull();

    fixture.componentInstance['form'].setValue({
      accountId: account.id,
      statementDate: '2026-12-31',
      statementBalance: '0',
    });
    fixture.componentInstance['submit']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('filters entries by cleared status with counts', async () => {
    const account = (await firstValueFrom(TestBed.inject(AccountRepository).list()))[0];
    const repository = TestBed.inject(ReconciliationRepository);
    const created = await firstValueFrom(repository.create({
      accountId: account.id,
      statementDate: '2026-12-31',
      statementBalance: '0',
    }));
    const entries = (await firstValueFrom(repository.detail(created.id))).entries;
    expect(entries.length).toBeGreaterThan(1);
    await firstValueFrom(repository.setEntries(created.id, [entries[0].transactionId], true));

    const fixture = TestBed.createComponent(Reconciliation);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const filterButtons = () => [...element.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
    expect(filterButtons().map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      `All${entries.length}`,
      `Pending${entries.length - 1}`,
      'Cleared1',
    ]);

    filterButtons()[1].click();
    fixture.detectChanges();
    const visible = fixture.componentInstance['visibleEntries']();
    expect(visible.length).toBe(entries.length - 1);
    expect(visible.every((entry) => !entry.cleared)).toBe(true);
    expect(filterButtons()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('uses decimal money comparison for the completion condition', () => {
    expect(isZero(money('0.0000', 'BRL'))).toBe(true);
    expect(isZero(money('0.0001', 'BRL'))).toBe(false);
  });

  it('removes reconciliations when their account is deleted', async () => {
    const accounts = TestBed.inject(AccountRepository);
    const reconciliations = TestBed.inject(ReconciliationRepository);
    const account = (await firstValueFrom(accounts.list()))[0];

    await firstValueFrom(reconciliations.create({
      accountId: account.id,
      statementDate: '2026-12-31',
      statementBalance: '0',
    }));
    await firstValueFrom(accounts.delete(account.id));

    expect(await firstValueFrom(reconciliations.list(account.id))).toEqual([]);
  });
});
