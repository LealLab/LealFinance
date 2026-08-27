import { toCsv } from './transaction-csv';

describe('toCsv', () => {
  it('joins rows with CRLF and keeps plain fields unquoted', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2');
  });

  it('quotes fields containing a comma, quote, or newline and doubles inner quotes', () => {
    const csv = toCsv(
      ['desc'],
      [['a, b'], ['say "hi"'], ['line1\nline2']],
    );
    expect(csv).toBe('desc\r\n"a, b"\r\n"say ""hi"""\r\n"line1\nline2"');
  });

  it('neutralises leading formula characters', () => {
    expect(toCsv(['x'], [['=SUM(A1)'], ['+1'], ['-1'], ['@cmd']])).toBe(
      'x\r\n"\'=SUM(A1)"\r\n"\'+1"\r\n"\'-1"\r\n"\'@cmd"',
    );
  });

  it('quotes fields with edge whitespace', () => {
    expect(toCsv(['x'], [[' padded ']])).toBe('x\r\n" padded "');
  });

  it('preserves visible header order', () => {
    expect(toCsv(['Date', 'Amount', 'Account'], [['d', 'a', 'acc']])).toBe(
      'Date,Amount,Account\r\nd,a,acc',
    );
  });
});
