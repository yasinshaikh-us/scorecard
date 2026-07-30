// Vercel Routing Middleware — runs before every request to this project.
// Gates the whole app behind a numeric PIN. Free, works on the Hobby plan,
// framework-agnostic (not a Next.js-only feature).
//
// Setup: add SITE_PIN (e.g. "4821") and SESSION_SECRET (any long random
// string, e.g. `openssl rand -hex 32`) in Vercel -> Project Settings ->
// Environment Variables, then redeploy.
//
// If SITE_PIN is not set, the gate is skipped entirely (app stays open)
// so you never get locked out by forgetting to configure it. SESSION_SECRET
// has no such fallback: if SITE_PIN is set but SESSION_SECRET isn't, the
// app fails closed (500) rather than issuing a session cookie with no
// integrity check — same behavior as the location app's middleware.
//
// Session verification, PIN comparison, and the brute-force guard all live
// in lib/auth.js, which mirrors the location app's lib/auth.ts: HMAC-signed
// expiring session tokens and timing-safe comparisons throughout.

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  MAX_ATTEMPTS,
  tooManyAttempts,
  recordFailedAttempt,
  parseCookies,
  createSessionToken,
  verifySessionToken,
  verifyPin,
} from "./lib/auth.js";

export { MAX_ATTEMPTS, tooManyAttempts, recordFailedAttempt, parseCookies };

