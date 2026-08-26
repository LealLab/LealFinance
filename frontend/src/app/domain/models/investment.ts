/** Asset categories supported by the investment registry. */
export type InvestmentAssetClass = 'stock' | 'etf' | 'fund' | 'crypto' | 'bond' | 'other';

/** Quote providers recognized by the backend, including manual prices. */
export type InvestmentQuoteProvider = 'twelve_data' | 'brapi' | 'manual';

/** Ledger events that change an investment position or its income. */
export type InvestmentTransactionType = 'buy' | 'sell' | 'dividend' | 'fee';

/** An investment account linked to a regular account for cash movements. */
export interface InvestmentWallet {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  cashAccountId?: string;
  institutionId?: string;
  archived: boolean;
}

/** A user-owned asset and its current quote configuration. */
export interface InvestmentAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: InvestmentAssetClass;
  currency: string;
  quoteProvider: InvestmentQuoteProvider;
  manualPrice?: string;
  archived: boolean;
}

/** One immutable-style event in a wallet's investment ledger. */
export interface InvestmentTransaction {
  id: string;
  walletId: string;
  assetId?: string;
  type: InvestmentTransactionType;
  date: string;
  quantity?: string;
  price?: string;
  amount: string;
  fee: string;
  currency: string;
  transactionId?: string;
  notes?: string;
}

/** Computed, never stored - see api/v1/investments.py::_position_read. */
export interface InvestmentPosition {
  asset: InvestmentAsset;
  quantity: string;
  averageCost: string;
  bookValue: string;
  price?: string;
  priceAsOf?: string;
  priceIsStale: boolean;
  marketValue?: string;
  unrealizedGain?: string;
  realizedGain: string;
  dividendIncome: string;
  feesPaid: string;
  marketValueIsFallback: boolean;
}

/** Totals returned by the server; nullable fields indicate incomplete quotes. */
export interface InvestmentSummary {
  totalBookValue: string;
  totalMarketValue?: string;
  totalUnrealizedGain?: string;
  walletCount: number;
}
