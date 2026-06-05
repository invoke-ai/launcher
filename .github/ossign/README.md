# Windows code signing via OSSign

Windows builds for Invoke Community Edition are code-signed by [OSSign](https://ossign.org)'s
hosted infrastructure. The signing certificate lives only at OSSign and is never exposed to
this repository.

This replaces the previous DigiCert KeyLocker signing that ran directly inside
`.github/workflows/build-and-sign.yml`.

## How it works

```
invoke-ai/launcher                         OSSign (api.ossign.org)            OSSign/invoke-ai-launcher
─────────────────────                      ──────────────────────            ─────────────────────────
build-and-sign.yml
  build-windows job
    ossign/actions/workflow/dispatch  ───▶  dispatch/<user>            ───▶  "Build and Sign" workflow
                                                                               (.github/workflows/build-and-sign.yml
                                                                                in the OSSign-hosted repo)
                                                                                 - checkout invoke-ai/launcher@<ref>
                                                                                 - npm run package (ENABLE_SIGNING)
                                                                                     -> scripts/customSign.js
                                                                                        -> OSSign CLI + OSSIGN_CONFIG
                                                                                 - publish signed release
    (polls until complete)            ◀───  check/<user>/<id>          ◀───  release assets
    downloads signed_artifacts
    uploads windows-artifacts-signed
```

1. When a `v*` tag is pushed (or the workflow is dispatched), the `build-windows` job in
   `.github/workflows/build-and-sign.yml` calls `ossign/actions/workflow/dispatch@main` with our
   OSSign credentials. The action uses the **current git ref** as the `source_branch`.
2. The OSSign API triggers the **Build and Sign** workflow in
   [`OSSign/invoke-ai-launcher`](https://github.com/OSSign/invoke-ai-launcher/blob/main/.github/workflows/build-and-sign.yml)
   — that repo holds the canonical, maintained copy of the workflow. It checks out
   `invoke-ai/launcher` at the requested ref, builds the NSIS installer, and signs it via
   `scripts/customSign.js` using the `OSSIGN_CONFIG` certificate provisioned in OSSign's `OSSign`
   environment.
3. The signed files are published as a GitHub release in the OSSign repo. The dispatch action
   polls until completion, then returns the signed release assets.
4. Back in `invoke-ai/launcher`, the `build-windows` job downloads those signed artifacts and
   uploads them as `windows-artifacts-signed`, matching the previous job's output so the rest of
   the release flow is unchanged.

Linux and macOS builds are unaffected and continue to build/sign in
`.github/workflows/build-and-sign.yml`.

## Setup

### 1. The OSSign-hosted workflow

The actual build + sign workflow lives in the OSSign-hosted repo
[`OSSign/invoke-ai-launcher`](https://github.com/OSSign/invoke-ai-launcher) at
`.github/workflows/build-and-sign.yml`. That is the canonical, maintained copy — it is not
duplicated in this repository (it would never run here, and a stale copy would only mislead).

It already builds and signs using the approach above: it checks out `invoke-ai/launcher`, runs
`npm run package` with `ENABLE_SIGNING=true`, and signs via `scripts/customSign.js` using the
`OSSIGN_CONFIG` certificate.

**Note the coupling:** that workflow runs *this* repo's build (`npm run download win`,
`npm run package`, `scripts/customSign.js`, the `NODE_VERSION`, etc.). If those change here, the
OSSign-hosted workflow may need a matching update — open a PR against `OSSign/invoke-ai-launcher`
and notify OSSign for review.

### 2. Add the dispatch credentials to this repository

The `build-windows` job authenticates to the OSSign API with two secrets. Add them to the
`code-signing` environment (the same environment the other signing jobs use):

| Secret         | Value                                  |
| -------------- | -------------------------------------- |
| `OSSIGN_USER`  | the OSSign username (`invoke-ai-launcher`) |
| `OSSIGN_TOKEN` | the OSSign API token                   |

```bash
gh secret set OSSIGN_USER  --env code-signing --repo invoke-ai/launcher
gh secret set OSSIGN_TOKEN --env code-signing --repo invoke-ai/launcher
```

> The certificate config (`OSSIGN_CONFIG`) is **not** stored here — OSSign provisions it in the
> `OSSign` environment of `OSSign/invoke-ai-launcher`.

### 3. Clean up the old DigiCert secrets (optional)

The previous DigiCert KeyLocker secrets (`SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_PASSWORD`,
`SM_CLIENT_CERT_FILE_B64`, `SM_CODE_SIGNING_CERT_SHA1_HASH`) are no longer used and can be removed.
