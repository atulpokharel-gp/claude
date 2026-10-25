#!/bin/sh
# Zinloop scanner for macOS and Linux, for RMM tools. Run as root.
#
# Set in your RMM tool:
#   ZINLOOP_CONSOLE_URL  e.g. https://zinloop.com
#   ZINLOOP_TOKEN        the client's upload token from the console (zlu_...)
#
# A daily scan is scheduled by default (launchd on macOS, systemd timer on
# Linux when systemd is active, cron otherwise). Each run picks a random
# minute inside a two-hour window so a thousand laptops don't all hit the
# console at exactly 10:00. Set ZINLOOP_NO_SCHEDULE=1 to skip scheduling.
#
# Downloads the scanner to /usr/local/zinloop, checks its SHA-256, saves the
# token readable by root only, scans every user profile (read-only) and
# sends the report.
set -eu

url="${ZINLOOP_CONSOLE_URL:-}"
url="${url%/}"
case "$url" in
  https://*) ;;
  *) echo "Set ZINLOOP_CONSOLE_URL to your console address (https://...)." >&2; exit 1 ;;
esac

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
name="zinloop-$os-$arch"
dir=/usr/local/zinloop
bin="$dir/zinloop"
token_file="$dir/token"
mkdir -p "$dir"
chmod 755 "$dir"

tmp="$dir/$name.download"
curl -fsSL --proto =https "$url/download/$name" -o "$tmp"
expected=$(curl -fsSL --proto =https "$url/download/checksums.txt" | awk -v n="$name" '$2 == n || $2 == "*" n { print $1; exit }')
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp" | awk '{print $1}')
else
  actual=$(shasum -a 256 "$tmp" | awk '{print $1}')
fi
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  rm -f "$tmp"
  echo "Checksum mismatch for $name; not installing." >&2
  exit 1
fi
chmod 755 "$tmp"
mv -f "$tmp" "$bin"

if [ -n "${ZINLOOP_TOKEN:-}" ]; then
  umask 077
  printf '%s' "$ZINLOOP_TOKEN" > "$token_file"
  chmod 600 "$token_file"
fi
if [ ! -s "$token_file" ]; then
  echo "Set ZINLOOP_TOKEN to the upload token from the console." >&2
  exit 1
fi

set +e
"$bin" --all-users --upload "$url/api/scans" --token-file "$token_file"
code=$?
set -e

if [ "${ZINLOOP_NO_SCHEDULE:-0}" = "1" ]; then
  exit $code
fi

if [ "$os" = "darwin" ]; then
  # launchd. StartCalendarInterval doesn't natively jitter, so wrap the
  # command in a short shell that waits a random slice of a two-hour window
  # before running. Keeps the uploads spread even when every laptop in a
  # fleet starts at the same scheduled minute.
  plist=/Library/LaunchDaemons/com.zinloop.scan.plist
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.zinloop.scan</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>sleep \$((RANDOM % 7200)); exec '$bin' --all-users --upload '$url/api/scans' --token-file '$token_file'</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>LowPriorityIO</key><true/>
</dict></plist>
PLIST
  chown root:wheel "$plist" 2>/dev/null || true
  chmod 644 "$plist"
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "Daily scan scheduled (launchd, 10:00 local +/- random up to 2h)."
elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  # systemd timer. RandomizedDelaySec adds a bounded random offset so a
  # fleet of laptops spreads its uploads across the window.
  svc=/etc/systemd/system/zinloop-scan.service
  tmr=/etc/systemd/system/zinloop-scan.timer
  cat > "$svc" <<SVC
[Unit]
Description=Zinloop daily scan
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=$bin --all-users --upload $url/api/scans --token-file $token_file
Nice=10
IOSchedulingClass=idle
SVC
  cat > "$tmr" <<TMR
[Unit]
Description=Zinloop daily scan

[Timer]
OnCalendar=*-*-* 10:00:00
RandomizedDelaySec=2h
Persistent=true
Unit=zinloop-scan.service

[Install]
WantedBy=timers.target
TMR
  # If a cron file from an older install is still there, remove it so the
  # scan doesn't run twice.
  rm -f /etc/cron.d/zinloop
  systemctl daemon-reload
  systemctl enable --now zinloop-scan.timer >/dev/null
  echo "Daily scan scheduled (systemd timer, 10:00 local +/- random up to 2h)."
else
  # Fallback: cron. Pick a random minute inside the first 15 min of the hour
  # at install time (fleet jitter), and sleep up to two hours inside the
  # job (per-run jitter). The pipe through sh gives us $RANDOM.
  minute=$(awk 'BEGIN{srand(); print int(rand()*15)}')
  cat > /etc/cron.d/zinloop <<CRON
# Zinloop daily scan. The sleep is per-run jitter so a fleet spreads its
# uploads across a 2-hour window around 10:00 local.
$minute 10 * * * root /bin/sh -c 'sleep \$((RANDOM % 7200)); $bin --all-users --upload $url/api/scans --token-file $token_file' >/dev/null 2>&1
CRON
  chmod 644 /etc/cron.d/zinloop
  echo "Daily scan scheduled (cron, 10:$minute local +/- random up to 2h)."
fi

exit $code
