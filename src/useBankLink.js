import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

// Wraps the Plaid Link flow (fetch a link_token -> open Link -> exchange
// the public_token) so every place that can trigger a bank connection --
// the first-login gate (PlaidLinkGate) and the "+ Add bank" button on
// Home -- shares one implementation instead of duplicating it. The
// link_token is fetched lazily (on the first startLink() call, not on
// mount), since most renders of a persistent "Add bank" button never get
// clicked -- fetching eagerly would mean creating a fresh Plaid link_token
// on every single Home page view. The browser never sees a Plaid
// access_token, only the short-lived link_token and public_token Plaid
// itself hands back; api/plaid-exchange.js does the real exchange +
// storage server-side.
export function useBankLink(accessToken, onLinked) {
  const [linkToken, setLinkToken] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | fetching | connecting | error
  const [error, setError] = useState(null);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setStatus("connecting");
      setError(null);
      try {
        const resp = await fetch("/api/plaid-exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!resp.ok) throw new Error("exchange failed");
        setStatus("idle");
        onLinked?.();
      } catch {
        setError("Couldn't finish connecting — try again");
        setStatus("idle");
      }
    },
  });

  // react-plaid-link only flips `ready` once it's finished initializing
  // with a non-null token, which happens asynchronously after
  // setLinkToken() -- this is what actually opens Link once that's done,
  // covering the lazy-fetch case below.
  useEffect(() => {
    if (status === "fetching" && ready) {
      open();
      setStatus("idle");
    }
  }, [status, ready, open]);

  function startLink() {
    if (linkToken) {
      if (ready) open();
      else setStatus("fetching");
      return;
    }
    setStatus("fetching");
    setError(null);
    fetch("/api/plaid-link-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.link_token) {
          setLinkToken(data.link_token);
        } else {
          setError("Couldn't reach the bank-connection service");
          setStatus("idle");
        }
      })
      .catch(() => {
        setError("Couldn't reach the bank-connection service");
        setStatus("idle");
      });
  }

  return { startLink, connecting: status === "fetching" || status === "connecting", error };
}
