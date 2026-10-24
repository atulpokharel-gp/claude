// A fake Microsoft identity platform and Graph API for tests.

import { GRAPH, type Fetch } from "./m365.ts";

export const TENANT = "11111111-2222-3333-4444-555555555555";
const GRAPH_SP = "sp-graph";
const MAIL_READ_ALL = "role-mail-read-all";

export interface FakeGraph {
  fetch: Fetch;
  calls: { method: string; url: string }[];
  grants: { id: string; clientId: string; consentType: string; principalId: string | null; scope: string }[];
  assignments: { id: string; principalId: string; appRoleId: string; resourceId: string }[];
}

export function fakeGraph(): FakeGraph {
  const sps = [
    { id: GRAPH_SP, appId: "00000003-0000-0000-c000-000000000000", displayName: "Microsoft Graph", appOwnerOrganizationId: "f8cdef31-a31e-4b4a-93e4-5f571e91255a", appRoles: [{ id: MAIL_READ_ALL, value: "Mail.Read.All" }] },
    { id: "sp-inbox", appId: "a1", displayName: "InboxPilot AI", publisherName: "InboxPilot Ltd", verifiedPublisher: null },
    { id: "sp-chatgpt", appId: "a2", displayName: "ChatGPT", publisherName: "OpenAI", verifiedPublisher: { displayName: "OpenAI" } },
    { id: "sp-notes", appId: "a3", displayName: "Meeting Notes Bot", publisherName: "Fireflies.ai", verifiedPublisher: { displayName: "Fireflies.ai" } },
    { id: "sp-payroll", appId: "a4", displayName: "Payroll Sync", publisherName: "Payroll Co", verifiedPublisher: null },
    { id: "sp-teams", appId: "a5", displayName: "Copilot", appOwnerOrganizationId: "f8cdef31-a31e-4b4a-93e4-5f571e91255a" },
  ];
  const g: FakeGraph = {
    calls: [],
    grants: [
      { id: "g1", clientId: "sp-inbox", consentType: "Principal", principalId: "u1", scope: "openid profile Mail.ReadWrite Mail.Send offline_access" },
      { id: "g2", clientId: "sp-chatgpt", consentType: "AllPrincipals", principalId: null, scope: "User.Read Files.Read.All Sites.Read.All" },
      { id: "g3", clientId: "sp-payroll", consentType: "AllPrincipals", principalId: null, scope: "Mail.Read" },
      { id: "g4", clientId: "sp-teams", consentType: "AllPrincipals", principalId: null, scope: "Mail.Read" },
    ],
    assignments: [{ id: "as1", principalId: "sp-notes", appRoleId: MAIL_READ_ALL, resourceId: GRAPH_SP }],
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      g.calls.push({ method, url });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://login.microsoftonline.com/")) {
        if (!url.includes(TENANT)) return json({ error_description: "AADSTS700016: Application not found in the directory" }, 400);
        return json({ access_token: "fake-token" });
      }
      if (!url.startsWith(GRAPH)) return json({}, 404);
      const path = decodeURIComponent(url.slice(GRAPH.length));
      if (method === "DELETE") {
        const grant = path.match(/^\/oauth2PermissionGrants\/(.+)$/);
        if (grant) {
          g.grants = g.grants.filter((x) => x.id !== grant[1]);
          return new Response(null, { status: 204 });
        }
        const role = path.match(/^\/servicePrincipals\/(.+)\/appRoleAssignedTo\/(.+)$/);
        if (role) {
          g.assignments = g.assignments.filter((x) => x.id !== role[2]);
          return new Response(null, { status: 204 });
        }
        return json({ error: { message: "not found" } }, 404);
      }
      if (path.startsWith("/servicePrincipals?$filter=appId eq '00000003")) return json({ value: [sps[0]] });
      if (path.startsWith("/servicePrincipals?")) {
        // Two pages, to test paging.
        if (!path.includes("skiptoken")) return json({ value: sps.slice(0, 3), "@odata.nextLink": `${GRAPH}/servicePrincipals?$skiptoken=2` });
        return json({ value: sps.slice(3) });
      }
      if (path.startsWith("/oauth2PermissionGrants")) return json({ value: g.grants });
      if (path.startsWith(`/servicePrincipals/${GRAPH_SP}/appRoleAssignedTo`)) return json({ value: g.assignments });
      return json({ error: { message: `unexpected ${path}` } }, 400);
    }) as Fetch,
  };
  return g;
}
