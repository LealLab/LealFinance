export type UserRole = 'admin' | 'member';
export type UserTheme = 'light' | 'dark';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface Preferences {
  locale: string;
  theme: UserTheme;
  baseCurrency: string;
  displayCurrency: string;
  balancesHidden: boolean;
  investmentsEnabled: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface CreatedInvitation extends Invitation {
  token: string;
}

export interface CurrencyMetadata {
  code: string;
  name: string;
  symbol: string;
  decimalDigits: number;
  isActive: boolean;
}

export interface PublicSettings {
  defaultCurrency: string;
  defaultLocale: string;
  agentsEnabled: boolean;
}

export interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface TotpSetup {
  /** Base32, for users typing the secret in rather than scanning. */
  secret: string;
  /** The otpauth:// URI the enrollment QR code encodes. */
  otpauthUri: string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseUrl?: string;
}
