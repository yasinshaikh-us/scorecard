// Vercel serverless function.
// Runs server-side only — this is where your Anthropic API key actually lives.
// The browser never sees it. Set ANTHROPIC_API_KEY in your Vercel project's
// Environment Variables (Project Settings -> Environment Variables), not here.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
    return;
  }

  const { system, messages } = req.body || {};
  if (!system || !messages) {
    res.status(400).json({ error: "Request must include 'system' and 'messages'." });
    return;
  }

  try {
    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages,
      }),
    });

    const data = await anthropicResp.json();

    if (!anthropicResp.ok) {
      res.status(anthropicResp.status).json({ error: data });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
