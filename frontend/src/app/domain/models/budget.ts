/** A spending limit for one category in one calendar month ('YYYY-MM'). */
export interface Budget {
  id: string;
  categoryId: string;
  month: string;
  amount: string;
  currency: string;
}
