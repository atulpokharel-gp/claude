// A simple horizontal bar for each of the five builder-profile dimensions.
// Server component — pure render, no state.

import { DIMENSION_BLURB, DIMENSION_LABEL, type DimensionAggregate } from "@/lib/paxel.ts";

export function ProfilePanel({ dims, caption }: { dims: DimensionAggregate[]; caption?: string }) {
  const anyScore = dims.some((d) => d.score > 0 || d.sessions > 0);
  if (!anyScore) {
    return (
      <div className="panel-body">
        <p className="empty">
          No builder-profile data yet. Run <code>zinloop paxel</code> on a laptop with a few Claude Code
          sessions to populate this.
        </p>
      </div>
    );
  }
  return (
    <div className="panel-body">
      {caption ? <p className="muted small">{caption}</p> : null}
      <div className="profile-bars">
        {dims.map((d) => (
          <div key={d.dimension} className="profile-row">
            <div className="profile-row-head">
              <span className="profile-name">{DIMENSION_LABEL[d.dimension]}</span>
              <span className="profile-score">{d.score}</span>
            </div>
            <div className="profile-track">
              <div className="profile-fill" style={{ width: `${d.score}%` }} aria-hidden />
            </div>
            <p className="profile-blurb muted small">{DIMENSION_BLURB[d.dimension]}</p>
            {d.sessions > 0 ? (
              <p className="muted small">
                {d.sessions} session{d.sessions === 1 ? "" : "s"}
                {d.days ? ` over ${d.days} day${d.days === 1 ? "" : "s"}` : ""}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
