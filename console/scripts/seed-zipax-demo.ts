// Seeds a fixed set of fictional developers into the Zipax tables so the
// public /leaderboard and /p/{slug} pages have something to show while the
// product is new. Everything is scoped to a single dedicated demo MSP named
// "Zinloop Demo" with one client "Showcase Devs"; nothing is attached to a
// real MSP, so this never pollutes a real Zinloop Security client view.
//
//   DATABASE_ADMIN_URL=postgres://owner... npm run db:seed-zipax-demo
//   DATABASE_ADMIN_URL=postgres://owner... npm run db:seed-zipax-demo -- --teardown
//
// The script is idempotent. Running it twice does not duplicate rows; it
// re-upserts the same demo MSP, client, devices, scores, and public-profile
// prefs with the same deterministic ids. --teardown drops the demo MSP,
// which cascades to the client, devices, scans, usage events, scores,
// prefs and claims — a single command removes every demo row.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

// --- demo data ------------------------------------------------------------
//
// A deterministic namespace uuid: everything in this seed derives its uuid
// from this plus a role string, so repeated runs reuse the same ids and
// the upserts converge.
const DEMO_NS = "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0";
const DEMO_MSP_NAME = "Zinloop Demo";
const DEMO_CLIENT_NAME = "Showcase Devs";

const DIMENSIONS = ["steering", "execution", "engineering", "product-instinct", "planning"] as const;
type Dimension = (typeof DIMENSIONS)[number];

type Archetype = Partial<Record<Dimension, number>> & { base: number };

type Dev = {
  // The URL slug — must match ^[a-z0-9]{3,32}$. The "demo" prefix makes
  // every seeded profile easy to recognize and lets a human visually
  // separate them from a real user's chosen slug.
  slug: string;
  // Shown on /p/{slug} and the leaderboard. Short, fictional, no @, no
  // real emails.
  displayName: string;
  // Which AI coding tool dominates this persona. Spread across claude-code,
  // codex and cursor so the data looks like a real multi-tool team.
  primaryTool: "claude-code" | "codex" | "cursor";
  // How many days of history to generate. Varied so sessions_counted on
  // the leaderboard also varies across rows.
  days: number;
  // 1-3 projects the dev works on; each becomes a distinct project_hash /
  // project_label pair and widens the number of rows per dev.
  projects: string[];
  // Base score plus a per-dimension bias. Clamped to 0-100 before insert.
  archetype: Archetype;
};

const DEVS: Dev[] = [
  {
    slug: "demoariadne",
    displayName: "Ariadne (demo)",
    primaryTool: "claude-code",
    days: 42,
    projects: ["warp-stream", "console"],
    archetype: { base: 78, planning: 14, steering: 8 },
  },
  {
    slug: "demokaede",
    displayName: "Kaede (demo)",
    primaryTool: "codex",
    days: 36,
    projects: ["ledger-ui", "ledger-api"],
    archetype: { base: 74, execution: 16, engineering: 6 },
  },
  {
    slug: "demotomas",
    displayName: "Tomas (demo)",
    primaryTool: "cursor",
    days: 28,
    projects: ["pager-mobile"],
    archetype: { base: 71, "product-instinct": 15, steering: 5 },
  },
  {
    slug: "demopriya",
    displayName: "Priya (demo)",
    primaryTool: "claude-code",
    days: 48,
    projects: ["payments-core", "payments-webhooks"],
    archetype: { base: 76, engineering: 15, planning: 6 },
  },
  {
    slug: "demojonas",
    displayName: "Jonas (demo)",
    primaryTool: "claude-code",
    days: 54,
    projects: ["onboarding", "onboarding-emails"],
    archetype: { base: 72, steering: 16, execution: 4 },
  },
  {
    slug: "demomina",
    displayName: "Mina (demo)",
    primaryTool: "codex",
    days: 33,
    projects: ["search-indexer"],
    archetype: { base: 69, execution: 8, engineering: 8, planning: 8 },
  },
  {
    slug: "demoravi",
    displayName: "Ravi (demo)",
    primaryTool: "cursor",
    days: 40,
    projects: ["admin-portal", "admin-reports"],
    archetype: { base: 70, planning: 12, "product-instinct": 10 },
  },
  {
    slug: "demoluca",
    displayName: "Luca (demo)",
    primaryTool: "codex",
    days: 31,
    projects: ["billing-worker"],
    archetype: { base: 67, execution: 14, engineering: 10 },
  },
];

// --- helpers --------------------------------------------------------------

