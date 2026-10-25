import { test } from "node:test";
import assert from "node:assert/strict";
import { statsFor, summarize } from "./research-public-configs.ts";

const tok = "ghp_" + "A1b2".repeat(9);

test("a real-looking key counts; a placeholder doesn't", () => {
  const real = statsFor(JSON.stringify({ mcpServers: { gh: { command: "/bin/x", env: { GITHUB_TOKEN: tok } } } }));
  const fake = statsFor(JSON.stringify({ mcpServers: { gh: { command: "/bin/x", env: { GITHUB_TOKEN: "YOUR_TOKEN_HERE" } } } }));
  assert.equal(real?.tokenShaped, true);
  assert.equal(fake?.tokenShaped, false);
  assert.deepEqual(fake?.rules, ["SECRET_IN_CONFIG"]);
});

test("summary has only totals", () => {
  const files = [
    statsFor(JSON.stringify({ mcpServers: { a: { command: "npx", args: ["pkg"] } } }))!,
    statsFor(JSON.stringify({ mcpServers: { b: { command: "uvx", args: ["pkg==1.0.0"] } } }))!,
  ];
  const s = summarize(files);
  assert.equal(s.files, 2);
  assert.equal(s.byRule.UNPINNED_PACKAGE.percent, 50);
  assert.equal(s.anyHighPercent, 0);
  assert.ok(!JSON.stringify(s).includes('"a"'));
});

test("unreadable files are skipped", () => {
  assert.equal(statsFor("not json"), null);
});
