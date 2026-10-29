# Signing the scanner builds

Unsigned builds work when an RMM tool runs them, but Windows SmartScreen,
Defender and some MSP security tools may flag an unsigned `zinloop.exe`, and
MDM tools (Intune, Jamf) expect signed Mac software. The `release` workflow
signs the builds by itself once the secrets below exist. Until then it
publishes them unsigned and shows a warning on the run.

Just want the warning gone on your own dev machine? That needs no certificate
or secrets — see [Local testing on your own machine](#local-testing-on-your-own-machine)
at the bottom. It does nothing for your customers, though: real distribution
trust needs the Windows or Mac certificate below.

Add secrets under **Settings → Secrets and variables → Actions → Secrets**,
and variables under the **Variables** tab of the same page.

## Windows: Azure Artifact Signing

Microsoft's signing service (formerly Trusted Signing). It's a monthly
subscription and needs no hardware token.

1. In the Azure portal, create an **Artifact Signing account** and complete
   identity validation for the company (this can take a few days).
2. Create a **certificate profile** (Public Trust).
3. Create an app registration in Entra ID with a client secret, and give it the
   **Artifact Signing Certificate Profile Signer** role on the signing account.
4. Add to GitHub:

| Kind | Name | Value |
|---|---|---|
| Secret | `AZURE_SIGNING_TENANT_ID` | Directory (tenant) ID |
| Secret | `AZURE_SIGNING_CLIENT_ID` | The app registration's client ID |
| Secret | `AZURE_SIGNING_CLIENT_SECRET` | The app registration's client secret |
| Variable | `AZURE_SIGNING_ENDPOINT` | The account's endpoint, e.g. `https://eus.codesigning.azure.net/` |
| Variable | `AZURE_SIGNING_ACCOUNT` | The signing account name |
| Variable | `AZURE_SIGNING_PROFILE` | The certificate profile name |

## Mac: Apple Developer ID

1. Join the **Apple Developer Program** as an organization (needs a D-U-N-S
   number for the company).
2. In Xcode or the developer site, create a **Developer ID Application**
   certificate and export it with its private key as a `.p12` file with a
   password.
3. In App Store Connect → Users and Access → Integrations, create an **API
   key** with the Developer role, and download the `.p8` file.
4. Add to GitHub:

| Kind | Name | Value |
|---|---|---|
| Secret | `APPLE_CERT_P12` | The `.p12` file, base64 encoded: `base64 -i cert.p12 \| pbcopy` |
| Secret | `APPLE_CERT_PASSWORD` | The `.p12` password |
| Secret | `APPLE_API_KEY_P8` | The contents of the `.p8` file |
| Secret | `APPLE_API_KEY_ID` | The API key's ID |
| Secret | `APPLE_API_ISSUER` | The issuer ID shown above the keys list |
| Variable | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Zinloop Security Inc (TEAMID1234)` |

## Checking

Don't push a test tag: a version tag also deploys to production. Instead,
open **Actions → release → Run workflow**. It builds and signs, then saves the
files as a `release-test` artifact on the run without publishing anything. The `sign-windows` job fails if any `.exe` isn't validly signed,
and the `sign-macos` job fails if signing or notarization fails, so nothing
half-signed is published. Checksums are computed after signing, so the RMM
install scripts keep verifying downloads.

The Windows job uses `Azure/trusted-signing-action@v2` (the action formerly at
`azure/artifact-signing-action`; both slugs resolve to it). Its inputs match
what the job passes — `endpoint`, `signing-account-name`,
`certificate-profile-name`, `files-folder`, `file-digest`, `timestamp-rfc3161`
and `timestamp-digest` — so once the secrets exist the job signs without
further changes.

## Local testing on your own machine

For running a locally built `zinloop.exe` on your own Windows box without the
"unknown publisher" / unsigned warnings while you develop:

    # from an ELEVATED PowerShell (Run as administrator), at the repo root:
    powershell -ExecutionPolicy Bypass -File deploy\signing\sign-local-dev.ps1

It mints a self-signed code-signing certificate, trusts it in this machine's
certificate stores, and signs the binary. `Get-AuthenticodeSignature
zinloop.exe` then reports `Valid`.

This is for your machine only. Your customers have never seen that certificate,
so to them the build is still unsigned — SmartScreen's online reputation is a
separate thing a real, identity-validated certificate earns. Use the Azure
Artifact Signing path above for anything you ship. Clean up the test
certificate with:

    powershell -ExecutionPolicy Bypass -File deploy\signing\sign-local-dev.ps1 -Remove