// Deterministic uuid v5-style derivation from a namespace + role string.
// We don't need true RFC-4122 v5 since these ids never leave the demo
// MSP; we only need the same input to always produce the same uuid so the
// script converges on a reseed. sha1 of (ns-hex || label), then set the
// version/variant bits for a well-formed uuid.
function demoUuid(label: string): string {
  const nsBytes = Buffer.from(DEMO_NS.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(nsBytes).update(label).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// user_hash and project_hash must match ^[0-9a-f]{16,64}$. We use sha256
// hex (64 chars) of a stable input per dev/project so reruns re-upsert.
function demoHash(label: string): string {
  return createHash("sha256").update("zinloop-demo\x00").update(label).digest("hex");
}

function clampScore(x: number): number {
  if (x < 0) return 0;
  if (x > 100) return 100;
  return Math.round(x);
}

// Deterministic pseudo-random noise so the same seed run after run
// produces the same per-day jitter — otherwise reseeds would churn every
// row with a tiny ±delta on every score.
function noise(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return (h.readUInt32BE(0) % 1000) / 1000; // 0..1
}

function dateDaysAgo(n: number, today: Date): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function dimensionScore(dev: Dev, dim: Dimension, dayIdx: number): number {
  const bias = dev.archetype[dim] ?? 0;
  // Early-career ramp: scores climb slightly over the window so the
  // chart has shape instead of a flat line.
  const ramp = (dayIdx / Math.max(1, dev.days - 1)) * 4;
  const jitter = (noise(`${dev.slug}:${dim}:${dayIdx}`) - 0.5) * 8;
  return clampScore(dev.archetype.base + bias + ramp + jitter);
}

function sessionsForDay(dev: Dev, dayIdx: number): number {
  // 1-3 sessions per day, deterministic per dev+day.
  return 1 + Math.floor(noise(`${dev.slug}:sessions:${dayIdx}`) * 3);
}

// --- seed -----------------------------------------------------------------

async function seed(url: string, log = console.log): Promise<void> {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("begin");

    const mspId = demoUuid("msp");
    const clientId = demoUuid("client");

    // Even though the admin role bypasses RLS, we set app.msp_id so this
    // works unchanged if someone points the script at a non-superuser
    // owner role — same pattern as scripts/create-msp.ts.
    await db.query("select set_config('app.msp_id', $1, true)", [mspId]);

    await db.query(
      `insert into msps (id, name)
       values ($1, $2)
       on conflict (id) do update set name = excluded.name`,
      [mspId, DEMO_MSP_NAME],
    );

    await db.query(
      `insert into clients (id, msp_id, name, industry, staff, devices_expected)
       values ($1, $2, $3, 'Software', ${DEVS.length}, ${DEVS.length})
       on conflict (id) do update set name = excluded.name`,
      [clientId, mspId, DEMO_CLIENT_NAME],
    );

    log(`seeded msp ${mspId} and client ${clientId}`);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let scoreRows = 0;
    let prefRows = 0;

    for (const dev of DEVS) {
      const deviceId = demoUuid(`device:${dev.slug}`);
      const userHash = demoHash(`user:${dev.slug}`);
      const userLabel = dev.displayName;

      await db.query(
        `insert into devices (id, msp_id, client_id, hostname, os, last_scan_at)
         values ($1, $2, $3, $4, 'macOS', now())
         on conflict (id) do update set
           hostname     = excluded.hostname,
           last_scan_at = excluded.last_scan_at`,
        [deviceId, mspId, clientId, `${dev.slug}-laptop`],
      );

      for (const project of dev.projects) {
        const projectHash = demoHash(`project:${dev.slug}:${project}`);
        for (let i = 0; i < dev.days; i++) {
          const bucketDay = dateDaysAgo(i, today);
          const sessions = sessionsForDay(dev, i);
          for (const dim of DIMENSIONS) {
            const score = dimensionScore(dev, dim, i);
            await db.query(
              `insert into zipax_profile_scores (
                 msp_id, client_id, device_id, tool, user_hash, user_label,
                 project_hash, project_label, dimension, bucket_day, score,
                 sessions, metrics, first_seen_at, last_seen_at
               ) values (
                 $1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, '{}'::jsonb, now(), now()
               )
               on conflict (device_id, tool, user_hash, project_hash, dimension, bucket_day)
               do update set
                 score      = excluded.score,
                 sessions   = greatest(zipax_profile_scores.sessions, excluded.sessions),
                 user_label = excluded.user_label,
                 project_label = excluded.project_label,
                 last_seen_at = now()`,
              [
                mspId,
                clientId,
                deviceId,
                dev.primaryTool,
                userHash,
                userLabel,
                projectHash,
                project,
                dim,
                bucketDay,
                score,
                sessions,
              ],
            );
            scoreRows++;
          }
        }
      }

      await db.query(
        `insert into zipax_profile_prefs (
           msp_id, client_id, user_hash, display_name, public_slug, public_dims,
           leaderboard_opt_in, show_display_name, show_mean_score, show_sessions,
           updated_at
         ) values (
           $1, $2, $3, $4, $5, $6::text[],
           true, true, true, true,
           now()
         )
         on conflict (msp_id, user_hash) do update set
           display_name       = excluded.display_name,
           public_slug        = excluded.public_slug,
           public_dims        = excluded.public_dims,
           leaderboard_opt_in = true,
           show_display_name  = true,
           show_mean_score    = true,
           show_sessions      = true,
           updated_at         = now()`,
        [mspId, clientId, userHash, dev.displayName, dev.slug, DIMENSIONS as unknown as string[]],
      );
      prefRows++;
      log(`  ${dev.slug.padEnd(14)} ${dev.primaryTool.padEnd(11)} ${dev.days}d × ${dev.projects.length}p`);
    }

    await db.query("commit");
    log(`inserted/updated ${scoreRows} score rows and ${prefRows} prefs rows`);
    log(`demo MSP id: ${mspId}`);
    log(`try https://zipax.zinloop.com/leaderboard and https://zipax.zinloop.com/p/${DEVS[0].slug}`);
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    await db.end();
  }
}

async function teardown(url: string, log = console.log): Promise<void> {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const mspId = demoUuid("msp");
    await db.query("select set_config('app.msp_id', $1, true)", [mspId]);
    const r = await db.query<{ id: string }>(`delete from msps where id = $1 returning id`, [mspId]);
    if (r.rowCount === 0) {
      log(`no demo MSP found (id ${mspId})`);
    } else {
      log(`deleted demo MSP ${mspId}; cascade removed every demo client, device, score and pref`);
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error("Set DATABASE_ADMIN_URL to an owner connection string.");
    process.exit(1);
  }
  const mode = process.argv.includes("--teardown") ? "teardown" : "seed";
  (mode === "teardown" ? teardown(url) : seed(url)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { seed, teardown, DEMO_MSP_NAME, DEMO_CLIENT_NAME, DEVS };
