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
Windows locally. Instead it uses `ossign/actions/workflow/dispatch` to trigger the "Build
and Sign" workflow in our OSSign-hosted repo (`OSSign/invoke-ai-launcher`), waits for it to
finish, and downloads the signed artifacts. That hosted workflow checks out this repo at the
release ref, runs `npm run package` with `ENABLE_SIGNING=true`, and signs each binary via
`scripts/customSign.js`, which delegates to the
[`@ossign/ossign`](https://www.npmjs.com/package/@ossign/ossign) CLI using the certificate
config (`OSSIGN_CONFIG`) that OSSign provisions in that repo.

See [`.github/ossign/README.md`](.github/ossign/README.md) for the full architecture and the
copy of the OSSign-side workflow we maintain.

Two secrets must be set in this repo's `code-signing` environment (OSSign provides the values):

- `OSSIGN_USER`: the OSSign username used to authenticate the dispatch request.
- `OSSIGN_TOKEN`: the OSSign API token used to authenticate the dispatch request.

> The certificate config (`OSSIGN_CONFIG`) is **not** stored here — it lives in the `OSSign`
> environment of `OSSign/invoke-ai-launcher`.

To debug the signer locally, set `OSSIGN_CONFIG` (raw JSON/YAML) or `OSSIGN_CONFIG_BASE64`
(base64-encoded) in your environment and run with `ENABLE_SIGNING=true`. Signing is otherwise
a no-op, since `ENABLE_SIGNING` gates the custom signer in `electron-builder.config.ts`.
