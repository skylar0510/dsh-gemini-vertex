# dsh-gemini-vertex

Gemini on **Google Vertex AI** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A **host-only** provider bundle: it registers one `gemini-vertex` route and ships no
browser companion. That is deliberate — it means enabling it cannot affect the web
app's boot, which is the failure mode of client-injecting provider plugins on DSH
`0.2.2-rc.1`.

- Native `streamGenerateContent` (`alt=sse`): streamed text, thinking summaries, usage, finish reasons
- Native function calling with `thoughtSignature` replay, so multi-turn tool loops do not 400
- Foreign providers' tool history degrades to text instead of breaking the conversation
- Image input from user messages and tool results
- Service-account JSON (OAuth2 JWT exchange, cached token, 401 refresh) **or** Express API key
- Several models on one route, selectable in the model picker
- Proxy support: `auto` (env, then macOS system proxy), `direct`, or an explicit URL

## Install

```sh
dsh plugin --profile desktop add dsh-gemini-vertex
```

Then restart DeepSeek Harness: the profile's bundle list is read at startup.
The provider appears as **Google Vertex AI**; its models appear in the model picker.

## Configure

Configuration lives in the profile's `cordis.patch.yml` (the Settings UI only shows
built-in providers).

### Service account (recommended)

```yaml
- id: llm-gemini-vertex
  name: "dsh-gemini-vertex"
  config:
    project: "your-project-id"          # id or numeric project number
    auth: service-account
    serviceAccountFile: "~/.config/gcloud/vertex-sa.json"
    location: global
    model: gemini-4-argon
    modelName: Gemini 4 Argon
    thinkingLevel: off
```

The service account needs `Vertex AI User` and the project must have the Vertex AI API
enabled. `project` falls back to the JSON's `project_id`, then `GOOGLE_CLOUD_PROJECT`.

### Express API key

```yaml
- id: llm-gemini-vertex
  name: "dsh-gemini-vertex"
  config:
    project: "your-project-id"
    auth: api-key
    apiKeyEnv: GOOGLE_VERTEX_API_KEY     # credential ref or launch-env variable
```

The key is sent as `x-goog-api-key`. Store it through the credentials service rather
than committing it anywhere.

### Models

`model` is the route default and is always advertised. Every `models` entry adds one
more selectable model.

```yaml
    model: gemini-4-argon
    modelName: Gemini 4 Argon
    models:
      - id: gemini-3.8-flash
        name: Gemini 3.8 Flash
      - id: gemini-3.1-pro-preview
        name: Gemini 3.1 Pro (preview)
        contextWindow: 1048576
        maxTokens: 65536
```

| field | default | meaning |
| --- | --- | --- |
| `auth` | `auto` | `auto` uses a service account when configured, otherwise the API key |
| `serviceAccountFile` | — | JSON path, `~` expanded; falls back to `GOOGLE_APPLICATION_CREDENTIALS` |
| `serviceAccountJson` | — | inline JSON (plain text — prefer the file) |
| `project` | — | project id/number |
| `location` | `global` | Vertex location |
| `model` | `gemini-4-argon` | default publisher model id |
| `models` | `[]` | extra models on the same route |
| `baseURL` | `https://aiplatform.googleapis.com` | HTTP root override |
| `thinkingLevel` | `off` | `off` pins the model's lowest level and hides thoughts |
| `streamIdleTimeoutMs` | `300000` | fail a call that stalls this long |
| `proxy` | `auto` | `auto` / `direct` / explicit proxy URL |

## Behaviour

- Requests go to
  `{baseURL}/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse`.
- Service-account auth signs an RS256 JWT, exchanges it at the JSON's `token_uri`, caches
  the access token until 5 minutes before expiry, and refreshes once on a 401.
- After every response the native `parts` (text, thoughts, `functionCall`, `thoughtSignature`)
  are stored in DSH's `replayState` and replayed verbatim on the next turn.
- Thinking cannot be fully disabled on models that reject `thinkingBudget: 0`; `off`
  therefore means "the model's minimum level, without thought summaries".

## Troubleshooting

| symptom | cause |
| --- | --- |
| `404 ... Publisher model ... was not found` | wrong model id, wrong location, or no access in this project |
| `401 API keys are not supported by this API` | API key sent to an OAuth-only endpoint — use `auth: service-account` |
| `400 Function call is missing a thought_signature` | a Gemini tool call was replayed without its signature (edited history / `replayState` truncated) |
| `429 RESOURCE_EXHAUSTED` | quota or dynamic shared quota — retry later or request quota for that model |
| `400 Thinking budget is not supported for this model` | the model only accepts thinking levels; this adapter already uses levels |

## Tests

```sh
npm install
npm test
```

Offline tests cover JWT exchange, SSE streaming, API-key headers, model resolution,
request-body construction, and signature replay/degradation. They spin up a local mock
for the token and Vertex endpoints; no credentials or network needed.

A live test is skipped unless both variables are set:

```sh
GEMINI_VERTEX_SA=~/.config/gcloud/vertex-sa.json \
GOOGLE_CLOUD_PROJECT=your-project \
npm test
```

## Attribution

The adapter is derived from [`dsh-gemini-argon`](https://github.com/zh-plus/dsh-gemini-argon)
by maysee (MIT). This package keeps the adapter, removes the browser companion, and
generalises the manifest and model list. See `LICENSE`.
