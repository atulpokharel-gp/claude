import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkConfig,
  checkServer,
  ConfigError,
  gradeFor,
  parseConfig,
  parseShare,
  shareQuery,
  type CheckServer,
} from "./mcp-check.ts";

// Built at runtime so no token-shaped string sits in the repo.
const fakeGitHubToken = "ghp_" + "A1b2".repeat(9);

const srv = (p: Partial<CheckServer>): CheckServer => ({ name: "x", command: "", args: [], url: "", env: {}, headers: {}, ...p });
const ids = (s: CheckServer) => checkServer(s).map((f) => f.ruleId).join(",");

// Same cases as scanner/internal/rules/rules_test.go, so the two stay in step.
const cases: [string, Partial<CheckServer>, string][] = [
  ["clean pinned stdio", { command: "npx", args: ["-y", "@scope/pkg@1.2.3"] }, ""],
  ["unpinned npx", { command: "npx", args: ["-y", "@scope/pkg"] }, "UNPINNED_PACKAGE"],
  ["npx latest", { command: "npx", args: ["pkg@latest"] }, "UNPINNED_PACKAGE"],
  ["npx caret range", { command: "npx", args: ["pkg@^1.0.0"] }, "UNPINNED_PACKAGE"],
  ["npx dist-tag", { command: "npx", args: ["mcp-server@beta"] }, "UNPINNED_PACKAGE"],
  ["npx major only", { command: "npx", args: ["mcp-server@1"] }, "UNPINNED_PACKAGE"],
  ["npx x-range", { command: "npx", args: ["mcp-server@1.2.x"] }, "UNPINNED_PACKAGE"],
  ["npx prerelease pinned", { command: "npx", args: ["@scope/pkg@2.0.0-rc.1"] }, ""],
  ["uvx at version", { command: "uvx", args: ["mcp-server-git@2025.1.14"] }, ""],
  ["uvx range", { command: "uvx", args: ["mcp-server-git>=1.0"] }, "UNPINNED_PACKAGE"],
  ["uvx unpinned", { command: "uvx", args: ["mcp-server-git"] }, "UNPINNED_PACKAGE"],
  ["npx -p package", { command: "npx", args: ["-p", "pkg@2.0.0", "pkg-bin"] }, ""],
  ["windows npx.cmd", { command: "C:\\nodejs\\npx.cmd", args: ["pkg"] }, "UNPINNED_PACKAGE"],
  ["uvx pinned", { command: "uvx", args: ["mcp-server-time==0.6.2"] }, ""],
  ["uvx pinned helper, unpinned server", { command: "uvx", args: ["--with", "helper==1.0.0", "mcp-server-time"] }, "UNPINNED_PACKAGE"],
  ["uvx --with= form", { command: "uvx", args: ["--with=helper==1.0.0", "mcp-server-time"] }, "UNPINNED_PACKAGE"],
  ["uvx python flag", { command: "uvx", args: ["-p", "3.12", "mcp-server-time==0.6.2"] }, ""],
  ["uvx --from pinned", { command: "uvx", args: ["--from", "mcp-server-time==0.6.2", "mcp-server-time"] }, ""],
  ["npx registry flag", { command: "npx", args: ["--registry", "https://r.example.com", "pkg"] }, "UNPINNED_PACKAGE"],
  ["pnpm dlx unpinned", { command: "pnpm", args: ["dlx", "pkg"] }, "UNPINNED_PACKAGE"],
  ["secret by env name", { command: "/bin/x", env: { API_KEY: "abc123" } }, "SECRET_IN_CONFIG"],
  ["env reference is fine", { command: "/bin/x", env: { API_KEY: "${env:API_KEY}" } }, ""],
  ["non-secret env is fine", { command: "/bin/x", env: { LOG_LEVEL: "debug" } }, ""],
  ["secret by value shape", { command: "/bin/x", env: { GH: fakeGitHubToken } }, "SECRET_IN_CONFIG"],
  ["secret in args", { command: "/bin/x", args: ["--token", fakeGitHubToken] }, "SECRET_IN_CONFIG"],
  ["literal auth header", { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz" } }, "SECRET_IN_CONFIG,REMOTE_SERVER"],
  ["key in URL query", { url: "https://api.example.com/mcp?api_key=abc" }, "SECRET_IN_CONFIG,REMOTE_SERVER"],
  ["password flag", { command: "/bin/db-mcp", args: ["--password", "example-private-password"] }, "SECRET_IN_CONFIG"],
  ["api key flag with equals", { command: "/bin/x", args: ["--api-key=abc123"] }, "SECRET_IN_CONFIG"],
  ["password flag from env var", { command: "/bin/x", args: ["--password", "${DB_PASSWORD}"] }, ""],
  ["connection string arg", { command: "/bin/x", args: ["postgresql://user:example-private-password@db.example.com/app"] }, "SECRET_IN_CONFIG"],
  ["connection string without password", { command: "/bin/x", args: ["postgresql://user@db.example.com/app"] }, ""],
  ["connection string in env", { command: "/bin/x", env: { DATABASE_URL: "postgres://app:pw123@db.example.com/app" } }, "SECRET_IN_CONFIG"],
  ["plain http remote", { url: "http://wiki.example.com/mcp" }, "INSECURE_TRANSPORT,REMOTE_SERVER"],
  ["plain http localhost", { url: "http://127.0.0.1:3000/mcp" }, ""],
  ["filesystem root", { command: "npx", args: ["@modelcontextprotocol/server-filesystem@1.0.0", "/"] }, "BROAD_FILESYSTEM"],
  ["filesystem home", { command: "npx", args: ["@modelcontextprotocol/server-filesystem@1.0.0", "/home/demo/"] }, "BROAD_FILESYSTEM"],
  ["filesystem project", { command: "npx", args: ["@modelcontextprotocol/server-filesystem@1.0.0", "/home/demo/app"] }, ""],
  ["shell server", { command: "npx", args: ["@wonderwhy-er/desktop-commander@0.2.3"] }, "SHELL_ACCESS"],
  ["shell launcher", { command: "bash", args: ["-c", "/opt/tool/run"] }, "SHELL_LAUNCHER"],
  ["docker privileged", { command: "docker", args: ["run", "--privileged", "img:1"] }, "RISKY_CONTAINER"],
  ["docker sock", { command: "docker", args: ["run", "-v", "/var/run/docker.sock:/var/run/docker.sock", "img:1"] }, "RISKY_CONTAINER"],
  ["docker plain", { command: "docker", args: ["run", "-i", "--rm", "img:1"] }, ""],
  ["token in URL path", { url: "https://mcp.example.com/" + fakeGitHubToken + "/sse" }, "SECRET_IN_CONFIG,REMOTE_SERVER"],
  ["windows home folder", { command: "npx", args: ["@modelcontextprotocol/server-filesystem@1.0.0", "C:\\Users\\sam"] }, "BROAD_FILESYSTEM"],
];

for (const [name, s, want] of cases) {
  test(`rule: ${name}`, () => assert.equal(ids(srv(s)), want));
}

test("finding text never includes the secret value", () => {
  for (const f of checkServer(srv({ command: "/bin/x", env: { TOKEN: "my-real-secret-value" } }))) {
    assert.ok(!(f.title + f.detail + f.fix).includes("my-real-secret-value"));
  }
});

test("reads every config layout", () => {
  const entry = { command: "npx", args: ["pkg"] };
  assert.equal(parseConfig(JSON.stringify({ mcpServers: { a: entry } })).servers.length, 1);
  assert.equal(parseConfig(JSON.stringify({ servers: { a: entry } })).servers.length, 1);
  assert.equal(parseConfig(JSON.stringify({ mcp: { servers: { a: entry } } })).servers.length, 1);
  assert.equal(parseConfig(JSON.stringify({ a: entry, b: { url: "https://x.example.com" } })).servers.length, 2);
  const cc = parseConfig(JSON.stringify({ mcpServers: { a: entry }, projects: { "/p": { mcpServers: { b: entry } } } }));
  assert.deepEqual(cc.servers.map((s) => [s.name, s.scope]), [["a", undefined], ["b", "/p"]]);
});

test("accepts comments and trailing commas", () => {
  const text = `{
    // VS Code style
    "servers": { "a": { "command": "npx", "args": ["pkg@1.0.0",], }, /* done */ },
  }`;
  assert.equal(parseConfig(text).servers.length, 1);
});

test("explains bad input", () => {
  assert.throws(() => parseConfig(""), ConfigError);
  assert.throws(() => parseConfig("{nope"), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ theme: "dark" })), ConfigError);
});

