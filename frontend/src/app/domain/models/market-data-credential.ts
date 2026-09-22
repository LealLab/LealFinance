export type MarketDataProvider = 'twelve_data' | 'brapi' | 'coingecko';
export type MarketDataCredentialSource = 'user' | 'env' | 'none';

export interface MarketDataCredentialStatus {
  provider: MarketDataProvider;
  configured: boolean;
  source: MarketDataCredentialSource;
}
