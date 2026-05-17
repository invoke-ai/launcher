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

We use [OSSign](https://github.com/ossign/ossign) to sign Windows builds. OSSign issues
the certificate and runs a hosted signing backend; signing happens via the `ossign` CLI,
which the [`@ossign/ossign`](https://www.npmjs.com/package/@ossign/ossign) npm package
auto-downloads on first use. Our `scripts/customSign.js` is invoked by `electron-builder`
once per Windows binary and delegates to that package.

Only one secret is required:

- `OSSIGN_CONFIG_BASE64`: Base64-encoded OSSign config (YAML or JSON). Tells the `ossign`
  CLI which signing backend to use (Azure Trusted Signing, Azure Key Vault, or a local
  certificate) and how to authenticate to it. OSSign provides this value; store it in the
  `code-signing` environment secrets.

To set the secret locally (e.g. for debugging the signer), set `OSSIGN_CONFIG_BASE64` or
`OSSIGN_CONFIG` (raw, un-encoded) in your environment, and run with `ENABLE_SIGNING=true`.
Signing is otherwise a no-op since `ENABLE_SIGNING` gates the custom signer in
`electron-builder.config.ts`.
