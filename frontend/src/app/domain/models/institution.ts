import type { IconName } from '../../shared/ui/icon/icon';

/**
 * A grouping layer above Accounts — a bank, brokerage, wallet provider,
 * etc. Purely a display/organizational concept: nothing on `Transaction`
 * references an institution directly, only `Account.institutionId` does
 * (see domain/models/account.ts), and an account legitimately has none
 * (e.g. a `cash` account).
 */
export interface Institution {
  id: string;
  name: string;
  icon: IconName;
  /** Hex string for a group-header accent chip — same convention as Category.color. */
  color?: string;
  archived: boolean;
  /** Display order, lowest first. */
  position: number;
}
