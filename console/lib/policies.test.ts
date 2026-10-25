// Pure tests for the policy input cleaner and helpers. Database behaviour
// (setPolicy, getPolicy with RLS) runs in lib/db.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY, publisherAllowed, publisherBlocked, type ClientPolicy } from "./policies.ts";

describe("policies: defaults", () => {
  test("auto-apply is on and no publishers are listed", () => {
    assert.equal(DEFAULT_POLICY.autoApplyApproved, true);
    assert.deepEqual(DEFAULT_POLICY.allowedPublishers, []);
    assert.deepEqual(DEFAULT_POLICY.blockedPublishers, []);
    assert.equal(DEFAULT_POLICY.ticketThreshold, "high");
  });
});

describe("policies: publisher checks", () => {
  const base: ClientPolicy = {
    clientId: "x",
    ticketThreshold: "high",
    autoApplyApproved: true,
    allowedPublishers: ["anthropic", "openai"],
    blockedPublishers: ["evil.ai"],
    reportRecipients: [],
    psaIntegrationId: null,
    psaCompanyId: "",
    rmmIntegrationId: null,
    rmmOrganizationId: "",
    updatedAt: null,
  };
  test("blocklist match is case-insensitive", () => {
    assert.equal(publisherBlocked(base, "Evil.AI"), true);
    assert.equal(publisherBlocked(base, "evil.ai"), true);
    assert.equal(publisherBlocked(base, "other"), false);
  });
  test("allowlist match is case-insensitive", () => {
    assert.equal(publisherAllowed(base, "Anthropic"), true);
    assert.equal(publisherAllowed(base, "Not Listed"), false);
  });
  test("empty publisher never matches", () => {
    assert.equal(publisherBlocked(base, ""), false);
    assert.equal(publisherAllowed(base, "   "), false);
  });
});
