import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAccount, emailDomain, isConsumerEmail, orgNameFromDomain } from "./email-kind.ts";

// Stand-in for the consumer_email_domains table (migration 024 seeds the real list).
const CONSUMER = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.co.uk", "yahoo.com", "icloud.com", "proton.me", "qq.com", "gmx.de", "mailinator.com", "yopmail.com"]);

test("emailDomain pulls the lowercased domain", () => {
  assert.equal(emailDomain("Jane.Doe@Gmail.com"), "gmail.com");
  assert.equal(emailDomain("a@b.co.uk"), "b.co.uk");
  assert.equal(emailDomain("nope"), "");
  assert.equal(emailDomain("trailing@"), "");
  assert.equal(emailDomain("@leading.com"), ""); // no local part is not a usable address
});

test("domains in the set are individuals", () => {
  for (const e of ["a@gmail.com", "a@GOOGLEMAIL.com", "b@outlook.com", "b@hotmail.co.uk", "c@yahoo.com", "d@icloud.com", "e@proton.me", "f@qq.com", "g@gmx.de", "x@mailinator.com", "x@yopmail.com"]) {
    assert.equal(isConsumerEmail(e, CONSUMER), true, e);
    assert.equal(classifyAccount(e, CONSUMER), "individual", e);
  }
});

test("company domains are organizations", () => {
  for (const e of ["owner@acme.com", "it@harbor-managed.io", "admin@smart365guide.com", "ceo@contoso.co"]) {
    assert.equal(isConsumerEmail(e, CONSUMER), false, e);
    assert.equal(classifyAccount(e, CONSUMER), "organization", e);
  }
});

test("an empty set (no DB) treats everything as organization", () => {
  const empty = new Set<string>();
  assert.equal(classifyAccount("a@gmail.com", empty), "organization");
  assert.equal(classifyAccount("owner@acme.com", empty), "organization");
});

test("invalid input never throws and is not individual", () => {
  assert.equal(classifyAccount("", CONSUMER), "organization");
  assert.equal(classifyAccount("no-at-sign", CONSUMER), "organization");
});

test("orgNameFromDomain titles the apex label, blank for consumer", () => {
  assert.equal(orgNameFromDomain("it@acme-corp.io", CONSUMER), "Acme Corp");
  assert.equal(orgNameFromDomain("a@harbor.managed.co.uk", CONSUMER), "Harbor");
  assert.equal(orgNameFromDomain("a@gmail.com", CONSUMER), "");
  assert.equal(orgNameFromDomain("bad", CONSUMER), "");
});