export function pinPage(showError, pinLength) {
  const len = pinLength >= 4 && pinLength <= 8 ? pinLength : 6;
  const boxes = Array.from({ length: len })
    .map((_, i) => `<input class="pin-box" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" data-idx="${i}" />`)
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#14181D" />
<title>Analysis</title>
<script>
  // Blocking (runs before first paint) so the PIN screen honors a saved
  // theme choice immediately, same mechanism as index.html/App.jsx.
  (function () {
    try {
      var stored = localStorage.getItem("theme");
      var theme = stored === "light" || stored === "dark"
        ? stored
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  })();
</script>
<style>
  :root {
    --bg: #F7F4EC; --surface-recessed: #EFEBE0; --border: #DEDACC;
    --text: #1B1F24; --text-muted: #5B6470; --text-faint: #8A93A0;
    --accent: #1F7A6C; --accent-strong: #175E53; --danger: #A23F49;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14181D; --surface-recessed: #171B21; --border: #2A313B;
      --text: #EDE8DE; --text-muted: #8B93A0; --text-faint: #5A6270;
      --accent: #3FA796; --accent-strong: #2C8577; --danger: #C1666B;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14181D; --surface-recessed: #171B21; --border: #2A313B;
    --text: #EDE8DE; --text-muted: #8B93A0; --text-faint: #5A6270;
    --accent: #3FA796; --accent-strong: #2C8577; --danger: #C1666B;
  }
  :root[data-theme="light"] {
    --bg: #F7F4EC; --surface-recessed: #EFEBE0; --border: #DEDACC;
    --text: #1B1F24; --text-muted: #5B6470; --text-faint: #8A93A0;
    --accent: #1F7A6C; --accent-strong: #175E53; --danger: #A23F49;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); font-family: 'Inter', system-ui, -apple-system, sans-serif;
  }
  .wrap { width: 320px; padding: 24px; text-align: center; position: relative; }
  .theme-toggle {
    position: absolute; top: 0; right: 0;
    width: 30px; height: 30px; border-radius: 50%;
    border: 1px solid var(--border); background: transparent; color: var(--text-faint);
    display: flex; align-items: center; justify-content: center; cursor: pointer;
  }
  .icon-badge {
    width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 20px;
    background: linear-gradient(135deg, var(--accent), var(--accent-strong));
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 24px rgba(63, 167, 150, 0.28);
  }
  h1 { color: var(--text); font-size: 19px; font-weight: 600; margin: 0 0 6px; }
  .sub { color: var(--text-muted); font-size: 13px; margin: 0 0 26px; }
  .err { color: var(--danger); font-size: 13px; margin: -14px 0 18px; }
  form { margin: 0; }
  .pin-row { display: flex; gap: 10px; justify-content: center; margin-bottom: 26px; }
  .pin-box {
    width: 42px; height: 52px; text-align: center; font-size: 22px; font-weight: 600;
    border-radius: 10px; border: 1px solid var(--border); background: var(--surface-recessed); color: var(--text);
    outline: none; -webkit-text-security: disc;
  }
  .pin-box:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(63, 167, 150, 0.18); }
  .help { color: var(--text-faint); font-size: 12px; line-height: 1.6; max-width: 280px; margin: 0 auto; }
</style>
</head>
<body>
  <div class="wrap">
    <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Switch theme">
      <svg id="theme-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
    </button>
    <div class="icon-badge">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="11" width="14" height="9" rx="2.5" stroke="#0E1218" stroke-width="1.8"/>
        <path d="M8 11V7.6a4 4 0 0 1 8 0V11" stroke="#0E1218" stroke-width="1.8" stroke-linecap="round"/>
        <circle cx="12" cy="15.3" r="1.3" fill="#0E1218"/>
      </svg>
    </div>
    <h1>Analysis</h1>
    <div class="sub">Enter your PIN to continue</div>
    ${showError ? '<div class="err">Incorrect PIN — try again</div>' : ""}
    <form method="POST" id="pin-form">
      <div class="pin-row">
        ${boxes}
      </div>
      <input type="hidden" name="pin" id="pin-hidden" />
    </form>
    <div class="help">This gates access to your personal transaction data. Enter the PIN set for this app.</div>
  </div>
  <script>
    (function () {
      var boxesEls = Array.prototype.slice.call(document.querySelectorAll(".pin-box"));
      var hidden = document.getElementById("pin-hidden");
      var form = document.getElementById("pin-form");

      function sync() {
        hidden.value = boxesEls.map(function (b) { return b.value; }).join("");
        if (hidden.value.length === boxesEls.length) form.submit();
      }

      boxesEls.forEach(function (box, i) {
        box.addEventListener("input", function () {
          box.value = box.value.replace(/[^0-9]/g, "").slice(-1);
          if (box.value && i < boxesEls.length - 1) boxesEls[i + 1].focus();
          sync();
        });
        box.addEventListener("keydown", function (e) {
          if (e.key === "Backspace" && !box.value && i > 0) {
            boxesEls[i - 1].focus();
          }
        });
        box.addEventListener("paste", function (e) {
          e.preventDefault();
          var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "");
          text.split("").forEach(function (ch, idx) {
            if (boxesEls[idx]) boxesEls[idx].value = ch;
          });
          var next = boxesEls[Math.min(text.length, boxesEls.length - 1)];
          if (next) next.focus();
          sync();
        });
      });

      if (boxesEls[0]) boxesEls[0].focus();

      // Theme toggle: same sun/moon-icon convention as the rest of the app.
      var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
      var MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      var toggleBtn = document.getElementById("theme-toggle");
      var icon = document.getElementById("theme-icon");
      function paintIcon() {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        icon.innerHTML = isDark ? SUN : MOON;
      }
      paintIcon();
      toggleBtn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (e) {}
        document.querySelector('meta[name="theme-color"]').setAttribute(
          "content", next === "dark" ? "#14181D" : "#F7F4EC"
        );
        paintIcon();
      });
    })();
  </script>
</body>
</html>`;
}

export default async function middleware(request) {
  const PIN = process.env.SITE_PIN;
  if (!PIN) return; // not configured — don't lock anyone out

  if (!process.env.SESSION_SECRET) {
    return new Response("Server misconfigured: SESSION_SECRET is not set.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  if (await verifySessionToken(cookies[SESSION_COOKIE_NAME])) {
    return; // already authenticated, let the request through
  }

  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

  if (request.method === "POST") {
    if (tooManyAttempts(ip)) {
      return new Response("Too many attempts — try again in a few minutes.", {
        status: 429,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const form = await request.formData();
    const submitted = (form.get("pin") || "").toString().trim();

    if (verifyPin(submitted)) {
      const token = await createSessionToken();
      const headers = new Headers({ Location: request.url });
      headers.append(
        "Set-Cookie",
        `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
      );
      return new Response(null, { status: 302, headers });
    }

    recordFailedAttempt(ip);
    return new Response(pinPage(true, PIN.length), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(pinPage(false, PIN.length), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
