/** An example scan result, shown on the marketing pages. Clearly labelled as an example. */
export function FindingCard() {
  return (
    <figure className="finding-card">
      <div className="bar">
        <span>LAPTOP-7Q2 · Harbor Dental</span>
        <span>Example scan</span>
      </div>
      <div className="items">
        <div className="item">
          <span className="sev high">HIGH</span>
          <div>
            <b>Password stored in plain text</b>
            <span className="mono">Claude Desktop › server "postgres" › DATABASE_URL = postgres://app:••••••@db.internal</span>
          </div>
        </div>
        <div className="item">
          <span className="sev high">HIGH</span>
          <div>
            <b>GitHub token in a config file</b>
            <span className="mono">Cursor › server "github" › GITHUB_TOKEN = ghp_••••••••</span>
          </div>
        </div>
        <div className="item">
          <span className="sev medium">MEDIUM</span>
          <div>
            <b>Connector updates itself on every start</b>
            <span className="mono">VS Code › npx -y @acme/crm-mcp (no version pinned)</span>
          </div>
        </div>
        <div className="fixbox">
          <span className="eyebrow">One-command fix</span>
          <pre>{"zinloop fix-secrets --apply\n✓ 2 keys moved to Windows Credential Manager"}</pre>
        </div>
      </div>
      <figcaption>Key values are hidden on the laptop and never sent to us.</figcaption>
    </figure>
  );
}
