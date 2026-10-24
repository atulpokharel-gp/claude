// Microsoft 365 discovery: which AI apps were granted access to a client's
// mail, files and chats, and revoking that access.
//
// Zinloop is one multi-tenant Microsoft Entra app (M365_CLIENT_ID and
// M365_CLIENT_SECRET). A client's admin grants it consent once; after that the
// console reads the tenant's consent grants with app-only tokens. Application
// permissions it needs: Application.Read.All, DelegatedPermissionGrant.ReadWrite.All,
// AppRoleAssignment.ReadWrite.All, and User.Read.All (names of the people who
// approved an app; optional). See docs/m365.md.

import type { Agent, Finding, PersonRef } from "./types.ts";

export const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";
const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
const MICROSOFT_TENANT = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
export const TENANT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type Fetch = typeof fetch;

export function hasM365(): boolean {
  return Boolean(process.env.M365_CLIENT_ID && process.env.M365_CLIENT_SECRET);
}

/** Where to send a client's admin to grant consent. */
export function consentUrl(state: string, redirectUri: string): string {
  const q = new URLSearchParams({ client_id: process.env.M365_CLIENT_ID ?? "", redirect_uri: redirectUri, state });
  return `${LOGIN}/organizations/adminconsent?${q}`;
}

// Directory roles that can approve app permissions tenant-wide: Global
// Administrator and Privileged Role Administrator.
const CONSENT_ROLES = new Set(["62e90394-69f5-4237-9190-012177145e10", "e8611ab8-c189-46e8-94e1-60213ab1f814"]);

/**
 * Step two of connecting: the admin signs in to the tenant Microsoft named in
 * the consent answer. That answer arrives as plain URL parameters anyone can
 * type, so this sign-in is what proves the person controls the tenant.
 */
export function verifyUrl(tenantId: string, state: string, redirectUri: string): string {
  if (!TENANT_ID.test(tenantId)) throw new GraphError("Not a Microsoft tenant ID.", 400);
  const q = new URLSearchParams({
    client_id: process.env.M365_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid",
    state,
  });
  return `${LOGIN}/${tenantId}/oauth2/v2.0/authorize?${q}`;
}

/**
 * Swaps the sign-in code for an ID token and checks it: issued to us, for this
 * tenant, to an admin who can approve app permissions. The token comes straight
 * from Microsoft over HTTPS, so its contents can be trusted without checking
 * the signature (OpenID Connect Core 3.1.3.7).
 */
export async function verifyAdmin(tenantId: string, code: string, redirectUri: string, f: Fetch = fetch): Promise<void> {
  if (!TENANT_ID.test(tenantId)) throw new GraphError("Not a Microsoft tenant ID.", 400);
  const res = await f(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.M365_CLIENT_ID ?? "",
      client_secret: process.env.M365_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: "openid",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!res.ok || !body.id_token) {
    throw new GraphError(`Microsoft refused the sign-in: ${(body.error_description ?? res.statusText).split("\n")[0]}`, res.status || 400);
  }
  let claims: { aud?: string; tid?: string; wids?: string[] };
  try {
    claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw new GraphError("Microsoft sent an unreadable sign-in token.", 502);
  }
  if (claims.aud !== process.env.M365_CLIENT_ID || claims.tid?.toLowerCase() !== tenantId.toLowerCase()) {
    throw new GraphError("You signed in to a different Microsoft 365 tenant than the one you approved.", 403);
  }
  if (!claims.wids?.some((r) => CONSENT_ROLES.has(r))) {
    throw new GraphError("Sign in as a Global Administrator or Privileged Role Administrator of the client's tenant.", 403);
  }
}

// Names that mark an app as an AI tool. Matched against the app's display
// name and publisher. Microsoft's own apps are skipped (they're covered by
// Microsoft's admin tools).
const AI_NAMES =
  /\b(openai|chatgpt|gpt|anthropic|claude|perplexity|gemini|copilot|otter|fireflies|read\.?ai|fathom|tl;?dv|jasper|copy\.ai|writer\.com|glean|notion|grammarly|superhuman|motion|reclaim|lindy|zapier|make\.com|n8n|cursor|mistral|cohere|poe|character\.ai|tome|gamma|beautiful\.ai|otter\.ai|sembly|krisp|avoma|gong|mem\.ai|shortwave|spark mail|ai)\b/i;

