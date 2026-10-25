import { gradeColor, type Grade } from "@/lib/mcp-check.ts";

// A small README badge ("AI setup | B"), shields.io style. Only a letter is
// accepted, so the SVG can't carry anything else.
export function GET(req: Request) {
  const g = new URL(req.url).searchParams.get("g") ?? "";
  const grade: Grade | "?" = /^[ABCDF]$/.test(g) ? (g as Grade) : "?";
  const color = grade === "?" ? "#6b7785" : gradeColor[grade];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="20" role="img" aria-label="AI setup: ${grade}">
<title>AI setup: ${grade} (checked with Zinloop)</title>
<rect width="72" height="20" fill="#10202f"/><rect x="72" width="24" height="20" fill="${color}"/>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="36" y="14">AI setup</text><text x="84" y="14" font-weight="bold">${grade}</text></g></svg>`;
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
}
