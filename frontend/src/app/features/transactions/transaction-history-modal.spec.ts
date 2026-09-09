import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { TransactionRepository } from '../../data/transaction.repository';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { TransactionHistoryEntry } from '../../domain/models/transaction-history';
import { TransactionHistoryModal } from './transaction-history-modal';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

class HistoryStubRepository extends MockTransactionRepository {
  override history(id: string): Observable<TransactionHistoryEntry[]> {
    if (id !== 'with-history') return of([]);
    return of([
      {
        id: 'h1',
        transactionId: id,
        operation: 'create',
        source: 'manual',
        createdAt: '2026-01-01T00:00:00Z',
        after: { amount: '10.0000', description: 'Coffee' },
      },
      {
        id: 'h2',
        transactionId: id,
        operation: 'update',
        source: 'manual',
        createdAt: '2026-01-02T00:00:00Z',
        before: { amount: '10.0000', description: 'Coffee' },
        after: { amount: '12.5000', description: 'Coffee' },
      },
    ]);
  }
}

describe('TransactionHistoryModal', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionHistoryModal, provideTestTransloco('en-US')],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale('en-US'),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: TransactionRepository, useClass: HistoryStubRepository },
      ],
    }).compileComponents();
  });

  async function render(transactionId: string) {
    const fixture = TestBed.createComponent(TransactionHistoryModal);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('transactionId', transactionId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('shows the empty state for a transaction without history', async () => {
    const fixture = await render('transaction-1');
    expect(fixture.nativeElement.textContent).toContain('No history yet.');
  });

  it('lists only the fields that changed on an update entry', async () => {
    const fixture = await render('with-history');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('12.5000');
    expect(text).toContain('10.0000');
    // description did not change between before/after, so it is not listed as a diff
    expect(text).not.toContain('Coffee');
  });
});
