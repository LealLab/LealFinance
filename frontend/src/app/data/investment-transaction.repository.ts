import { Observable } from 'rxjs';
import { InvestmentTransaction } from '../domain/models/investment';

export type InvestmentTransactionCreate = Omit<InvestmentTransaction, 'id' | 'transactionId'>;
export type InvestmentTransactionUpdate = Partial<
  Omit<InvestmentTransaction, 'id' | 'walletId' | 'transactionId'>
>;

export abstract class InvestmentTransactionRepository {
  abstract list(params: {
    walletId: string;
    limit?: number;
    offset?: number;
  }): Observable<InvestmentTransaction[]>;
  abstract create(input: InvestmentTransactionCreate): Observable<InvestmentTransaction>;
  abstract update(id: string, changes: InvestmentTransactionUpdate): Observable<InvestmentTransaction>;
  abstract delete(id: string): Observable<void>;
}
