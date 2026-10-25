// Pure tests for the role gates on the remediation workflow. The queue
// transitions and audit entries are tested in lib/db.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canApply, canApprove, canPropose } from "./remediation.ts";

describe("remediation: role gates", () => {
  test("owner can do everything", () => {
    assert.equal(canPropose("owner"), true);
    assert.equal(canApprove("owner"), true);
    assert.equal(canApply("owner"), true);
  });
  test("member can do everything", () => {
    assert.equal(canPropose("member"), true);
    assert.equal(canApprove("member"), true);
    assert.equal(canApply("member"), true);
  });
  test("technician can propose but not approve or apply", () => {
    assert.equal(canPropose("technician"), true);
    assert.equal(canApprove("technician"), false);
    assert.equal(canApply("technician"), false);
  });
  test("viewer cannot touch remediations", () => {
    assert.equal(canPropose("viewer"), false);
    assert.equal(canApprove("viewer"), false);
    assert.equal(canApply("viewer"), false);
  });
});
