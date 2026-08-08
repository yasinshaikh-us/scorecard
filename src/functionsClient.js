// Builds the URL for a Supabase Edge Function, replacing the old Vercel
// /api/* routes now that the backend lives entirely on Supabase.
export function functionUrl(name) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
}
