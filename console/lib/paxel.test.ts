import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allTokens,
  DIMENSIONS,
  fmtTokens,
  fmtUsd,
  newClaimToken,
  newPublicSlug,
  parseUpload,
  PaxelError,
  readDevIdentity,
  rollup,
  signDevIdentity,
  type NormalBucket,
} from "./paxel.ts";

const USER_A = "aa".repeat(16); // 32 hex
const USER_B = "bb".repeat(16);
const PROJ_X = "cc".repeat(16);
const PROJ_Y = "dd".repeat(16);

function row(over: Partial<NormalBucket>): {
  tool: string;
  user_hash: string;
  user_label: string;
  project_hash: string;
  project_label: string;
  model: string;
  bucket_day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd_cents: number;
  messages: number;
} {
  return {
    tool: over.tool ?? "claude-code",
    user_hash: over.userHash ?? USER_A,
    user_label: over.userLabel ?? "alice",
    project_hash: over.projectHash ?? PROJ_X,
    project_label: over.projectLabel ?? "foo",
    model: over.model ?? "claude-sonnet-4-5",
    bucket_day: over.day ?? "2026-10-20",
    input_tokens: over.inputTokens ?? 100,
    output_tokens: over.outputTokens ?? 50,
    cache_read_tokens: over.cacheReadTokens ?? 0,
    cache_write_tokens: over.cacheWriteTokens ?? 0,
    cost_usd_cents: over.costUsdCents ?? 30,
    messages: over.messages ?? 1,
  };
}

test("parseUpload accepts a well-formed upload", () => {
  const got = parseUpload({
    hostname: "laptop1",
    os: "linux",
    buckets: [
      {
        tool: "claude-code",
        userHash: USER_A,
        userLabel: "alice",
        projectHash: PROJ_X,
        projectLabel: "foo",
        model: "claude-sonnet-4-5",
        sessionId: "sess-1",
        day: "2026-10-20",
        inputTokens: 100,
        outputTokens: 50,
      },
    ],
  });
  assert.equal(got.hostname, "laptop1");
  assert.equal(got.os, "linux");
  assert.equal(got.buckets.length, 1);
  assert.equal(got.buckets[0].inputTokens, 100);
});

test("parseUpload drops zero-usage buckets", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [
      { tool: "codex", userHash: USER_A, projectHash: PROJ_X, day: "2026-10-20", inputTokens: 0, outputTokens: 0 },
    ],
  });
  assert.equal(got.buckets.length, 0);
});

test("parseUpload rejects malformed hash", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [
      { tool: "codex", userHash: "not-hex", projectHash: PROJ_X, day: "2026-10-20", inputTokens: 100, outputTokens: 10 },
    ],
  });
  assert.equal(got.buckets.length, 0);
});

test("parseUpload rejects bad day format", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [
      { tool: "codex", userHash: USER_A, projectHash: PROJ_X, day: "last tuesday", inputTokens: 100, outputTokens: 10 },
    ],
  });
  assert.equal(got.buckets.length, 0);
});

test("parseUpload requires a hostname", () => {
  assert.throws(() => parseUpload({ buckets: [] }), (e: unknown) => e instanceof PaxelError);
});

test("parseUpload caps the bucket array", () => {
  const buckets = Array.from({ length: 10_000 }, (_, i) => ({
    tool: "codex",
    userHash: USER_A,
    projectHash: PROJ_X,
    day: "2026-10-20",
    sessionId: String(i),
    inputTokens: 1,
    outputTokens: 1,
  }));
  assert.throws(() => parseUpload({ hostname: "h", buckets }), (e: unknown) => e instanceof PaxelError);
});

test("parseUpload trims and lowercases hashes and strings", () => {
  const got = parseUpload({
    hostname: "  laptop1  ",
    buckets: [
      {
        tool: "  CLAUDE-CODE  ",
        userHash: " " + USER_A.toUpperCase() + " ",
        projectHash: PROJ_X,
        day: "2026-10-20",
        inputTokens: 10,
        outputTokens: 5,
      },
    ],
  });
  assert.equal(got.hostname, "laptop1");
  assert.equal(got.buckets[0].tool, "claude-code");
  assert.equal(got.buckets[0].userHash, USER_A);
});

