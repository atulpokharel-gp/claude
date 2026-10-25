import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorized } from "./cron.ts";

test("cron routes need CRON_SECRET to be set and sent", () => {
  delete process.env.CRON_SECRET;
  assert.equal(cronAuthorized("Bearer "), false);
  assert.equal(cronAuthorized(null), false);
  process.env.CRON_SECRET = "s3cret-value";
  assert.equal(cronAuthorized("Bearer s3cret-value"), true);
  assert.equal(cronAuthorized("Bearer s3cret-valuX"), false);
  assert.equal(cronAuthorized("Bearer s3cret"), false);
  assert.equal(cronAuthorized(null), false);
  delete process.env.CRON_SECRET;
});
