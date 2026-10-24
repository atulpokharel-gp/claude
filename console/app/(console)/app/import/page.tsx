"use client";

import { useState } from "react";
import type { Client } from "@/lib/types.ts";
import { importScan, ScanImportError } from "@/lib/scan-import.ts";
import { ClientView } from "@/components/ClientView.tsx";

const MAX_BYTES = 5 * 1024 * 1024;

export default function ImportPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function load(text: string) {
    try {
      setClient(importScan(JSON.parse(text)));
      setError(null);
    } catch (e) {
      setClient(null);
      setError(e instanceof ScanImportError ? e.message : "This file isn't valid JSON. Choose the file zinloop wrote with --out.");
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 5 MB. A scan report is usually a few KB.");
      return;
    }
    load(await file.text());
  }

  async function loadSample() {
    const res = await fetch("/sample-scan.json");
    load(await res.text());
  }

  if (client) {
    return (
      <>
        <p className="small">
          <button type="button" className="btn" onClick={() => setClient(null)}>Upload a different scan</button>
        </p>
        <ClientView client={client} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Open a scan file</h1>
        <p className="muted">See what the scanner found on one computer. The file stays in your browser and is not uploaded anywhere.</p>
      </div>

      <section
        className="drop"
        data-over={over}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void readFile(e.dataTransfer.files[0]); }}
      >
        <h2>Drop scan.json here</h2>
        <label className="btn primary" htmlFor="scan-file">Choose file</label>
        <input id="scan-file" type="file" accept="application/json,.json" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
        <button type="button" className="btn" onClick={() => void loadSample()}>Or try a sample scan</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>How to scan a computer</h2></div>
        <div style={{ padding: 16 }}>
          <ol className="steps">
            <li>Download <code>zinloop</code> for Windows, Mac or Linux, or build it from the <code>scanner</code> folder with <code>go build ./cmd/zinloop</code>.</li>
            <li>Run <code>zinloop --json --out scan.json</code>. It only reads config files and sends nothing over the network.</li>
            <li>Upload <code>scan.json</code> here. Passwords and keys are never in the file; the scanner keeps only their names.</li>
          </ol>
        </div>
      </section>
    </>
  );
}
