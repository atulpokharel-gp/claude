import type { Metadata } from "next";
import Link from "next/link";
import { gradeBlurb, parseShare, siteBase } from "@/lib/mcp-check.ts";

type Params = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const s = parseShare(await searchParams);
  if (!s) return { title: "Free AI connector check" };
  const q = new URLSearchParams({ g: s.grade, h: String(s.high), m: String(s.medium), l: String(s.low), n: String(s.servers) });
  const title = `This AI setup scored ${s.grade}`;
  const description = `${s.high} high, ${s.medium} medium and ${s.low} low risks across ${s.servers} AI connectors. Check yours free in 10 seconds.`;
  return {
    metadataBase: siteBase(),
    title,
    description,
    robots: { index: false },
    openGraph: { title, description, images: [`/check/card?${q}`] },
    twitter: { card: "summary_large_image", title, description, images: [`/check/card?${q}`] },
  };
}

export default async function SharedResult({ searchParams }: { searchParams: Params }) {
  const s = parseShare(await searchParams);
  return (
    <section className="section">
      <div className="wrap stack" style={{ gap: 24, maxWidth: 720 }}>
        {s ? (
          <div className="result card strong">
            <div className="grade-row">
              <span className={`grade grade-${s.grade}`} aria-label={`Grade ${s.grade}`}>
                {s.grade}
              </span>
              <div>
                <p className="eyebrow">Someone shared their AI setup grade</p>
                <p className="disp h2">{gradeBlurb[s.grade]}</p>
                <p className="body">
                  {s.servers} AI connector{s.servers === 1 ? "" : "s"} · {s.high} high · {s.medium} medium · {s.low} low
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="lead">This share link is incomplete.</p>
        )}
        <h1 className="disp h1">What does yours score?</h1>
        <p className="lead">Paste your Claude, Cursor or VS Code AI connector config. It takes 10 seconds and never leaves your browser.</p>
        <div className="buttons">
          <Link className="zbtn zbtn-main" href="/check">
            Check my AI setup
          </Link>
        </div>
      </div>
    </section>
  );
}
