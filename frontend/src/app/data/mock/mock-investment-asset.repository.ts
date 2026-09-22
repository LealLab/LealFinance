import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PreferenceService } from '../../core/preference.service';
import { InvestmentAsset } from '../../domain/models/investment';
import {
  InvestmentAssetCreate,
  InvestmentAssetRepository,
  InvestmentAssetUpdate,
} from '../investment-asset.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockInvestmentAssetRepository extends InvestmentAssetRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);
  private readonly preferences = inject(PreferenceService);

  list(): Observable<InvestmentAsset[]> {
    return mockResult(() => this.store.investmentAssets(), this.latencyMs);
  }

  create(input: InvestmentAssetCreate): Observable<InvestmentAsset> {
    return mockResult(
      () =>
        this.store.createInvestmentAsset({
          ...input,
          currency: this.preferences.preferences()?.baseCurrency ?? 'USD',
          archived: input.archived ?? false,
        }),
      this.latencyMs,
    );
  }

  update(id: string, changes: InvestmentAssetUpdate): Observable<InvestmentAsset> {
    return mockResult(() => this.store.updateInvestmentAsset(id, changes), this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<InvestmentAsset> {
    return mockResult(
      () => this.store.updateInvestmentAsset(id, { archived }),
      this.latencyMs,
    );
  }
}
