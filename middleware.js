// Vercel Routing Middleware — runs before every request to this project.
// Gates the whole app behind a numeric PIN. Free, works on the Hobby plan,
// framework-agnostic (not a Next.js-only feature).
//
// Setup: add an environment variable SITE_PIN (e.g. "4821") in
// Vercel -> Project Settings -> Environment Variables, then redeploy.
// If SITE_PIN is not set, the gate is skipped (app stays open) so you
// never get locked out by forgetting to configure it.

const COOKIE_NAME = "analysis_auth";
const COOKIE_MAX_AGE_DAYS = 30;

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    cookies[k] = decodeURIComponent(v);
  });
  return cookies;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pinPage(showError) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Analysis</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #14181D; font-family: 'Inter', system-ui, -apple-system, sans-serif;
  }
  form {
    background: #1E242C; border: 1px solid #2A313B; border-radius: 14px;
    padding: 36px 28px; width: 280px; text-align: center;
  }
  h1 { color: #EDE8DE; font-size: 19px; font-weight: 600; margin: 0 0 22px; }
  input {
    width: 100%; font-size: 24px; letter-spacing: 10px; text-align: center;
    padding: 14px 10px; border-radius: 8px; border: 1px solid #2A313B;
    background: #171B21; color: #EDE8DE; margin-bottom: 16px; outline: none;
  }
  input:focus { border-color: #3FA796; }
  button {
    width: 100%; padding: 13px; border-radius: 8px; border: none;
    background: #3FA796; color: #14181D; font-weight: 600; font-size: 15px; cursor: pointer;
  }
  .err { color: #C1666B; font-size: 13px; margin-bottom: 12px; font-family: 'Inter', sans-serif; }
</style>
</head>
<body>
  <form method="POST">
    <h1>Enter PIN</h1>
    ${showError ? '<div class="err">Incorrect PIN — try again</div>' : ""}
    <input
      name="pin"
      type="password"
      inputmode="numeric"
      pattern="[0-9]*"
      maxlength="8"
      autofocus
      autocomplete="off"
    />
    <button type="submit">Unlock</button>
  </form>
</body>
</html>`;
}

export default async function middleware(request) {
  const PIN = process.env.SITE_PIN;
  if (!PIN) return; // not configured — don't lock anyone out

  const cookies = parseCookies(request.headers.get("cookie"));
  const expected = await sha256Hex(PIN + ":analysis-lock");

  if (cookies[COOKIE_NAME] === expected) {
    return; // already authenticated, let the request through
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const submitted = (form.get("pin") || "").toString().trim();

    if (submitted === PIN) {
      const headers = new Headers({ Location: request.url });
      headers.append(
        "Set-Cookie",
        `${COOKIE_NAME}=${expected}; Path=/; Max-Age=${COOKIE_MAX_AGE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
      );
      return new Response(null, { status: 302, headers });
    }

    return new Response(pinPage(true), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(pinPage(false), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
