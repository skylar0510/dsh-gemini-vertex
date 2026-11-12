# Changelog

## 1.0.1

- Map Vertex's token-budget 400 (`The input token count (N) exceeds the maximum
  number of tokens allowed (M).`) to `CONTEXT_WINDOW_EXCEEDED`. dsh-llm only
  recognises context-window wording, so this error used to surface as an
  unretryable `INVALID_REQUEST` and automatic compaction could not recover.
- Offline test for that mapping.

## 1.0.0

First release.

- Host-only DSH provider bundle for Gemini on Google Vertex AI (`gemini-vertex` route); no browser companion, so it cannot affect the web app's boot.
- Native `streamGenerateContent` with `alt=sse`, streaming text, thinking summaries, token usage and finish reasons.
- Native function calling with `thoughtSignature` replay; foreign tool history degrades to text instead of failing with a 400.
- Image input from user messages and tool results, resized to the configured pixel/byte budget.
- Service-account auth (RS256 JWT exchange, token caching and 401 refresh) or Express API-key auth (`x-goog-api-key`).
- Multiple models per route through `models`, with per-model name, context window and max output tokens.
- Proxy support: `auto` (environment, then macOS system proxy), `direct`, or an explicit `http(s)://` proxy.
