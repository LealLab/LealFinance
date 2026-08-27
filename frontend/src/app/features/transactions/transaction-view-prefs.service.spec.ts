import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TransactionViewPrefsService } from './transaction-view-prefs.service';

const STORAGE_KEY = 'lealfinance.transactions.view';

describe('TransactionViewPrefsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('defaults to all columns and a 50-row page', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    expect(prefs.pageSize()).toBe(50);
    expect([...prefs.columns()].sort()).toEqual(
      ['account', 'amount', 'category', 'date', 'description'].sort(),
    );
  });

  it('persists a page-size change to localStorage', () => {
    TestBed.inject(TransactionViewPrefsService).setPageSize(100);
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).pageSize).toBe(100);
  });

  it('ignores a page size outside the allowed set', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.setPageSize(999);
    expect(prefs.pageSize()).toBe(50);
  });

  it('toggles a column off and back on', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.toggleColumn('category');
    expect(prefs.isVisible('category')).toBe(false);
    prefs.toggleColumn('category');
    expect(prefs.isVisible('category')).toBe(true);
  });

  it('never hides the last remaining column', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    for (const column of ['date', 'description', 'category', 'account'] as const) {
      prefs.toggleColumn(column);
    }
    prefs.toggleColumn('amount');
    expect([...prefs.columns()]).toEqual(['amount']);
  });

  it('drops unknown column ids when reading stored state', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pageSize: 25, columns: ['date', 'bogus', 'amount'] }),
    );
    const prefs = TestBed.inject(TransactionViewPrefsService);
    expect(prefs.pageSize()).toBe(25);
    expect([...prefs.columns()]).toEqual(['date', 'amount']);
  });
});
