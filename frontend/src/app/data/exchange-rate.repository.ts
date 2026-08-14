import { Observable } from 'rxjs';
import { ExchangeRate } from '../domain/models/exchange-rate';

/**
 * See account.repository.ts for the DI-token pattern this follows. Not to
 * be confused with core/exchange-rate.service.ts, which calls the one
 * real backend endpoint this scaffold has - this repository is the
 * mock-data-era stand-in used for multi-currency display (net worth,
 * account balances) until that domain is wired together for real.
 */
export abstract class ExchangeRateRepository {
  abstract getRate(baseCode: string, quoteCode: string, asOf?: string): Observable<ExchangeRate>;
}
