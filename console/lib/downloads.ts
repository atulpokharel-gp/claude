// Scanner builds the console hands out. Builds live in GitHub releases unless
// DOWNLOAD_BASE_URL says otherwise.

export const DOWNLOAD_FILES = new Set([
  "zinloop-windows-amd64.exe",
  "zinloop-windows-arm64.exe",
  "zinloop-darwin-amd64",
  "zinloop-darwin-arm64",
  "zinloop-linux-amd64",
  "zinloop-linux-arm64",
  "checksums.txt",
  "install-windows.ps1",
  "install-unix.sh",
]);

const DEFAULT_BASE = "https://github.com/atulpokharel-gp/claude/releases/latest/download";

export function downloadUrl(file: string, base = process.env.DOWNLOAD_BASE_URL || DEFAULT_BASE): string | null {
  if (!DOWNLOAD_FILES.has(file)) return null;
  return `${base.replace(/\/+$/, "")}/${file}`;
}

