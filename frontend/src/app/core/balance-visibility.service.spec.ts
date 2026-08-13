import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BalanceVisibilityService } from './balance-visibility.service';

describe('BalanceVisibilityService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  function create(): BalanceVisibilityService {
    const service = TestBed.inject(BalanceVisibilityService);
    TestBed.tick();
    return service;
  }

  it('defaults to visible (not hidden) when nothing is stored', () => {
    const service = create();

    expect(service.hidden()).toBe(false);
  });

  it('reads a stored preference on startup', () => {
    localStorage.setItem('lealfinance.balancesHidden', 'true');

    const service = create();

    expect(service.hidden()).toBe(true);
  });

  it('toggle flips the value and persists it', () => {
    const service = create();

    service.toggle();
    TestBed.tick();

    expect(service.hidden()).toBe(true);
    expect(localStorage.getItem('lealfinance.balancesHidden')).toBe('true');

    service.toggle();
    TestBed.tick();

    expect(service.hidden()).toBe(false);
    expect(localStorage.getItem('lealfinance.balancesHidden')).toBe('false');
  });

  it('setHidden sets an explicit value', () => {
    const service = create();

    service.setHidden(true);
    TestBed.tick();

    expect(service.hidden()).toBe(true);
  });
});