// What each permission lets an app reach, in plain words, and how sensitive it is.
const SCOPES: Record<string, { reach: string; sensitive: boolean }> = {
  "Mail.Read": { reach: "Read email", sensitive: true },
  "Mail.ReadBasic": { reach: "Read email headers", sensitive: false },
  "Mail.ReadWrite": { reach: "Read and change email", sensitive: true },
  "Mail.Send": { reach: "Send email as the user", sensitive: true },
  "Mail.Read.All": { reach: "Read every mailbox", sensitive: true },
  "Mail.ReadWrite.All": { reach: "Read and change every mailbox", sensitive: true },
  "Files.Read": { reach: "Read the user's files", sensitive: true },
  "Files.ReadWrite": { reach: "Read and change the user's files", sensitive: true },
  "Files.Read.All": { reach: "Read all files the user can open", sensitive: true },
  "Files.ReadWrite.All": { reach: "Read and change all files", sensitive: true },
  "Sites.Read.All": { reach: "Read all SharePoint sites", sensitive: true },
  "Sites.ReadWrite.All": { reach: "Read and change all SharePoint sites", sensitive: true },
  "Chat.Read": { reach: "Read Teams chats", sensitive: true },
  "Chat.ReadWrite": { reach: "Read and send Teams chats", sensitive: true },
  "Chat.Read.All": { reach: "Read every Teams chat", sensitive: true },
  "ChannelMessage.Read.All": { reach: "Read all Teams channel messages", sensitive: true },
  "OnlineMeetingTranscript.Read.All": { reach: "Read meeting transcripts", sensitive: true },
  "Calendars.Read": { reach: "Read calendar", sensitive: false },
  "Calendars.ReadWrite": { reach: "Read and change calendar", sensitive: false },
  "Contacts.Read": { reach: "Read contacts", sensitive: false },
  "User.Read.All": { reach: "Read every user's profile", sensitive: false },
  "Directory.Read.All": { reach: "Read the whole directory", sensitive: true },
  "offline_access": { reach: "Keep access while the user is away", sensitive: false },
};
const IGNORED = new Set(["openid", "profile", "email", "User.Read"]);

/** One AI app found in a tenant, as stored in m365_tenants.apps. */
export interface M365App {
  servicePrincipalId: string;
  appId: string;
  name: string;
  publisher: string;
  verified: boolean;
  /** Delegated grants: who consented and to what. */
  grants: { id: string; allUsers: boolean; principalId: string | null; scopes: string[]; principalName?: string; principalEmail?: string }[];
  /** App-only permissions (work with nobody signed in). */
  appRoles: { id: string; resourceId: string; value: string }[];
}

interface GraphSp {
  id: string;
  appId: string;
  displayName: string;
  publisherName?: string | null;
  appOwnerOrganizationId?: string | null;
  verifiedPublisher?: { displayName?: string | null } | null;
  appRoles?: { id: string; value: string }[];
}

export class GraphError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function appToken(tenantId: string, f: Fetch = fetch): Promise<string> {
  if (!TENANT_ID.test(tenantId)) throw new GraphError("Not a Microsoft tenant ID.", 400);
  const res = await f(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.M365_CLIENT_ID ?? "",
      client_secret: process.env.M365_CLIENT_SECRET ?? "",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new GraphError(`Microsoft refused the sign-in for this tenant: ${(body.error_description ?? res.statusText).split("\n")[0]}`, res.status);
  }
  return body.access_token;
}

async function getAll<T>(token: string, url: string, f: Fetch): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 50; page++) {
    if (!next.startsWith(GRAPH)) throw new GraphError("Unexpected paging link from Microsoft Graph.", 502);
    const res = await f(next, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { value?: T[]; "@odata.nextLink"?: string; error?: { message?: string } };
    if (!res.ok) throw new GraphError(`Microsoft Graph error: ${body.error?.message ?? res.statusText}`, res.status);
    out.push(...(body.value ?? []));
    next = body["@odata.nextLink"];
  }
  return out;
}

/**
 * Looks up the names of the people who approved apps. Optional: without the
 * User.Read.All permission Microsoft refuses, and apps are listed without names.
 */
