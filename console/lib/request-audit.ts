// Audit helpers for server actions and route handlers: they know the signed-in
// user and the request's IP address.

import { headers } from "next/headers";
import { audit, type AuditAction } from "./audit.ts";
import type { Session } from "./auth.ts";
import { clientIp } from "./ratelimit.ts";

export async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: clientIp(h.get("x-forwarded-for")), userAgent: h.get("user-agent") };
}

/** Records an action by the signed-in user. Never throws: a failed log entry must not undo the action. */
export async function auditAs(s: Session, action: AuditAction, target = "", detail: Record<string, unknown> = {}): Promise<void> {
  try {
    const { ip } = await requestInfo();
    await audit(s.mspId, { userId: s.userId, email: s.email, ip }, action, target, detail);
  } catch (err) {
    console.error(`audit ${action} failed: ${(err as Error).message}`);
  }
}
