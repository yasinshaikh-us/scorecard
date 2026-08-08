import { useState } from "react";
import { createPlaidLinkSession, type LinkSuccess, type LinkExit } from "react-native-plaid-link-sdk";
import { useAuth } from "./AuthProvider";
import { functionUrl } from "./functionsClient";

// Native equivalent of src/useBankLink.js. react-native-plaid-link-sdk
// v13's API is session-based (createPlaidLinkSession(...).open()) rather
// than the web SDK's token-prop/usePlaidLink hook -- conceptually the
// same three steps though: fetch a link_token from `plaid-link-token`,
// open Plaid's native Link UI, then exchange the public_token it returns
// via `plaid-exchange`. The device never sees a Plaid access_token, only
// the short-lived link_token/public_token, same as the web version.
//
// Note: this native module isn't available in Expo Go -- it needs a
// custom dev client (EAS build or `npx expo prebuild`). See
// mobile/README.md.
export function useBankLink(onLinked?: () => void) {
  const { session } = useAuth();
  const [status, setStatus] = useState<"idle" | "connecting">("idle");
  const [error, setError] = useState<string | null>(null);

  async function startLink() {
    if (!session) return;
    setStatus("connecting");
    setError(null);
    try {
      const tokenResp = await fetch(functionUrl("plaid-link-token"), {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const tokenData = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.link_token) {
        throw new Error(tokenData?.error || "Couldn't reach the bank-connection service");
      }

      const linkSession = await createPlaidLinkSession({
        token: tokenData.link_token,
        onSuccess: async (success: LinkSuccess) => {
          try {
            const resp = await fetch(functionUrl("plaid-exchange"), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ public_token: success.publicToken }),
            });
            if (!resp.ok) {
              const data = await resp.json().catch(() => null);
              throw new Error(data?.error || "exchange failed");
            }
            setStatus("idle");
            onLinked?.();
          } catch (e) {
            setError(e instanceof Error && e.message !== "exchange failed" ? e.message : "Couldn't finish connecting — try again");
            setStatus("idle");
          }
        },
        onExit: (exit: LinkExit) => {
          setStatus("idle");
          if (exit.error) setError(exit.error.displayMessage || exit.error.errorMessage);
        },
        onEvent: () => {},
      });
      await linkSession.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the bank-connection service");
      setStatus("idle");
    }
  }

  return { startLink, connecting: status === "connecting", error };
}
