import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  InvestmentAsset,
  InvestmentPosition,
  InvestmentSummary,
  InvestmentTransaction,
  InvestmentWallet,
} from '../../domain/models/investment';
import {
  InvestmentWalletCreate,
  InvestmentWalletRepository,
  InvestmentWalletUpdate,
} from '../investment-wallet.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

// Mock-only arithmetic uses Number; production positions stay decimal strings from the API.
const decimal = (value: number): string => value.toFixed(10).replace(/\.?0+$/, '') || '0';

interface Fold {
  quantity: number;
  cost: number;
  realizedGain: number;
  dividendIncome: number;
  feesPaid: number;
}

function fold(asset: InvestmentAsset, rows: InvestmentTransaction[]): InvestmentPosition {
  const result: Fold = {
    quantity: 0,
    cost: 0,
    realizedGain: 0,
    dividendIncome: 0,
    feesPaid: 0,
  };

  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const quantity = Number(row.quantity ?? 0);
    const price = Number(row.price ?? 0);
    const fee = Number(row.fee);
    const amount = Number(row.amount);
    if (row.type === 'buy') {
      result.quantity += quantity;
      result.cost += quantity * price + fee;
    } else if (row.type === 'sell') {
      if (result.quantity <= 0 || quantity > result.quantity) {
        throw new Error('cannot sell more than the held quantity');
      }
      const averageCost = result.cost / result.quantity;
      result.realizedGain += quantity * price - fee - averageCost * quantity;
      result.quantity -= quantity;
      result.cost -= averageCost * quantity;
      if (result.quantity === 0) result.cost = 0;
    } else if (row.type === 'dividend') {
      result.dividendIncome += amount;
    } else {
      result.feesPaid += amount;
    }
  }

  const price = asset.manualPrice;
  // ponytail: mock fixtures keep asset and wallet currencies equal; add conversion when quote pairs are mocked.
  const marketValue = price === undefined ? undefined : result.quantity * Number(price);
  return {
    asset,
    quantity: decimal(result.quantity),
    averageCost: decimal(result.quantity > 0 ? result.cost / result.quantity : 0),
    bookValue: decimal(result.cost),
    price,
    priceIsStale: price === undefined,
    marketValue: marketValue === undefined ? undefined : decimal(marketValue),
    unrealizedGain:
      marketValue === undefined ? undefined : decimal(marketValue - result.cost),
    realizedGain: decimal(result.realizedGain),
    dividendIncome: decimal(result.dividendIncome),
    feesPaid: decimal(result.feesPaid),
    // ponytail: mock fixtures are same-currency and have no quote fallback source.
    marketValueIsFallback: false,
  };
}

function positionsFor(
  walletId: string,
  wallets: readonly InvestmentWallet[],
  assets: readonly InvestmentAsset[],
  transactions: readonly InvestmentTransaction[],
): InvestmentPosition[] {
  if (!wallets.some((wallet) => wallet.id === walletId)) return [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetIds = [...new Set(
    transactions
      .filter((transaction) => transaction.walletId === walletId && transaction.assetId)
      .map((transaction) => transaction.assetId!),
  )];
  return assetIds.flatMap((assetId) => {
    const asset = assetById.get(assetId);
    return asset
      ? [fold(asset, transactions.filter((transaction) => transaction.walletId === walletId && transaction.assetId === assetId))]
      : [];
  });
}

@Injectable({ providedIn: 'root' })
export class MockInvestmentWalletRepository extends InvestmentWalletRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<InvestmentWallet[]> {
    return mockResult(() => this.store.investmentWallets(), this.latencyMs);
  }

  get(id: string): Observable<InvestmentWallet | undefined> {
    return mockResult(
      () => this.store.investmentWallets().find((wallet) => wallet.id === id),
      this.latencyMs,
    );
  }

  create(input: InvestmentWalletCreate): Observable<InvestmentWallet> {
    return mockResult(() => {
      const archived = input.archived ?? false;
      const account = this.store.createAccount({
        name: input.name,
        type: 'investment',
        currency: input.currency,
        openingBalance: '0',
        institutionId: input.institutionId,
        archived,
      });
      return this.store.createInvestmentWallet({ ...input, accountId: account.id, archived });
    }, this.latencyMs);
  }

  update(id: string, changes: InvestmentWalletUpdate): Observable<InvestmentWallet> {
    return mockResult(() => {
      const wallet = this.store.updateInvestmentWallet(id, changes);
      this.store.updateAccount(wallet.accountId, {
        ...(Object.prototype.hasOwnProperty.call(changes, 'name') ? { name: changes.name } : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'currency')
          ? { currency: changes.currency }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'institutionId')
          ? { institutionId: changes.institutionId }
          : {}),
      });
      return wallet;
    }, this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<InvestmentWallet> {
    return mockResult(() => {
      const wallet = this.store.updateInvestmentWallet(id, { archived });
      this.store.updateAccount(wallet.accountId, { archived });
      return wallet;
    }, this.latencyMs);
  }

  positions(walletId: string): Observable<InvestmentPosition[]> {
    return mockResult(
      () =>
        positionsFor(
          walletId,
          this.store.investmentWallets(),
          this.store.investmentAssets(),
          this.store.investmentTransactions(),
        ),
      this.latencyMs,
    );
  }

  summary(): Observable<InvestmentSummary> {
    return mockResult(() => {
      const wallets = this.store.investmentWallets();
      const totalCurrency = wallets[0]?.currency;
      if (!totalCurrency) {
        return {
          totalBookValue: '0',
          totalMarketValue: '0',
          totalUnrealizedGain: '0',
          walletCount: 0,
        };
      }

      const positions = wallets
        .filter((wallet) => wallet.currency === totalCurrency)
        .flatMap((wallet) =>
          positionsFor(
            wallet.id,
            wallets,
            this.store.investmentAssets(),
            this.store.investmentTransactions(),
          ),
        );
      const bookValue = positions.reduce((total, position) => total + Number(position.bookValue), 0);
      const marketValues = positions.map((position) => position.marketValue);
      const gains = positions.map((position) => position.unrealizedGain);
      return {
        totalBookValue: decimal(bookValue),
        totalMarketValue: marketValues.some((value) => value === undefined)
          ? undefined
          : decimal(marketValues.reduce((total, value) => total + Number(value), 0)),
        totalUnrealizedGain: gains.some((value) => value === undefined)
          ? undefined
          : decimal(gains.reduce((total, value) => total + Number(value), 0)),
        walletCount: wallets.length,
      };
    }, this.latencyMs);
  }
}
