// Shape returned by the `transactions` Edge Function -- see
// /supabase/functions/_shared/transactionsData.ts's toClientRows().
export type Transaction = {
  Id: number;
  Date: string;
  Payee: string;
  Category: string;
  Amount: number;
  Account: string;
  IsTransfer: boolean;
  // Authorized by the bank but not yet settled. Counted in every total
  // like any other row -- it is money already spent -- but drawn with a
  // marker so a figure that can still change is distinguishable from one
  // that can't.
  Pending: boolean;
};
