import { test } from "node:test";
import assert from "node:assert/strict";
import { jobStates } from "./health.ts";

test("jobs are ok, late or failing", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  assert.deepEqual(
    jobStates(
      [
        { job: "cleanup", last_ok_at: ago(60), last_err_at: null },
        { job: "snapshot", last_ok_at: ago(27 * 60), last_err_at: null },
        { job: "backup", last_ok_at: ago(120), last_err_at: ago(10) },
        { job: "mail_send", last_ok_at: ago(30), last_err_at: ago(40) },
        { job: "something_else", last_ok_at: null, last_err_at: ago(1) },
      ],
      now,
    ),
    { cleanup: "ok", snapshot: "late", backup: "failing", mail_send: "late" },
  );
});
