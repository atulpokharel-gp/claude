// Classifies a sign-up email as an individual (a free/consumer or disposable
// mailbox) or an organization (its own company domain). Used to set
// msps.account_type at sign-up (lib/accounts.ts) and to adapt the sign-up form.
// Pure and dependency-free, so the client form can import it too.

export type AccountType = "individual" | "organization";

// Free/consumer mailbox providers. Lowercase, apex domains. An address on one of
// these is a person, not a company domain, so it signs up as an individual.
const CONSUMER_DOMAINS = new Set<string>([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "outlook.co.uk", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "live.com", "live.co.uk", "msn.com", "windowslive.com",
  // Yahoo / AOL
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "yahoo.fr", "yahoo.de", "ymail.com", "rocketmail.com", "aol.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Proton
  "proton.me", "protonmail.com", "pm.me",
  // Other common consumer providers worldwide
  "gmx.com", "gmx.net", "gmx.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
  "fastmail.com", "hey.com", "tutanota.com", "tuta.io", "tutamail.com", "hushmail.com",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com", "naver.com", "daum.net", "hanmail.net",
  "web.de", "t-online.de", "freenet.de", "orange.fr", "free.fr", "laposte.net", "wanadoo.fr",
  "libero.it", "virgilio.it", "comcast.net", "verizon.net", "sbcglobal.net", "att.net",
  "cox.net", "bellsouth.net", "btinternet.com", "rediffmail.com", "mail.ru", "inbox.com",
]);

// A few well-known disposable/temporary providers. Treated as individual.
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com", "throwawaymail.com",
  "tempmail.com", "temp-mail.org", "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com",
]);

/** The domain part of an email, lowercased and trimmed. "" when it isn't an email. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/** True when the email is a free/consumer or disposable mailbox (an individual). */
export function isConsumerEmail(email: string): boolean {
  const d = emailDomain(email);
  return d !== "" && (CONSUMER_DOMAINS.has(d) || DISPOSABLE_DOMAINS.has(d));
}

/** "individual" for a free/consumer mailbox, "organization" for a company domain. */
export function classifyAccount(email: string): AccountType {
  return isConsumerEmail(email) ? "individual" : "organization";
}

/** A friendly company-name guess from a company domain, e.g. acme-corp.io -> "Acme Corp". "" for consumer or invalid. */
export function orgNameFromDomain(email: string): string {
  const d = emailDomain(email);
  if (!d || isConsumerEmail(email)) return "";
  const base = d.split(".")[0].replace(/[-_]+/g, " ").trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
