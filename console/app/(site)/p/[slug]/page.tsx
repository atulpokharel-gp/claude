// Public builder profile page.
//
// Unauthenticated: anyone with the slug can see the dimensions the
// developer has opted in to share. The lookup goes through a SECURITY
// DEFINER function so an unknown slug reveals no PII; the score read is
// filtered to the user_hash's own rows via a tenant transaction.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DIMENSION_LABEL,
  readPublicProfile,
} from "@/lib/zipax.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const view = await readPublicProfile(slug);
  return {
    title: view ? `${view.displayName} — builder profile` : "Builder profile",
    description: view ? `Public Zipax builder-profile scores for ${view.displayName}` : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await readPublicProfile(slug);
  if (!view) return notFound();
  return (
    <div className="wrap narrow">
      <h1>{view.displayName}</h1>
      <p className="muted">
        Builder profile — public view. The developer picks which dimensions appear here. Scores are
        computed on the developer's laptop from Claude Code sessions and never include prompts or
        code.
      </p>
      <div className="profile-bars">
        {view.dims.map((d) => (
          <div key={d.dimension} className="profile-row">
            <div className="profile-row-head">
              <span className="profile-name">{DIMENSION_LABEL[d.dimension]}</span>
              <span className="profile-score">{d.score}</span>
            </div>
            <div className="profile-track">
              <div className="profile-fill" style={{ width: `${d.score}%` }} aria-hidden />
            </div>
            {view.showSessions && d.sessions > 0 ? (
              <p className="muted small">
                {d.sessions} session{d.sessions === 1 ? "" : "s"} over the last 30 days
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="muted small">
        See the full <a href="/leaderboard">public leaderboard</a> · Powered by{" "}
        <a href="/">Zinloop Zipax</a>.
      </p>
    </div>
  );
}