async function userNames(token: string, ids: string[], f: Fetch): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>();
  // Graph allows up to 15 values in one "in" filter.
  for (let i = 0; i < ids.length && i < 1500; i += 15) {
    const list = ids.slice(i, i + 15).filter((id) => /^[0-9a-zA-Z-]{1,64}$/.test(id)).map((id) => `'${id}'`).join(",");
    if (!list) continue;
    let res: Response;
    try {
      res = await f(`${GRAPH}/users?$filter=${encodeURIComponent(`id in (${list})`)}&$select=id,displayName,userPrincipalName`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      // Names are optional; a network error here mustn't stop the apps being saved.
      return out;
    }
    if (!res.ok) return out;
    const body = (await res.json().catch(() => ({}))) as { value?: { id: string; displayName?: string | null; userPrincipalName?: string | null }[] };
    for (const u of body.value ?? []) {
      out.set(u.id, { name: u.displayName || u.userPrincipalName || "", email: u.userPrincipalName ?? "" });
    }
  }
  return out;
}

export function isAiApp(sp: Pick<GraphSp, "displayName" | "publisherName" | "appOwnerOrganizationId">): boolean {
  if (sp.appOwnerOrganizationId === MICROSOFT_TENANT) return false;
  return AI_NAMES.test(sp.displayName) || AI_NAMES.test(sp.publisherName ?? "");
}

/** Lists the AI apps in a tenant with what they were granted. */
export async function discover(tenantId: string, f: Fetch = fetch): Promise<M365App[]> {
  const token = await appToken(tenantId, f);
  const sps = await getAll<GraphSp>(
    token,
    `${GRAPH}/servicePrincipals?$select=id,appId,displayName,publisherName,appOwnerOrganizationId,verifiedPublisher&$top=999`,
    f,
  );
  const grants = await getAll<{ id: string; clientId: string; consentType: string; principalId: string | null; scope: string }>(
    token,
    `${GRAPH}/oauth2PermissionGrants?$top=999`,
    f,
  );
  const graphSp = (await getAll<GraphSp>(token, `${GRAPH}/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`, f))[0];
  const assignments = graphSp
    ? await getAll<{ id: string; principalId: string; appRoleId: string; resourceId: string }>(
        token,
        `${GRAPH}/servicePrincipals/${graphSp.id}/appRoleAssignedTo?$top=999`,
        f,
      )
    : [];
  const roleNames = new Map((graphSp?.appRoles ?? []).map((r) => [r.id, r.value]));
  const aiIds = new Set(sps.filter(isAiApp).map((sp) => sp.id));
  const principalIds = [...new Set(grants.filter((x) => aiIds.has(x.clientId) && x.principalId).map((x) => x.principalId as string))];
  const names = principalIds.length > 0 ? await userNames(token, principalIds, f) : new Map();

  const apps: M365App[] = [];
  for (const sp of sps) {
    if (!isAiApp(sp)) continue;
    const g = grants
      .filter((x) => x.clientId === sp.id)
      .map((x) => ({
        id: x.id,
        allUsers: x.consentType === "AllPrincipals",
        principalId: x.principalId,
        scopes: x.scope.split(" ").filter((s) => s && !IGNORED.has(s)),
        ...(x.principalId && names.has(x.principalId)
          ? { principalName: names.get(x.principalId)!.name, principalEmail: names.get(x.principalId)!.email }
          : {}),
      }));
    const roles = assignments
      .filter((x) => x.principalId === sp.id)
      .map((x) => ({ id: x.id, resourceId: x.resourceId, value: roleNames.get(x.appRoleId) ?? x.appRoleId }));
    if (g.length === 0 && roles.length === 0) continue;
    apps.push({
      servicePrincipalId: sp.id,
      appId: sp.appId,
      name: sp.displayName,
      publisher: sp.verifiedPublisher?.displayName || sp.publisherName || "",
      verified: Boolean(sp.verifiedPublisher?.displayName),
      grants: g,
      appRoles: roles,
    });
  }
  return apps;
}

/** Removes every grant an app has in the tenant. */
export async function revokeApp(tenantId: string, app: M365App, f: Fetch = fetch): Promise<void> {
  const token = await appToken(tenantId, f);
  const calls = [
    ...app.grants.map((g) => `${GRAPH}/oauth2PermissionGrants/${encodeURIComponent(g.id)}`),
    ...app.appRoles.map((r) => `${GRAPH}/servicePrincipals/${encodeURIComponent(r.resourceId)}/appRoleAssignedTo/${encodeURIComponent(r.id)}`),
  ];
  for (const url of calls) {
    const res = await f(url, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GraphError(`Microsoft Graph refused the change: ${body.error?.message ?? res.statusText}`, res.status);
    }
  }
}

