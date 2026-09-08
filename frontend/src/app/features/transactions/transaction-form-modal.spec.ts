import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { TransactionFormModal } from './transaction-form-modal';
import { provideTestTransloco } from '../../../testing/transloco';

const CARD: Account = {
  id: 'card',
  name: 'Card',
  type: 'credit_card',
  currency: 'USD',
  openingBalance: '0',
  archived: false,
};

const CATEGORY: Category = {
  id: 'cat',
  name: 'Food',
  kind: 'expense',
  groupId: 'group',
  color: '#123456',
  icon: 'tag',
  position: 0,
};

function setup() {
  const transactions = {
    create: vi.fn().mockReturnValue(of({})),
    update: vi.fn().mockReturnValue(of({})),
  };
  const exchangeRates = {
    getRate: vi.fn().mockReturnValue(
      of({
        baseCode: 'BRL',
        quoteCode: 'USD',
        rate: '0.2',
        isFallback: false,
        source: 'quote',
        asOf: '2026-01-01',
      }),
    ),
  };

  TestBed.configureTestingModule({
    imports: [TransactionFormModal, provideTestTransloco()],
    providers: [
      provideZonelessChangeDetection(),
      { provide: TransactionRepository, useValue: transactions },
      { provide: RecurringRuleRepository, useValue: { create: vi.fn() } },
      { provide: ExchangeRateRepository, useValue: exchangeRates },
      { provide: MetadataService, useValue: { currencies: signal([{ code: 'USD' }, { code: 'BRL' }]) } },
      { provide: PreferenceService, useValue: { preferences: signal({ baseCurrency: 'USD' }) } },
    ],
  });
  const fixture = TestBed.createComponent(TransactionFormModal);
  const ref = fixture.componentRef as ComponentRef<TransactionFormModal>;
  ref.setInput('open', true);
  ref.setInput('accounts', [CARD]);
  ref.setInput('categories', [CATEGORY]);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, transactions, exchangeRates };
}

describe('TransactionFormModal', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('prefills a cross-currency amount net of the fee', async () => {
    const { fixture, component, exchangeRates } = setup();
    component['form'].patchValue({
      accountId: 'card',
      amount: '100',
      fee: '10',
      description: 'Lunch',
      currency: 'BRL',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(exchangeRates.getRate).toHaveBeenCalledWith('BRL', 'USD', expect.any(String));
    expect(component['form'].controls.convertedAmount.value).toBe('18.0000');
  });

  it('only sends an installment count for a credit-card expense with at least two installments', () => {
    const { component, transactions } = setup();
    component['form'].patchValue({
      accountId: 'card',
      amount: '120',
      categoryId: 'cat',
      description: 'Lunch',
      installments: 3,
    });
    component['submit']();

    expect(transactions.create).toHaveBeenCalledWith(expect.objectContaining({ installments: 3 }));

    transactions.create.mockClear();
    component['form'].controls.installments.setValue(1);
    component['submit']();

    expect(transactions.create.mock.calls[0][0]).not.toHaveProperty('installments');
  });
});
