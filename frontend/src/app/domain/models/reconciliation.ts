export type ReconciliationStatus = 'open' | 'completed';
export type ReconciliationLeg = 'own' | 'incoming';

export interface Reconciliation {
  id: string;
  accountId: string;
  statementDate: string;
  statementBalance: string;
  currency: string;
  status: ReconciliationStatus;
  completedAt?: string;
  createdAt: string;
}

export interface ReconciliationEntry {
  transactionId: string;
  leg: ReconciliationLeg;
  date: string;
  description: string;
  amount: string;
  cleared: boolean;
  clearedBy?: string;
}

export interface ReconciliationDetail {
  reconciliation: Reconciliation;
  statementBalance: string;
  bookBalance: string;
  clearedBalance: string;
  difference: string;
  entries: ReconciliationEntry[];
}
