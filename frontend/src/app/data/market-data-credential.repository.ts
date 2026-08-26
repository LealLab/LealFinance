import { Observable } from 'rxjs';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../domain/models/market-data-credential';

export abstract class MarketDataCredentialRepository {
  abstract list(): Observable<MarketDataCredentialStatus[]>;
  abstract link(
    provider: MarketDataProvider,
    apiKey: string,
  ): Observable<MarketDataCredentialStatus>;
  abstract unlink(provider: MarketDataProvider): Observable<void>;
}
