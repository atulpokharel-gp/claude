// Classifies a sign-up email as an individual (a free/consumer or disposable
// mailbox) or an organization (its own company domain). The provider list is
// data, not code: it lives in the consumer_email_domains table and is loaded by
// lib/email-domains.ts, then passed in here. These helpers stay pure and
// dependency-free so the client sign-up form can use them with the same set.

export type AccountType = "individual" | "organization";

/** The domain part of an email, lowercased and trimmed. "" when it isn't an email. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/** True when the email's domain is a known free/consumer or disposable mailbox (an individual). */
export function isConsumerEmail(email: string, consumerDomains: ReadonlySet<string>): boolean {
  const d = emailDomain(email);
  return d !== "" && consumerDomains.has(d);
}

/** "individual" for a free/consumer mailbox, "organization" for a company domain. */
export function classifyAccount(email: string, consumerDomains: ReadonlySet<string>): AccountType {
  return isConsumerEmail(email, consumerDomains) ? "individual" : "organization";
}

/** A friendly company-name guess from a company domain, e.g. acme-corp.io -> "Acme Corp". "" for consumer or invalid. */
export function orgNameFromDomain(email: string, consumerDomains: ReadonlySet<string>): string {
  const d = emailDomain(email);
  if (!d || isConsumerEmail(email, consumerDomains)) return "";
  const base = d.split(".")[0].replace(/[-_]+/g, " ").trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
