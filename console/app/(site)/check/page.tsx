import type { Metadata } from "next";
import { siteBase } from "@/lib/mcp-check.ts";
import { CheckTool } from "./CheckTool.tsx";

// Dynamic so the share-card URL uses the CONSOLE_URL set where it runs.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
  metadataBase: siteBase(),
  title: "Free AI connector check",
  description:
    "Paste your Claude, Cursor or VS Code AI connector (MCP) config and get a security grade in seconds. Runs in your browser; nothing is uploaded.",
  openGraph: {
    title: "What grade does your AI setup get?",
    description: "Free 10-second security check for Claude, Cursor and VS Code AI connectors. Nothing leaves your browser.",
    images: ["/check/card"],
  },
  twitter: { card: "summary_large_image", images: ["/check/card"] },
  };
}

export default function CheckPage() {
  return (
    <section className="section">
      <div className="wrap stack" style={{ gap: 28, maxWidth: 860 }}>
        <div className="stack" style={{ gap: 14 }}>
          <p className="eyebrow">Free · no sign-up · nothing uploaded</p>
          <h1 className="disp h1">What grade does your AI setup get?</h1>
          <p className="lead">
            AI assistants like Claude, Cursor and Copilot connect to your files, terminal and company apps through
            &ldquo;MCP servers&rdquo;. Paste the config file and see, in seconds, which ones leak keys, run unpinned
            code or can touch everything on your computer.
          </p>
        </div>
        <CheckTool />
      </div>
    </section>
  );
}
