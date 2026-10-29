<#
.SYNOPSIS
  LOCAL TEST ONLY. Generate a self-signed code-signing certificate, sign
  zinloop.exe with it, and trust that certificate on THIS machine so Windows
  stops flagging the binary as from an unknown/untrusted publisher.

.DESCRIPTION
  This exists so you can run a locally built zinloop.exe on your own Windows box
  without the "unknown publisher" / unsigned warnings while developing.

  It does NOT make the binary trusted for anyone else. Your customers' machines
  have never seen this self-signed certificate, so to them the build is still
  unsigned. Real, customer-facing trust comes from signing with a certificate
  issued after Microsoft validates your company's identity (Azure Artifact
  Signing). That path is wired into .github/workflows/release.yml and documented
  in docs/signing.md. There is no way for a script to grant that trust.

  Run from an ELEVATED PowerShell (Run as administrator): trusting a certificate
  writes to the LocalMachine certificate stores.

.PARAMETER ExePath
  The .exe to sign. Defaults to zinloop.exe at the repo root.

.PARAMETER Remove
  Uninstall the self-signed certificate from this machine's trust stores and
  exit. Use this to clean up when you're done testing.

.EXAMPLE
  # Sign the repo-root zinloop.exe and trust it locally:
  powershell -ExecutionPolicy Bypass -File deploy\signing\sign-local-dev.ps1

.EXAMPLE
  # Sign a specific build:
  .\sign-local-dev.ps1 -ExePath scanner\dist\zinloop-windows-amd64.exe

.EXAMPLE
  # Remove the test certificate afterwards:
  .\sign-local-dev.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$ExePath = (Join-Path $PSScriptRoot '..\..\zinloop.exe'),
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'

# A fixed subject so repeat runs reuse / clean up the same cert instead of
# piling up new ones. The name is deliberately alarming: this is not for trust.
$Subject = 'CN=Zinloop LOCAL DEV TEST - DO NOT TRUST'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Get-TestCerts {
  Get-ChildItem Cert:\LocalMachine\My, Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject }
}

if (-not (Test-Admin)) {
  Write-Error 'Run this from an elevated PowerShell (Run as administrator). Trusting a certificate writes to the LocalMachine stores.'
  exit 1
}

if ($Remove) {
  $removed = 0
  foreach ($store in 'Root', 'TrustedPublisher', 'My') {
    Get-ChildItem "Cert:\LocalMachine\$store" -ErrorAction SilentlyContinue |
      Where-Object { $_.Subject -eq $Subject } |
      ForEach-Object { Remove-Item $_.PSPath -Force; $removed++ }
  }
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject } |
    ForEach-Object { Remove-Item $_.PSPath -Force; $removed++ }
  Write-Output "Removed $removed certificate entr$(if ($removed -eq 1){'y'}else{'ies'}) for '$Subject'."
  exit 0
}

$ExePath = (Resolve-Path $ExePath).Path
if (-not (Test-Path $ExePath)) { Write-Error "No file at $ExePath"; exit 1 }

# Reuse an existing test cert if present (and still has its private key),
# otherwise mint a new 6-month one in the user's personal store.
$cert = Get-TestCerts | Where-Object { $_.HasPrivateKey } | Select-Object -First 1
if (-not $cert) {
  Write-Output 'Creating a self-signed code-signing certificate...'
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddMonths(6)
}

# Trust the certificate on this machine: Root makes the Authenticode chain valid,
# TrustedPublisher makes Windows treat it as a known publisher.
$pubCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cert.RawData)
foreach ($storeName in 'Root', 'TrustedPublisher') {
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    $storeName, 'LocalMachine')
  $store.Open('ReadWrite')
  if (-not ($store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) {
    $store.Add($pubCert)
    Write-Output "Trusted the certificate in LocalMachine\$storeName."
  }
  $store.Close()
}

# A public timestamp just records WHEN it was signed; it works with a self-signed
# cert and keeps the signature valid after the cert expires. Skip it offline.
$sig = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert `
  -HashAlgorithm SHA256 `
  -TimestampServer 'http://timestamp.digicert.com' -ErrorAction SilentlyContinue
if (-not $sig -or $sig.Status -ne 'Valid') {
  $sig = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -HashAlgorithm SHA256
}

$check = Get-AuthenticodeSignature $ExePath
Write-Output ''
Write-Output "Signed: $ExePath"
Write-Output "  Status : $($check.Status)"
Write-Output "  Signer : $($check.SignerCertificate.Subject)"
if ($check.Status -ne 'Valid') {
  Write-Error "Signature did not come out Valid (got '$($check.Status)')."
  exit 1
}
Write-Output ''
Write-Output 'Done. This binary is now trusted ON THIS MACHINE ONLY.'
Write-Output 'Customers do not have this certificate, so to them the build is still'
Write-Output 'unsigned. For real distribution, set up Azure Artifact Signing'
Write-Output '(docs/signing.md) and let the release workflow sign tagged builds.'
Write-Output "Clean up later with:  .\sign-local-dev.ps1 -Remove"
