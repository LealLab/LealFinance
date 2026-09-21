export type UserRole = 'admin' | 'member';
export type UserTheme = 'light' | 'dark';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  aiChatEnabled: boolean;
  createdAt: string;
}

export function userInitials(user: Pick<User, 'displayName' | 'email'> | undefined): string {
  const value = user?.displayName.trim() || user?.email || '?';
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (initials || '?').toUpperCase();
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

export type JobState =
  'never_run' | 'stale' | 'stuck' | 'running' | 'success' | 'partial' | 'failed';

export interface JobHealth {
  name: string;
  state: JobState;
  status: 'running' | 'success' | 'partial' | 'failed' | null;
  startedAt?: string;
  finishedAt?: string;
  processed: number;
  failed: number;
  errorType?: string;
  intervalSeconds: number;
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
  emailEnabled: boolean;
}

export interface TotpStatus {
  enabled: boolean;
  backupCodesRemaining: number;
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
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
  /** Markdown release body, grouped into sections by .github/release.yml. */
  releaseNotes?: string;
  publishedAt?: string;
}