const finding = (ruleId: string, severity: Finding["severity"], title: string, detail: string, fix: string): Finding => ({
  ruleId,
  severity,
  title,
  detail,
  fix,
});

/** Turns a stored app into the console's agent shape, with findings. */
export function appToAgent(app: M365App, clientName: string, seenAt: string): Agent {
  const delegated = new Set(app.grants.flatMap((g) => g.scopes));
  const appOnly = new Set(app.appRoles.map((r) => r.value));
  const reach = [...new Set([...appOnly, ...delegated].map((s) => SCOPES[s]?.reach ?? s))];
  const sensitive = (s: string) => SCOPES[s]?.sensitive ?? false;
  const orgWide = app.grants.some((g) => g.allUsers);
  // One person can hold several grants for one app (e.g. to different APIs); count people, not grants.
  const users = new Set(app.grants.filter((g) => !g.allUsers).map((g) => g.principalId ?? g.id)).size;
  const findings: Finding[] = [];

  const appOnlySensitive = [...appOnly].filter(sensitive);
  if (appOnlySensitive.length > 0) {
    findings.push(
      finding(
        "M365_APP_ONLY_ACCESS",
        "high",
        "Can read company data with nobody signed in",
        `${app.name} holds app-only permissions (${appOnlySensitive.join(", ")}). It can reach this data for every user at any time, without anyone using it.`,
        "Revoke this access unless the business relies on it, then re-approve only the permissions it needs.",
      ),
    );
  }
  const delegatedSensitive = [...delegated].filter(sensitive);
  if (orgWide && delegatedSensitive.length > 0) {
    findings.push(
      finding(
        "M365_ORG_WIDE_GRANT",
        "high",
        "Approved for everyone in the company",
        `An admin approved ${app.name} for all users with ${delegatedSensitive.join(", ")}. Anyone who signs in to it gives it that access.`,
        "Check who approved it and why. Revoke it, or limit it to the people who need it.",
      ),
    );
  } else if (delegatedSensitive.length > 0) {
    findings.push(
      finding(
        "M365_USER_GRANT",
        "medium",
        `${users} ${users === 1 ? "person" : "people"} gave it access to their mail or files`,
        `${app.name} was approved by individual users with ${delegatedSensitive.join(", ")}. Staff can do this without IT.`,
        "Confirm the tool is approved. Consider turning off user consent for unverified apps in Microsoft Entra.",
      ),
    );
  }
  if (!app.verified && findings.length > 0) {
    findings.push(
      finding(
        "M365_UNVERIFIED_PUBLISHER",
        "low",
        "Publisher not verified by Microsoft",
        `${app.name}'s publisher hasn't completed Microsoft's verification, so its identity isn't confirmed.`,
        "Prefer tools from verified publishers for access to mail and files.",
      ),
    );
  }
  if (findings.length === 0) {
    findings.push(
      finding("M365_ACCESS", "low", "Has access to some Microsoft 365 data", `${app.name} can reach: ${reach.join(", ") || "basic profile"}.`, "No action needed if the tool is approved."),
    );
  }

  return {
    id: `m365-${app.servicePrincipalId}`,
    name: app.name,
    kind: "oauth-app",
    source: "Microsoft 365",
    location: `${clientName} Microsoft 365 · ${orgWide ? "approved for all users" : `${users} ${users === 1 ? "user" : "users"}`}`,
    app: app.publisher || "Microsoft 365 app",
    reach,
    findings,
    revocable: true,
    lastSeen: seenAt.slice(0, 10),
    people: [
      ...new Map(
        app.grants.flatMap((g): [string, PersonRef][] => {
          if (g.allUsers || !g.principalName) return [];
          const email = g.principalEmail ?? "";
          // The full email (or the Microsoft ID) keeps alice@one and alice@two apart;
          // peopleFrom links laptop profiles to these by the part before @.
          return [[g.principalId ?? g.id, { key: email ? email.toLowerCase() : `m365:${g.principalId ?? g.id}`, name: g.principalName, ...(email ? { email } : {}) }]];
        }),
      ).values(),
    ],
  };
}
