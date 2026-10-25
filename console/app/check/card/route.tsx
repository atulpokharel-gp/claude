import { ImageResponse } from "next/og";
import { gradeBlurb, gradeColor, parseShare } from "@/lib/mcp-check.ts";

// The 1200×630 picture shown when a /check link is posted on LinkedIn, X or
// Slack. With valid share parameters it shows that grade; otherwise a prompt.
export function GET(req: Request) {
  const s = parseShare(Object.fromEntries(new URL(req.url).searchParams));
  const ink = "#10202f";
  const paper = "#f2f4f1";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: paper, color: ink, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>Zinloop Security · AI connector check</div>
        {s ? (
          <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 260, height: 260, borderRadius: 32, background: gradeColor[s.grade], color: "#fff", fontSize: 200, fontWeight: 800 }}>
              {s.grade}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", fontSize: 60, fontWeight: 800 }}>{gradeBlurb[s.grade]}</div>
              <div style={{ display: "flex", fontSize: 34 }}>
                {`${s.servers} connectors · ${s.high} high · ${s.medium} medium · ${s.low} low`}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, maxWidth: 1000 }}>What grade does your AI setup get?</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30 }}>
          <span>Free · 10 seconds · nothing leaves your browser</span>
          <span style={{ background: "#f2a93b", padding: "6px 16px", borderRadius: 8, fontWeight: 700 }}>Check yours</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
