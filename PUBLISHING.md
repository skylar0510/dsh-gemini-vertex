# Publishing checklist

This package is ready to publish to npm as `dsh-gemini-vertex` (the name is free as of
2026-11-12). Nothing in the repo requires credentials.

## 0. Deal with upstream first (recommended)

`dsh-gemini-argon` has the same adapter but two packaging problems on DSH `0.2.2-rc.1`:

1. `dsh.engines.dsh` and four peer dependencies are pinned to the exact `0.2.1-rc.2`,
   so any DSH upgrade makes the bundle "incompatible".
2. It ships a `dsh.client` entry with `immediately: true`; loading that browser module
   during boot takes the desktop web app down (`desktop welcome: Web RPC failed`).

A two-line PR upstream (loosen the pins, make the client optional or split it out) is
strictly better than a fork. Open that first; publish this package if upstream stays
unmaintained.

## 1. Pre-flight

```sh
cd gemini-vertex-dsh
npm test                      # 9 offline tests, no network
npm pack --dry-run            # inspect the exact tarball contents
```

Expected tarball: `index.js`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, `LICENSE`,
`package.json`. Tests, CI config and this file stay out of the package via `files`.

## 2. Secret scan

The repository must never contain a service-account key, an API key, or a project id.

```sh
grep -rnE "private_key|BEGIN PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}|ya29\." . --exclude-dir=node_modules
grep -rniE "wandernest|vertex-sa\.json|GOOGLE_APPLICATION_CREDENTIALS=" . --exclude-dir=node_modules
```

Both should return only documentation placeholders. `serviceAccountFile` examples use
`~/.config/gcloud/vertex-sa.json`, a path, never a file.

Also confirm the tarball:

```sh
npm pack --dry-run --json | grep -E '"(path|size)"'
```

## 3. Version and metadata

- Bump `version` in `package.json` (and add a `CHANGELOG.md` entry).
- Fill `repository`, `homepage` and `bugs` once the GitHub repo exists.
- `dsh.engines.dsh` is `>=0.2.1-rc.2 <0.3.0`; DSH compares requirements with
  `includePrerelease: true`, so ranges work. Do not go back to an exact pin.

## 4. Publish

```sh
npm login                     # or set NPM_TOKEN
npm publish --access public
git init && git add -A && git commit -m "dsh-gemini-vertex 1.0.0"
git tag v1.0.0 && git push --tags
```

## 5. Verify a real install

```sh
dsh plugin --profile demo add dsh-gemini-vertex
dsh --profile demo --dump-config | grep -A6 llm-gemini-vertex
```

Then add a `project` + auth block to that profile's `cordis.patch.yml`, restart, and
check the model picker. A `countTokens` probe (`probeModel`) is the cheapest end-to-end
check: it never bills output tokens.

## 6. Compatibility policy after release

When DSH releases `0.2.3-rc.*` or `0.3`, test the bundle before widening the range. The
route only depends on `LlmAdapter`, `LlmError`, `credentialRef`, `launchEnvironmentOf`,
attachment helpers and schemastery — all stable across `0.2.x`, but verify rather than
assume.
