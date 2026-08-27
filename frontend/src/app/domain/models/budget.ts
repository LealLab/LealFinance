/** A spending limit for one group in one calendar month ('YYYY-MM'). */
export interface Budget {
  id: string;
  groupId: string;
  month: string;
  amount: string;
  currency: string;
}