test("rollup totals every row", () => {
  const rows = [
    row({}),
    row({ userHash: USER_B, userLabel: "bob", inputTokens: 200, outputTokens: 100, costUsdCents: 60 }),
    row({ projectHash: PROJ_Y, projectLabel: "bar", inputTokens: 50, outputTokens: 25, costUsdCents: 15 }),
  ];
  const r = rollup(rows);
  assert.equal(r.totals.inputTokens, 350);
  assert.equal(r.totals.outputTokens, 175);
  assert.equal(r.totals.messages, 3);
  assert.equal(r.totals.costUsdCents, 105);
});

test("rollup groups by tool, project, user, day", () => {
  const rows = [
    row({ tool: "claude-code", day: "2026-10-20" }),
    row({ tool: "codex", day: "2026-10-20", inputTokens: 500, outputTokens: 100 }),
    row({ tool: "claude-code", day: "2026-10-21", inputTokens: 25, outputTokens: 10 }),
  ];
  const r = rollup(rows);
  assert.equal(r.byTool.length, 2);
  const claude = r.byTool.find((t) => t.key === "claude-code")!;
  const codex = r.byTool.find((t) => t.key === "codex")!;
  assert.equal(allTokens(claude.totals), 100 + 50 + 25 + 10);
  assert.equal(allTokens(codex.totals), 600);
  // byTool is sorted desc by total tokens.
  assert.equal(r.byTool[0].key, "codex");
  assert.equal(r.byDay.length, 2);
  // byDay is sorted ascending.
  assert.equal(r.byDay[0].day, "2026-10-20");
});

test("rollup picks the first non-empty label for a project/user", () => {
  const rows = [
    row({ projectLabel: "" }),
    row({ projectLabel: "foo" }),
  ];
  const r = rollup(rows);
  assert.equal(r.byProject[0].label, "foo");
});

test("rollup limits byUser and byProject", () => {
  const rows: ReturnType<typeof row>[] = [];
  for (let i = 0; i < 100; i++) {
    const hash = String(i).padStart(32, "0");
    rows.push(row({ userHash: hash, projectHash: hash }));
  }
  const r = rollup(rows, 10);
  assert.equal(r.byUser.length, 10);
  assert.equal(r.byProject.length, 10);
});

test("fmtTokens is human-friendly", () => {
  assert.equal(fmtTokens(42), "42");
  assert.equal(fmtTokens(1_500), "1.5K");
  assert.equal(fmtTokens(1_500_000), "1.5M");
  assert.equal(fmtTokens(2_500_000_000), "2.5B");
});

test("parseUpload accepts and validates profile rows", () => {
  const got = parseUpload({
    hostname: "laptop1",
    buckets: [],
    profiles: [
      {
        tool: "claude-code",
        userHash: USER_A,
        userLabel: "alice",
        projectHash: PROJ_X,
        projectLabel: "foo",
        dimension: "steering",
        day: "2026-10-20",
        score: 72,
        sessions: 3,
        metrics: { user_turns: 8, tool_uses: 20 },
      },
    ],
  });
  assert.equal(got.profiles.length, 1);
  const p = got.profiles[0];
  assert.equal(p.score, 72);
  assert.equal(p.sessions, 3);
  assert.equal(p.metrics.tool_uses, 20);
});

test("parseUpload drops profile rows with unknown dimension or bad score", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [],
    profiles: [
      { tool: "claude-code", userHash: USER_A, projectHash: PROJ_X, dimension: "chaos", day: "2026-10-20", score: 50 },
      { tool: "claude-code", userHash: USER_A, projectHash: PROJ_X, dimension: "steering", day: "2026-10-20" },
    ],
  });
  assert.equal(got.profiles.length, 0);
});

