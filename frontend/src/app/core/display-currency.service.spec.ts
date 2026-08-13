import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DisplayCurrencyService } from './display-currency.service';

describe('DisplayCurrencyService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('uses USD as the default display currency for new users', () => {
    expect(TestBed.inject(DisplayCurrencyService).currency()).toBe('USD');
  });

  it('keeps an explicitly persisted currency preference', () => {
    localStorage.setItem('lealfinance.displayCurrency', 'BRL');

    expect(TestBed.inject(DisplayCurrencyService).currency()).toBe('BRL');
  });
});
