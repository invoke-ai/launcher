## Local Development

On macOS, `electron-builder` will autodiscover a valid keychain entry to sign and notarize. You likely do not want this for local development.

To disable it, set the following environment variable to false in your local `.env` file:

```.env
# Disable codesigning in local development.
# This prevents electron-builder from checking keychain for a signing cert.
CSC_IDENTITY_AUTO_DISCOVERY=false
```

The `.env.sample` file already has this set; you can copy it to `.env` in your local repo.

## Production

For signed production builds in CI, some env vars must be set as secrets in the `code-signing` environment.

### macOS

We use this GH action to create the appropriate keychain entry in CI:

- https://github.com/Apple-Actions/import-codesign-certs

The repo contains helpful instructions to prepare the certificate env vars below.

- `APPLE_ID`: The Apple ID of the Apple Developer account to use for code signing.
- `APPLE_APP_SPECIFIC_PASSWORD`: The app-specific password for the Apple ID.
  - See https://support.apple.com/en-us/102654 for more information
- `APPLE_TEAM_ID`: The Team ID for the Apple Developer account.
- `APPLE_CERT_FILE_B64`: The Apple certificate encoded as b64.
- `APPLE_CERT_FILE_PASSWORD`: The password for the Apple certificate.

### Windows

Windows builds are code-signed by [OSSign](https://ossign.org)'s hosted infrastructure.
The signing certificate lives only at OSSign and is **never** exposed to this repository.

The `build-windows` job in `.github/workflows/build-and-sign.yml` does not build or sign
Windows locally. It fires a `dispatch_only` request via `ossign/actions/workflow/dispatch` to
trigger the "Build and Sign" workflow in our OSSign-hosted repo (`OSSign/invoke-ai-launcher`),
then hands the returned workflow id to `.github/workflows/wait-signature.yml`. Because OSSign's
signing waits on a manual reviewer approval that can take hours, that wait loop polls
asynchronously (using the `Signatures` environment's Wait timer) instead of holding a runner;
when signing completes it downloads the signed artifacts and attaches them to the tag's GitHub
Release. The hosted workflow checks out this repo at the release ref, runs `npm run package`
with `ENABLE_SIGNING=true`, and signs each binary via `scripts/customSign.js`, which delegates
to the [`@ossign/ossign`](https://www.npmjs.com/package/@ossign/ossign) CLI using the
certificate config (`OSSIGN_CONFIG`) that OSSign provisions in that repo.

See [`.github/ossign/README.md`](.github/ossign/README.md) for the full architecture (including
the `Signatures` environment setup). The OSSign-side workflow itself lives in the
[`OSSign/invoke-ai-launcher`](https://github.com/OSSign/invoke-ai-launcher) repo.

Two **repo-level** secrets must be set (OSSign provides the values). They are repo-level rather
than environment-scoped because both `build-windows` (no environment) and `wait-signature.yml`
(the `Signatures` environment) need them:

- `OSSIGN_USER`: the OSSign username used to authenticate the dispatch request.
- `OSSIGN_TOKEN`: the OSSign API token used to authenticate the dispatch request.

> The certificate config (`OSSIGN_CONFIG`) is **not** stored here — it lives in the `OSSign`
> environment of `OSSign/invoke-ai-launcher`.

To debug the signer locally, set `OSSIGN_CONFIG` (raw JSON/YAML) or `OSSIGN_CONFIG_BASE64`
(base64-encoded) in your environment and run with `ENABLE_SIGNING=true`. Signing is otherwise
a no-op, since `ENABLE_SIGNING` gates the custom signer in `electron-builder.config.ts`.

#### What gets signed

**Everything we ship, except binaries that already carry a working signature from somebody else.**

Windows Smart App Control refuses to `CreateProcess` an unsigned binary. That is how
[#148](https://github.com/invoke-ai/launcher/issues/148) happened: the installer was signed, but the
`winpty-agent.exe` that node-pty spawns was not, so the launcher died on startup.

`scripts/customSign.js` implements the policy. It used to be an allowlist keyed on our own product
name, and defaulting to "skip" is precisely what let #148 ship — a binary a dependency adds goes out
unsigned and nothing says a word until it fails on a user's machine.

Note what the policy deliberately does _not_ do: decide which kinds of PE load Windows gates. An
earlier version exempted Electron's DLLs on the grounds that in-process loads are not gated, while
signing node-pty's DLLs in the same breath — two incompatible claims. Signing everything costs a few
seconds per build and removes the question.

The one thing we must never do is sign _over_ somebody else's signature: Microsoft's certificate
carries Smart App Control reputation that a newer identity does not. So that decision is made from
the **file's own contents**, not from a path list — `scripts/authenticode.js` reports whether the
binary already holds a signature covering its bytes. A path list is not good enough here: Electron
bundles a Microsoft-signed `d3dcompiler_47.dll` next to five unsigned DLLs, and a list had already
missed it once.

`EXEMPTIONS` in `customSign.js` therefore does not control signing. It _declares_ the pre-signed
binaries we know about — currently Microsoft's ConPTY pair from node-pty and that `d3dcompiler_47.dll`
— so that a new one appearing in the package is surfaced in CI rather than silently trusted.

A binary whose certificate no longer matches its contents is signed by us, declared or not: Windows
treats it as unsigned anyway, so replacing it loses nothing.

"Its signature does not cover this file" and "I could not parse this signature" are kept apart,
because they call for opposite handling. The second may describe a perfectly valid signature that is
simply beyond our parser, so we neither replace it nor claim to have verified it — the file is left
untouched and the coverage check fails, which puts a person in the loop rather than silently
destroying a working signature.

`electron-builder.config.ts` sets `signExts: ['.dll', '.node']`, because electron-builder only offers
`.exe` files to the hook by default (`shouldSignFile` in app-builder-lib).

#### The coverage check

Signing runs on OSSign's infrastructure, where we never see the logs — so a gap is invisible until a
user hits it. `scripts/checkWindowsSigningCoverage.js` runs in `.github/workflows/build.yml`'s
Windows job and checks the two things that can silently go wrong.

**Reachability.** electron-builder only reaches the hook for files matching `shouldSignFile` _and_
sitting under one of the roots `signApp` walks — the package root non-recursively,
`resources/app.asar.unpacked`, and `swiftshader` — plus separate paths for `extraResources` and the
NSIS elevation helper. Reasoning about that from the outside is how you get a check that passes
while a binary in `locales/` ships unsigned. So we do not reason about it: the PR build runs with
`ENABLE_SIGNING=true` and `SIGNING_DRY_RUN` set, `customSign.js` records every path it was actually
offered and signs nothing, and the check requires every shipped PE to appear in that record. The
artifacts stay byte-identical to a plain unsigned build.

PEs are found by reading file headers, not by extension — Smart App Control gates contents, not
names, so a `.pyd` or extensionless binary counts just as much.

A dry run signs nothing, so `customSign.js` refuses to start when `SIGNING_DRY_RUN` and
`OSSIGN_CONFIG`/`OSSIGN_CONFIG_BASE64` are both set — honouring the dry run there would ship an
entire release unsigned with no error and no CI signal. Worth knowing because `npm run package`
loads `.env` into the environment, so the variable has a way of arriving unintended.

**Pre-signed binaries.** Each one must be declared in `EXEMPTIONS`, and the declaration is verified:
`authenticode.js` recomputes the file's Authenticode digest and requires it to match the digest the
signature commits to, then requires the certificate to name the expected signer. What it does _not_
do is validate the trust chain or the RSA signature itself — the threat being guarded is dependency
drift, not an adversary, and anyone able to plant a forged blob in `node_modules` could equally edit
the exemption list.

The check runs on pushes to `main`, on pull requests, and on `v*` tags — the last so that a coverage
regression is caught when a release is cut, not only when the PR landed. It cannot run inside the
release build itself: `build-and-sign.yml` hands the Windows build to OSSign's infrastructure and
never builds Windows here.

Two scope limits worth knowing. The walk covers `dist/win-unpacked`, the tree that gets installed;
the NSIS installer lives in `dist/` and the uninstaller is deleted right after signing, so neither is
walked — though both do appear in the dry-run record. And the check proves binaries are _reachable
and classified_, never that OSSign actually produced a signature; that is structural, since real
signing only happens on the release path.