test("parseUpload clamps profile score to 0-100", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [],
    profiles: [
      { tool: "claude-code", userHash: USER_A, projectHash: PROJ_X, dimension: "steering", day: "2026-10-20", score: 1000 },
      { tool: "claude-code", userHash: USER_A, projectHash: PROJ_X, dimension: "execution", day: "2026-10-20", score: -5 },
    ],
  });
  assert.equal(got.profiles[0].score, 100);
  assert.equal(got.profiles[1].score, 0);
});

test("parseUpload caps profiles length", () => {
  const profiles = Array.from({ length: 10_000 }, (_, i) => ({
    tool: "claude-code",
    userHash: USER_A,
    projectHash: PROJ_X,
    dimension: "steering",
    day: "2026-10-20",
    score: i % 100,
  }));
  assert.throws(() => parseUpload({ hostname: "h", buckets: [], profiles }), (e: unknown) => e instanceof PaxelError);
});

test("DIMENSIONS has exactly the five expected keys", () => {
  assert.deepEqual([...DIMENSIONS].sort(), ["engineering", "execution", "planning", "product-instinct", "steering"]);
});

test("newPublicSlug returns a 14+ char lowercase alnum string", () => {
  for (let i = 0; i < 20; i++) {
    const s = newPublicSlug();
    assert.match(s, /^[a-z0-9]{14,32}$/, `slug ${s} not in shape`);
  }
  // Different slugs each call.
  assert.notEqual(newPublicSlug(), newPublicSlug());
});

test("parseUpload reads a claim block", () => {
  const token = newClaimToken();
  const got = parseUpload({
    hostname: "h",
    buckets: [],
    claim: { userHash: USER_A, claimToken: token },
  });
  assert.ok(got.claim);
  assert.equal(got.claim?.userHash, USER_A);
  assert.equal(got.claim?.claimToken, token);
});

test("parseUpload rejects malformed claim shapes", () => {
  const got = parseUpload({
    hostname: "h",
    buckets: [],
    claim: { userHash: USER_A, claimToken: "too-short" },
  });
  assert.equal(got.claim, null);
  const got2 = parseUpload({
    hostname: "h",
    buckets: [],
    claim: { userHash: "not-hex", claimToken: newClaimToken() },
  });
  assert.equal(got2.claim, null);
});

test("sign+readDevIdentity roundtrips with a real APP_SECRET", () => {
  // Set a secret for this test only.
  const prev = process.env.APP_SECRET;
  process.env.APP_SECRET = Buffer.alloc(32, "k").toString("base64");
  try {
    const id = { mspId: "aaaa", clientId: "bbbb", userHash: USER_A };
    const token = signDevIdentity(id);
    const got = readDevIdentity(token);
    assert.deepEqual(got, id);
    // A forged token fails verification. Flip the FIRST MAC char: that
    // position encodes 6 real bits, so the decoded HMAC bytes always
    // differ. (The last base64url char of a 32-byte digest has 2 padding
    // bits that decode to the same bytes — flipping it is unreliable.)
    const dot = token.indexOf(".");
    const macStart = dot + 1;
    const bad = token.slice(0, macStart) + (token[macStart] === "A" ? "B" : "A") + token.slice(macStart + 1);
    assert.equal(readDevIdentity(bad), null);
  } finally {
    if (prev === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = prev;
  }
});

test("newClaimToken produces 43+ base64url chars", () => {
  for (let i = 0; i < 10; i++) {
    const t = newClaimToken();
    assert.match(t, /^[A-Za-z0-9_-]{43,}$/);
  }
});

test("fmtUsd shows two decimals under $1000 and whole dollars above", () => {
  assert.equal(fmtUsd(50), "$0.50");
  assert.equal(fmtUsd(1_234), "$12.34");
  assert.equal(fmtUsd(10_050), "$100.50");
  assert.equal(fmtUsd(250_000), "$2500");
});
