import { SESSION_IDLE_MINUTES, type SessionInfo } from "@/lib/auth.ts";
import { EndOtherSessions } from "@/app/(console)/app/settings/SettingsForms.tsx";

/** A short, readable device name from a browser's user agent. */
export function deviceName(ua: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** The signed-in user's sessions, with a button to sign out everywhere else. */
export function SessionsPanel({ sessions }: { sessions: SessionInfo[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Where you&apos;re signed in</h2>
        <span className="muted small">Sessions end after {SESSION_IDLE_MINUTES >= 60 ? `${Math.round(SESSION_IDLE_MINUTES / 60)} hours` : `${SESSION_IDLE_MINUTES} minutes`} without use, and always after 12 hours.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Last used</th></tr></thead>
          <tbody>
            {sessions.map((x) => (
              <tr key={x.id}>
                <td>{deviceName(x.userAgent)}{x.current && <span className="muted"> (this browser)</span>}</td>
                <td className="small">{x.ip || <span className="muted">Not recorded</span>}</td>
                <td className="small">{when(x.createdAt)}</td>
                <td className="small">{when(x.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body"><EndOtherSessions others={sessions.filter((x) => !x.current).length} /></div>
    </section>
  );
}
