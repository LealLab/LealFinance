import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { OpenFinanceRepository } from '../../data/open-finance.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockOpenFinanceRepository } from '../../data/mock/mock-open-finance.repository';
import { MockStore } from '../../data/mock/mock-store';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { OpenFinance } from './open-finance';

describe('OpenFinance', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpenFinance, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: OpenFinanceRepository, useClass: MockOpenFinanceRepository },
      ],
    }).compileComponents();
  });

  it('offers keep and delete choices before disconnecting an item', async () => {
    const fixture = TestBed.createComponent(OpenFinance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const store = TestBed.inject(MockStore);
    const item = store.openFinanceItemsState()[0];
    const pending = fixture.componentInstance['disconnect'](item);
    await Promise.resolve();

    const confirm = TestBed.inject(ConfirmService);
    expect(confirm.request()?.choices?.map((choice) => choice.value)).toEqual(['keep', 'delete']);

    confirm.respondChoice('keep');
    await pending;
    expect(store.openFinanceItemsState().some((candidate) => candidate.id === item.id)).toBe(false);
  });
});
