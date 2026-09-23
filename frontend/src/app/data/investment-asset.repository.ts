import { Observable } from 'rxjs';
import { InvestmentAsset } from '../domain/models/investment';

export type InvestmentAssetCreate = Omit<InvestmentAsset, 'id' | 'archived'> & { archived?: boolean };
export type InvestmentAssetUpdate = Partial<Omit<InvestmentAsset, 'id' | 'archived'>>;

export abstract class InvestmentAssetRepository {
  abstract list(): Observable<InvestmentAsset[]>;
  abstract create(input: InvestmentAssetCreate): Observable<InvestmentAsset>;
  abstract update(id: string, changes: InvestmentAssetUpdate): Observable<InvestmentAsset>;
  abstract setArchived(id: string, archived: boolean): Observable<InvestmentAsset>;
}
