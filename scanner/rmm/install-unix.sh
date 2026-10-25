#!/bin/sh
# Zinloop scanner for macOS and Linux, for RMM tools. Run as root.
#
# Set in your RMM tool:
#   ZINLOOP_CONSOLE_URL  e.g. https://zinloop.com
#   ZINLOOP_TOKEN        the client's upload token from the console (zlu_...)
# Optional: ZINLOOP_SCHEDULE=1 adds a daily run (launchd on macOS, cron on Linux).
#
# Downloads the scanner to /usr/local/zinloop, checks its SHA-256, saves the
# token readable by root only, scans every user profile (read-only) and sends
# the report.
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

if [ "${ZINLOOP_SCHEDULE:-}" = "1" ]; then
  if [ "$os" = "darwin" ]; then
    plist=/Library/LaunchDaemons/com.zinloop.scan.plist
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.zinloop.scan</string>
  <key>ProgramArguments</key><array>
    <string>$bin</string><string>--all-users</string>
    <string>--upload</string><string>$url/api/scans</string>
    <string>--token-file</string><string>$token_file</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
</dict></plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
  else
    echo "0 10 * * * root $bin --all-users --upload $url/api/scans --token-file $token_file >/dev/null 2>&1" > /etc/cron.d/zinloop
    chmod 644 /etc/cron.d/zinloop
  fi
  echo "Daily scan scheduled."
fi
exit $code
