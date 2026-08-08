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
};
