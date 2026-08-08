// Builds the URL for a Supabase Edge Function -- same backend the web app
// talks to (see /src/functionsClient.js in the repo root).
export function functionUrl(name: string) {
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${name}`;
}
