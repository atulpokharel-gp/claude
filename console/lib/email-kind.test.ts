import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAccount, emailDomain, isConsumerEmail, orgNameFromDomain } from "./email-kind.ts";

test("emailDomain pulls the lowercased domain", () => {
  assert.equal(emailDomain("Jane.Doe@Gmail.com"), "gmail.com");
  assert.equal(emailDomain("a@b.co.uk"), "b.co.uk");
  assert.equal(emailDomain("nope"), "");
  assert.equal(emailDomain("trailing@"), "");
  assert.equal(emailDomain("@leading.com"), ""); // no local part is not a usable address
});

test("consumer mailboxes are individuals", () => {
  for (const e of ["a@gmail.com", "a@GOOGLEMAIL.com", "b@outlook.com", "b@hotmail.co.uk", "c@yahoo.com", "d@icloud.com", "e@proton.me", "f@qq.com", "g@gmx.de"]) {
    assert.equal(isConsumerEmail(e), true, e);
    assert.equal(classifyAccount(e), "individual", e);
  }
});

test("disposable mailboxes are individuals", () => {
  assert.equal(classifyAccount("x@mailinator.com"), "individual");
  assert.equal(classifyAccount("x@yopmail.com"), "individual");
});

test("company domains are organizations", () => {
  for (const e of ["owner@acme.com", "it@harbor-managed.io", "admin@smart365guide.com", "ceo@contoso.co"]) {
    assert.equal(isConsumerEmail(e), false, e);
    assert.equal(classifyAccount(e), "organization", e);
  }
});

test("invalid input never throws and is not individual", () => {
  assert.equal(classifyAccount(""), "organization");
  assert.equal(classifyAccount("no-at-sign"), "organization");
});

test("orgNameFromDomain titles the apex label, blank for consumer", () => {
  assert.equal(orgNameFromDomain("it@acme-corp.io"), "Acme Corp");
  assert.equal(orgNameFromDomain("a@harbor.managed.co.uk"), "Harbor");
  assert.equal(orgNameFromDomain("a@gmail.com"), "");
  assert.equal(orgNameFromDomain("bad"), "");
});
