/**
 * The small, curated set of currencies this scaffold's screens offer when
 * creating/editing an account — deliberately not the full ISO 4217 list.
 * Matches what data/mock/mock-exchange-rate.repository.ts knows real rates
 * for (BRL, USD, GBP) plus EUR, which is kept unmapped there on purpose to
 * exercise the fallback-rate warning — see that file's doc comment.
 */
export const CURRENCY_OPTIONS: readonly string[] = ['BRL', 'USD', 'EUR', 'GBP'];
