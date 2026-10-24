# Zinloop scanner for Windows, for RMM tools (NinjaOne, Datto RMM, N-able,
# ConnectWise Automate). Run as SYSTEM or an administrator.
#
# Set these two variables in your RMM tool (or pass them as parameters):
#   ZINLOOP_CONSOLE_URL  e.g. https://app.zinloop.com
#   ZINLOOP_TOKEN        the client's upload token from the console (zlu_...)
#
# What it does: downloads the scanner to C:\ProgramData\Zinloop, checks its
# SHA-256 against the published checksums, saves the token where only SYSTEM
# and administrators can read it, scans every user profile (read-only) and
# sends the report. With -Schedule it also adds a daily scheduled task.
param(
  [string]$ConsoleUrl = $env:ZINLOOP_CONSOLE_URL,
  [string]$Token = $env:ZINLOOP_TOKEN,
  [switch]$Schedule
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $ConsoleUrl) { Write-Error 'Set ZINLOOP_CONSOLE_URL to your console address.'; exit 1 }
$ConsoleUrl = $ConsoleUrl.TrimEnd('/')
if (-not $ConsoleUrl.StartsWith('https://')) { Write-Error 'ZINLOOP_CONSOLE_URL must start with https://'; exit 1 }

$dir = Join-Path $env:ProgramData 'Zinloop'
$exe = Join-Path $dir 'zinloop.exe'
$tokenFile = Join-Path $dir 'token'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$name = "zinloop-windows-$arch.exe"
$tmp = Join-Path $dir "$name.download"
Invoke-WebRequest -UseBasicParsing -Uri "$ConsoleUrl/download/$name" -OutFile $tmp
$sums = (Invoke-WebRequest -UseBasicParsing -Uri "$ConsoleUrl/download/checksums.txt").Content
$expected = ($sums -split "`n" | Where-Object { $_ -match "\s\*?$([regex]::Escape($name))\s*$" } | Select-Object -First 1) -replace '\s.*$', ''
$actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if (-not $expected -or $expected.ToLower() -ne $actual) {
  Remove-Item -Force $tmp
  Write-Error "Checksum mismatch for $name; not installing."
  exit 1
}
Move-Item -Force $tmp $exe

if ($Token) {
  Set-Content -NoNewline -Path $tokenFile -Value $Token
  # Only SYSTEM and administrators may read the token.
  icacls $tokenFile /inheritance:r /grant:r 'SYSTEM:(R,W)' 'Administrators:(R,W)' | Out-Null
}
if (-not (Test-Path $tokenFile)) { Write-Error 'Set ZINLOOP_TOKEN to the upload token from the console.'; exit 1 }

& $exe --all-users --upload "$ConsoleUrl/api/scans" --token-file $tokenFile
$code = $LASTEXITCODE

if ($Schedule) {
  $action = New-ScheduledTaskAction -Execute $exe -Argument "--all-users --upload `"$ConsoleUrl/api/scans`" --token-file `"$tokenFile`""
  $trigger = New-ScheduledTaskTrigger -Daily -At 10am
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
  Register-ScheduledTask -Force -TaskName 'Zinloop daily scan' -Action $action -Trigger $trigger -Principal $principal | Out-Null
  Write-Output 'Daily scan scheduled.'
}
exit $code
