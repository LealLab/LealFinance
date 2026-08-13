import { RecurringFrequency } from './recurring';

/** Metadata layered on top of a goal Account. The balance remains derived from ledger entries. */
export interface Goal {
  id: string;
  accountId: string;
  name: string;
  targetAmount: string;
  currency: string;
  targetDate?: string;
  frequency?: RecurringFrequency;
  interval?: number;
  archived: boolean;
}
