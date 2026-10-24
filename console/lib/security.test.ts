import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { base32Decode, base32Encode, checkCode, codeAt, otpauthUri } from "./totp.ts";
import { decrypt, encrypt, sign, verifySigned } from "./crypto.ts";
import { clientIp } from "./ratelimit.ts";
import { downloadUrl } from "./downloads.ts";

process.env.APP_SECRET = randomBytes(32).toString("base64");

// RFC 6238 test secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("authenticator codes match the RFC 6238 test vectors", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(codeAt(RFC_SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(codeAt(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(codeAt(RFC_SECRET, Math.floor(2000000000 / 30)), "279037");
  assert.deepEqual(base32Decode(RFC_SECRET), Buffer.from("12345678901234567890"));
});

test("a code works once, within one step of the clock", () => {
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const code = codeAt(RFC_SECRET, step);
  assert.equal(checkCode(RFC_SECRET, code, 0, now), step);
  assert.equal(checkCode(RFC_SECRET, code.slice(0, 3) + " " + code.slice(3), 0, now), step);
  assert.equal(checkCode(RFC_SECRET, code, step, now), null, "replayed code");
  assert.equal(checkCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), 0, now), step - 1);
  assert.equal(checkCode(RFC_SECRET, codeAt(RFC_SECRET, step - 2), 0, now), null, "too old");
  assert.equal(checkCode(RFC_SECRET, "12345", 0, now), null);
  assert.match(otpauthUri(RFC_SECRET, "sam@harbor.example"), /^otpauth:\/\/totp\/Zinloop%20Security%3Asam%40harbor\.example\?secret=GEZD/);
});

test("encrypted values round-trip and detect tampering", () => {
  const box = encrypt("JBSWY3DPEHPK3PXP");
  assert.notEqual(box, "JBSWY3DPEHPK3PXP");
  assert.equal(decrypt(box), "JBSWY3DPEHPK3PXP");
  const parts = box.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});

test("signed values expire and are tied to their purpose", () => {
  const t = sign("mfa", { u: "1" }, 60, 1000);
  assert.deepEqual(verifySigned("mfa", t, 2000), { u: "1" });
  assert.equal(verifySigned("other", t, 2000), null);
  assert.equal(verifySigned("mfa", t, 1000 + 61_000), null);
  assert.equal(verifySigned("mfa", t.slice(0, -2) + "xx", 2000), null);
  assert.equal(verifySigned("mfa", undefined), null);
});

test("client addresses come from the proxy only when it's trusted", () => {
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp("1.2.3.4"), null);
  process.env.TRUST_PROXY = "1";
  assert.equal(clientIp("6.6.6.6, 1.2.3.4"), "1.2.3.4");
  assert.equal(clientIp(null), null);
  delete process.env.TRUST_PROXY;
});

test("downloads only hand out known scanner files", () => {
  assert.equal(downloadUrl("zinloop-windows-amd64.exe", "https://example.com/dl/"), "https://example.com/dl/zinloop-windows-amd64.exe");
  assert.equal(downloadUrl("../etc/passwd"), null);
  assert.equal(downloadUrl("zinloop-plan9-amd64"), null);
});
