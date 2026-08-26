export type MarketDataProvider = 'twelve_data' | 'brapi';
export type MarketDataCredentialSource = 'user' | 'env' | 'none';

export interface MarketDataCredentialStatus {
  provider: MarketDataProvider;
  configured: boolean;
  source: MarketDataCredentialSource;
}
