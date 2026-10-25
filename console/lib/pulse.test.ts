import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidBucket } from "./pulse.ts";

test("accepts known buckets", () => {
  for (const b of ["check_run", "share_created", "share_viewed", "grade:A", "grade:B", "grade:C", "grade:D", "grade:F"]) {
    assert.equal(isValidBucket(b), true, b);
  }
});

test("rejects anything else", () => {
  for (const b of ["", "grade:Z", "grade:", "DROP TABLE", "check_run; foo", "grade:A ", "grade:a", "check_run\n", "random"]) {
    assert.equal(isValidBucket(b), false, b);
  }
});
