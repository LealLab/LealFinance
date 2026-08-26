import { Observable } from 'rxjs';
import {
  InvestmentPosition,
  InvestmentSummary,
  InvestmentWallet,
} from '../domain/models/investment';

export type InvestmentWalletCreate =
  Omit<InvestmentWallet, 'id' | 'accountId' | 'archived'> & { archived?: boolean };
export type InvestmentWalletUpdate = Partial<
  Omit<InvestmentWallet, 'id' | 'accountId' | 'archived'>
>;

export abstract class InvestmentWalletRepository {
  abstract list(): Observable<InvestmentWallet[]>;
  abstract get(id: string): Observable<InvestmentWallet | undefined>;
  abstract create(input: InvestmentWalletCreate): Observable<InvestmentWallet>;
  abstract update(id: string, changes: InvestmentWalletUpdate): Observable<InvestmentWallet>;
  abstract setArchived(id: string, archived: boolean): Observable<InvestmentWallet>;
  abstract positions(walletId: string): Observable<InvestmentPosition[]>;
  abstract summary(): Observable<InvestmentSummary>;
}
