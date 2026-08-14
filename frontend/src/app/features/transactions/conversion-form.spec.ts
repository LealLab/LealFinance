import { buildTransactionConversion, prefillConvertedAmount } from './conversion-form';

describe('prefillConvertedAmount', () => {
  it('converts the full origin amount when there is no fee', () => {
    expect(prefillConvertedAmount('100', 'USD', null, '5.2', 'BRL')).toBe('520.0000');
  });

  it('deducts the fee (in the origin currency) before converting', () => {
    // (100 - 1) * 5.2 = 514.8
    expect(prefillConvertedAmount('100', 'USD', '1', '5.2', 'BRL')).toBe('514.8000');
  });

  it('treats an empty fee the same as no fee', () => {
    expect(prefillConvertedAmount('100', 'USD', '', '5.2', 'BRL')).toBe('520.0000');
  });
});

describe('buildTransactionConversion', () => {
  it('records the converted amount, currency, and derived rate with no fee', () => {
    const conversion = buildTransactionConversion({
      originAmount: '100',
      originCurrency: 'USD',
      fee: null,
      convertedAmount: '520',
      destinationCurrency: 'BRL',
      quoteSource: 'quote',
      convertedTouched: false
    });

    expect(conversion).toEqual({
      amount: '520.0000',
      currency: 'BRL',
      fee: undefined,
      rate: '5.2000000000',
      source: 'quote'
    });
  });

  it('derives the rate net of the fee, and records the fee in the origin currency', () => {
    const conversion = buildTransactionConversion({
      originAmount: '100',
      originCurrency: 'USD',
      fee: '1',
      convertedAmount: '514.8',
      destinationCurrency: 'BRL',
      quoteSource: 'quote',
      convertedTouched: true
    });

    // rate is derived from (amount - fee), not the raw amount: 514.8 / 99 = 5.2
    expect(conversion.rate).toBe('5.2000000000');
    expect(conversion.fee).toBe('1.0000');
  });

  it('records source "manual" when the user typed the converted amount themselves', () => {
    const conversion = buildTransactionConversion({
      originAmount: '100',
      originCurrency: 'USD',
      fee: null,
      convertedAmount: '999',
      destinationCurrency: 'BRL',
      quoteSource: 'quote',
      convertedTouched: true
    });

    expect(conversion.source).toBe('manual');
  });

  it('records the quote source ("quote" or "fallback") when the prefilled value was left untouched', () => {
    const fromFallback = buildTransactionConversion({
      originAmount: '100',
      originCurrency: 'USD',
      fee: null,
      convertedAmount: '100',
      destinationCurrency: 'EUR',
      quoteSource: 'fallback',
      convertedTouched: false
    });

    expect(fromFallback.source).toBe('fallback');
  });
});
