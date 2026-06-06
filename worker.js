// ─────────────────────────────────────────────────────────────
// Cloudflare Worker — Gemini proxy for DrawingGuru
//
// - Serves index.html (and other static files) via Static Assets binding.
// - Exposes POST /api/gemini : forwards the request body to Google Gemini,
//   injecting the API key server-side (never exposed to the browser).
// - The HTML sends the SAME native-Gemini body it used before
//   ({contents, generationConfig}); the worker forwards it as-is and
//   returns Gemini's JSON unchanged. Minimal HTML changes required.
// ─────────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API proxy ──────────────────────────────────────────────
    if (url.pathname === "/api/gemini") {
      if (request.method !== "POST") {
        return jsonError("Method not allowed. Use POST.", 405);
      }
      if (!env.GEMINI_API_KEY) {
        // Most common cause: secret was set under "Build" in the
        // dashboard instead of as a runtime secret. Use:
        //   npx wrangler secret put GEMINI_API_KEY
        return jsonError(
          "GEMINI_API_KEY runtime secret is not set on the Worker.",
          500
        );
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonError("Invalid JSON body.", 400);
      }

      // Forward the body verbatim to Gemini, key in the header.
      const target =
        GEMINI_BASE + GEMINI_MODEL + ":generateContent";
      let upstream;
      try {
        upstream = await fetch(target, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        return jsonError("Upstream fetch failed: " + e.message, 502);
      }

      const text = await upstream.text();
      // Pass Gemini's response straight through (status + JSON body),
      // so the existing HTML parsing (d.candidates / d.error) works
      // exactly as before.
      return new Response(text, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Static assets (index.html etc.) ────────────────────────
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

// Errors as an OBJECT {error:{message,code}} so the old HTML, which
// reads d.error.message, shows a real message instead of "undefined".
function jsonError(message, code) {
  return new Response(
    JSON.stringify({ error: { message, code } }),
    { status: code, headers: { "Content-Type": "application/json" } }
  );
}