test("checks the real server behind zinloop's launcher", () => {
  const r = parseConfig(JSON.stringify({ mcpServers: { a: { command: "zinloop", args: ["exec", "--secret", "T=ref", "--", "npx", "pkg"] } } }));
  assert.equal(r.servers[0].command, "npx");
  assert.deepEqual(r.servers[0].args, ["pkg"]);
});

test("grades", () => {
  assert.equal(gradeFor({ high: 0, medium: 0, low: 0 }).grade, "A");
  assert.equal(gradeFor({ high: 0, medium: 0, low: 3 }).grade, "A");
  assert.equal(gradeFor({ high: 0, medium: 1, low: 0 }).grade, "A");
  assert.equal(gradeFor({ high: 0, medium: 2, low: 0 }).grade, "B");
  assert.equal(gradeFor({ high: 1, medium: 0, low: 0 }).grade, "C");
  assert.equal(gradeFor({ high: 2, medium: 0, low: 0 }).grade, "D");
  assert.equal(gradeFor({ high: 3, medium: 0, low: 0 }).grade, "F");
});

test("share link carries only grade and counts, and round-trips", () => {
  const r = checkConfig(JSON.stringify({ mcpServers: { secretname: { command: "/bin/x", env: { API_KEY: "hunter2" } } } }));
  const q = shareQuery(r);
  assert.ok(!q.includes("secretname") && !q.includes("hunter2"));
  const back = parseShare(Object.fromEntries(new URLSearchParams(q)));
  assert.deepEqual(back, { grade: "C", high: 1, medium: 0, low: 0, servers: 1 });
});

test("rejects tampered share links", () => {
  assert.equal(parseShare({ g: "Z", h: "0", m: "0", l: "0", n: "1" }), null);
  assert.equal(parseShare({ g: "A", h: "-1", m: "0", l: "0", n: "1" }), null);
  assert.equal(parseShare({ g: "A", h: "1000", m: "0", l: "0", n: "1" }), null);
  assert.equal(parseShare({ g: "A", h: ["1", "2"], m: "0", l: "0", n: "1" }), null);
  assert.equal(parseShare({ g: "A<script>", h: "0", m: "0", l: "0", n: "1" }), null);
});
