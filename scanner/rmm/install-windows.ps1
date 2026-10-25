# Zinloop scanner for Windows, for RMM tools (NinjaOne, Datto RMM, N-able,
# ConnectWise Automate). Run as SYSTEM or an administrator.
#
# Set these two variables in your RMM tool (or pass them as parameters):
#   ZINLOOP_CONSOLE_URL  e.g. https://zinloop.com
#   ZINLOOP_TOKEN        the client's upload token from the console (zlu_...)
#
# A daily scheduled task is added by default; pass -NoSchedule to skip it.
# The task fires at 10:00 local with up to two hours of random delay, so a
# fleet of laptops doesn't all hit the console at exactly 10:00.
#
# What it does: downloads the scanner to C:\ProgramData\Zinloop, checks its
# SHA-256 against the published checksums, saves the token where only SYSTEM
# and administrators can read it, scans every user profile (read-only) and
# sends the report.
param(
  [string]$ConsoleUrl = $env:ZINLOOP_CONSOLE_URL,
  [string]$Token = $env:ZINLOOP_TOKEN,
  [switch]$NoSchedule
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

if (-not $NoSchedule) {
  # -RandomDelay spreads the start of a fleet's uploads across the window
  # instead of a sharp spike at 10:00. Two hours is enough for several
  # thousand laptops in one tenant to stop looking like a flood.
  $action = New-ScheduledTaskAction -Execute $exe -Argument "--all-users --upload `"$ConsoleUrl/api/scans`" --token-file `"$tokenFile`""
  # Pass -RandomDelay to the cmdlet rather than assigning afterwards:
  # $trigger.RandomDelay is a string on the MSFT_TaskTrigger CIM class, so
  # assigning a TimeSpan to it serializes as "System.TimeSpan" and the
  # registration fails. The parameter form handles the ISO 8601 encoding.
  $trigger = New-ScheduledTaskTrigger -Daily -At 10am -RandomDelay (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
  Register-ScheduledTask -Force -TaskName 'Zinloop daily scan' -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Write-Output 'Daily scan scheduled (10:00 local +/- random up to 2h).'
}
exit $code
