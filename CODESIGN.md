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

Every executable we bundle has to be signed, not just the installer: Windows Smart App Control
refuses to `CreateProcess` an unsigned binary, which is how
[#148](https://github.com/invoke-ai/launcher/issues/148) happened — the installer was signed but
the `winpty-agent.exe` that node-pty spawns was not, so the launcher died on startup.

`scripts/customSign.js` holds the allowlist and is the only place to change it:

| Category                  | Files                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Signed**                | The NSIS installer and uninstaller, `Invoke Community Edition.exe`, node-pty's own build output (`winpty-agent.exe`, `winpty.dll`, the `.node` addons), the bundled `uv.exe`, and electron-builder's `resources/elevate.exe` (unsigned upstream, and electron-updater spawns it when an update needs admin rights). |
| **Left alone**            | Microsoft's ConPTY binaries that node-pty redistributes — `OpenConsole.exe` and `conpty.dll`, in **both** `third_party/conpty/` and the `build/Release/conpty/` copy node-pty's post-install step makes on Windows. Already signed by Microsoft; re-signing would replace that.                                     |
| **Deliberately unsigned** | Electron's own runtime DLLs (`ffmpeg.dll`, `libEGL.dll`, …). Upstream does not sign them either, and they are loaded in-process rather than spawned, so Smart App Control does not gate them.                                                                                                                       |

`electron-builder.config.ts` sets `signExts: ['.dll', '.node']` so those extensions reach the hook
at all — electron-builder only offers `.exe` by default.

Because signing runs on OSSign's infrastructure, we never see those logs, and a rule that stops
matching just prints "Skipping…" and ships an unsigned binary. `scripts/checkWindowsSigningCoverage.js`
guards against that: the Windows job in `.github/workflows/build.yml` runs it against the unsigned
build on every PR and fails if any bundled binary is not covered by one of the three categories
above (and re-verifies, via `Get-AuthenticodeSignature`, that the "already signed" ones really are).

Its scope is `dist/win-unpacked` — the tree that gets installed, which is what Smart App Control
gates at run time. The NSIS installer itself lives in `dist/` and the uninstaller is deleted right
after signing, so neither is covered by the walk; both are matched by the oldest and
most-exercised rule in the allowlist.
