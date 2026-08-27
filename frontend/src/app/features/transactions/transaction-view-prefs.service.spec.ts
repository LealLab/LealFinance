import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_WIDTHS, MIN_COLUMN_WIDTH } from './transaction-columns';
import { TransactionViewPrefsService } from './transaction-view-prefs.service';

const STORAGE_KEY = 'lealfinance.transactions.view';

describe('TransactionViewPrefsService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('defaults to all columns and a 25-row page', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    expect(prefs.pageSize()).toBe(25);
    expect(prefs.columns()).toEqual(['date', 'description', 'category', 'account', 'amount']);
  });

  it('persists a page-size change to localStorage', () => {
    TestBed.inject(TransactionViewPrefsService).setPageSize(100);
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).pageSize).toBe(100);
  });

  it('ignores a page size outside the allowed set', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.setPageSize(999);
    expect(prefs.pageSize()).toBe(25);
  });

  it('toggles a column off and back on', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.toggleColumn('category');
    expect(prefs.isVisible('category')).toBe(false);
    prefs.toggleColumn('category');
    expect(prefs.isVisible('category')).toBe(true);
    expect(prefs.columns()).toEqual(['date', 'description', 'account', 'amount', 'category']);
  });

  it('reorders columns and round-trips the order through localStorage', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.moveColumn('amount', 0);
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).columns).toEqual([
      'amount',
      'date',
      'description',
      'category',
      'account',
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    expect(TestBed.inject(TransactionViewPrefsService).columns()).toEqual([
      'amount',
      'date',
      'description',
      'category',
      'account',
    ]);
  });

  it('clamps a column width to the minimum', () => {
    const prefs = TestBed.inject(TransactionViewPrefsService);
    prefs.setWidth('description', MIN_COLUMN_WIDTH - 1);
    expect(prefs.widthOf('description')).toBe(MIN_COLUMN_WIDTH);
  });

  it('loads legacy preferences without widths', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pageSize: 25, columns: ['amount', 'date'] }),
    );
    const prefs = TestBed.inject(TransactionViewPrefsService);
    expect(prefs.columns()).toEqual(['amount', 'date']);
    expect(prefs.widthOf('date')).toBe(DEFAULT_WIDTHS.date);
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
