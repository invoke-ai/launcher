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

We use DigiCert KeyLocker to sign Windows builds. This is a cloud-based signing service that requires a DigiCert account.

DigiCert provides some minimal documentation on setting up KeyLocker to work with `electron-builder`:

- https://docs.digicert.com/en/digicert-keylocker/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-executables-with-electron-builder-using-ksp-library.html

- `SM_HOST`: The DigiCert Signing Manager host URL. It must start with `https://`.
- `SM_API_KEY`: The API key for the DigiCert Signing Manager account.
- `SM_CLIENT_CERT_PASSWORD`: The password for the client certificate used to authenticate with the DigiCert Signing Manager.
- `SM_CLIENT_CERT_FILE`: The client certificate file used to authenticate with the DigiCert Signing Manager, encoded as b64.
- `SM_CODE_SIGNING_CERT_SHA1_HASH`: The SHA1 hash of the code signing certificate used to sign the Windows builds.
