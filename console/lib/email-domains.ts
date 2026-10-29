// Loads the free/consumer and disposable mailbox domains from the database
// (consumer_email_domains, seeded in migration 024) and caches them briefly.
// Keeping the list in the DB, not in code, lets it be extended without a deploy.
// With no database configured the set is empty, so every address is treated as
// an organization.

import { getPool, hasDatabase } from "./db.ts";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; set: Set<string> } | null = null;

/** The set of mailbox domains that mark a sign-up as an individual. Cached for 5 minutes. */
export async function consumerDomains(): Promise<Set<string>> {
  if (!hasDatabase()) return new Set();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;
  const rows = (await getPool().query("select domain from consumer_email_domains")).rows as { domain: string }[];
  const set = new Set(rows.map((r) => r.domain));
  cache = { at: Date.now(), set };
  return set;
}

/** Drops the cache so the next load re-reads the table (after the list is edited). */
export function clearConsumerDomainsCache(): void {
  cache = null;
}
