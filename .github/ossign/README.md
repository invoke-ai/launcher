# Windows code signing via OSSign

Windows builds for Invoke Community Edition are code-signed by [OSSign](https://ossign.org)'s
hosted infrastructure. The signing certificate lives only at OSSign and is never exposed to
this repository.

This replaces the previous DigiCert KeyLocker signing that ran directly inside
`.github/workflows/build-and-sign.yml`.

## How it works

OSSign's signing requires a **manual reviewer approval on their side that can take hours**, so we
do not hold a runner waiting. Instead we dispatch and then poll asynchronously via a cheap
wait-timer loop:

```
invoke-ai/launcher                              OSSign (api.ossign.org)        OSSign/invoke-ai-launcher
─────────────────────                           ──────────────────────        ─────────────────────────
build-and-sign.yml :: build-windows
  dispatch (dispatch_only: true)           ───▶  dispatch/<user>          ───▶  "Build and Sign" workflow
    -> returns workflow_id                                                        - checkout invoke-ai/launcher@<ref>
  gh workflow run wait-signature.yml                                              - npm run package (ENABLE_SIGNING)
                                                                                     -> scripts/customSign.js
wait-signature.yml  (loops)                                                          -> OSSign CLI + OSSIGN_CONFIG
  [Signatures env wait timer ~20 min]                                            - publish signed release  ─┐
  single_check(workflow_id)              ◀────  check/<user>/<id>          ◀──── release assets  ◀──────────┘
    - not done -> re-dispatch self (next interval)
    - done     -> download signed_artifacts
                  attach .exe/.blockmap/latest.yml to the vX.Y.Z GitHub Release
```

1. When a `v*` tag is pushed (or the workflow is dispatched), `build-windows` calls
   `ossign/actions/workflow/dispatch` with `dispatch_only: true`. The action uses the **current
   git ref** as the `source_branch` and returns a `workflow_id` immediately (no waiting).
2. `build-windows` kicks off `wait-signature.yml` (passing the `workflow_id` and the target ref),
   then finishes in seconds.
3. The OSSign API triggers the **Build and Sign** workflow in
   [`OSSign/invoke-ai-launcher`](https://github.com/OSSign/invoke-ai-launcher/blob/main/.github/workflows/build-and-sign.yml)
   — the canonical, maintained copy. It checks out `invoke-ai/launcher` at the requested ref,
   builds the NSIS installer, signs it via `scripts/customSign.js` using the `OSSIGN_CONFIG`
   certificate (provisioned in OSSign's `OSSign` environment, behind their reviewer gate), and
   publishes the signed files as a release in the OSSign repo.
4. `wait-signature.yml` polls: each run waits out the `Signatures` environment's Wait timer
   (~20 min, consuming no runner minutes while queued), does one `single_check`, and—if signing
   isn't done—re-dispatches itself for the next interval (up to `max_attempts`, default 72 ≈ 24h).
5. Once signing completes, the loop downloads the signed artifacts and, for a `vX.Y.Z` tag,
   attaches them (`.exe`, `.blockmap`, `latest.yml`) to that tag's GitHub Release — alongside the
   Linux/macOS installers already published there by their build jobs. (Non-tag test runs stop at
   a `windows-artifacts-signed` workflow artifact, since there is no release to attach to.)

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

**Note the coupling:** that workflow runs _this_ repo's build (`npm run download win`,
`npm run package`, `scripts/customSign.js`, the `NODE_VERSION`, etc.). If those change here, the
OSSign-hosted workflow may need a matching update — open a PR against `OSSign/invoke-ai-launcher`
and notify OSSign for review.

### 2. Add the dispatch credentials as repo-level secrets

Both the `build-windows` job (no environment) and the `wait-signature.yml` loop (which runs in the
`Signatures` environment for its Wait timer) authenticate to the OSSign API. So these must be
**repository-level** secrets, not environment secrets — an environment secret scoped to one
environment would not be visible to both:

| Secret         | Value                                      |
| -------------- | ------------------------------------------ |
| `OSSIGN_USER`  | the OSSign username (`invoke-ai-launcher`) |
| `OSSIGN_TOKEN` | the OSSign API token                       |

```bash
# repo-level (note: NO --env flag)
gh secret set OSSIGN_USER  --repo invoke-ai/launcher
gh secret set OSSIGN_TOKEN --repo invoke-ai/launcher
```

If these were previously added to the `code-signing` environment, remove those copies — they are
no longer used there (`gh secret delete OSSIGN_USER --env code-signing --repo invoke-ai/launcher`).

> The certificate config (`OSSIGN_CONFIG`) is **not** stored here — OSSign provisions it in the
> `OSSign` environment of `OSSign/invoke-ai-launcher`.

### 2b. Create the `Signatures` environment (one-time)

`wait-signature.yml` relies on a `Signatures` environment whose **Wait timer** provides the polling
interval. It must have **no required reviewers** (or every poll would block on approval):

```bash
gh api -X PUT repos/invoke-ai/launcher/environments/Signatures -F wait_timer=20
```

### 3. Clean up the old DigiCert secrets (optional)

The previous DigiCert KeyLocker secrets (`SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_PASSWORD`,
`SM_CLIENT_CERT_FILE_B64`, `SM_CODE_SIGNING_CERT_SHA1_HASH`) are no longer used and can be removed.
