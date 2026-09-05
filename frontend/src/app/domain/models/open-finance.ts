export type PluggyEnvironment = 'sandbox' | 'production';

export interface PluggyCredentialStatus {
  configured: boolean;
  environment?: PluggyEnvironment;
}

export interface PluggyItem {
  id: string;
  externalId: string;
  connectorId: number;
  connectorName: string;
  connectorImageUrl?: string;
  status: string;
  executionStatus?: string;
  statusDetail?: Record<string, unknown>;
  institutionId?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
  consentExpiresAt?: string;
}

export interface PluggyAccount {
  id: string;
  pluggyItemId: string;
  accountId?: string;
  externalId: string;
  type: string;
  subtype: string;
  name: string;
  number?: string;
  currency: string;
  syncedBalance: number;
  creditLimit?: number;
  availableCreditLimit?: number;
  raw: Record<string, unknown>;
  lastTransactionDate?: string;
  syncEnabled: boolean;
}

export interface PluggyConnectToken {
  accessToken: string;
}

export interface PluggySyncResult {
  transactionsImported: number;
  accountsSynced: number;
  error?: string;
}
