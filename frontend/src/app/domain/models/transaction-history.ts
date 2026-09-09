export type TransactionSnapshot = Record<string, string | null>;

export interface TransactionHistoryEntry {
  id: string;
  transactionId: string;
  operation: 'create' | 'update' | 'delete';
  source: string;
  batchId?: string;
  before?: TransactionSnapshot;
  after?: TransactionSnapshot;
  createdAt: string;
}
