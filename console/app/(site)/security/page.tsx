import type { Metadata } from "next";
import { CtaBand } from "@/components/site/CtaBand.tsx";

export const metadata: Metadata = { title: "Security" };

export default function Security() {
  return (
    <>
      <section className="section">
        <div className="wrap stack" style={{ gap: 20, maxWidth: 900 }}>
          <p className="eyebrow">Security</p>
          <h1 className="disp h1">We never see your clients' keys</h1>
          <p className="lead">
            A security tool shouldn't become the next breach. This page lists what the scanner reads, what it sends, and
            how the console keeps each MSP's data apart.
          </p>
        </div>
      </section>
      <section className="band section">
        <div className="wrap doc">
          <nav aria-label="On this page">
            <a href="#scanner">The scanner</a>
            <a href="#sent">What is sent</a>
            <a href="#console">The console</a>
            <a href="#accounts">Accounts</a>
            <a href="#report">Reporting a problem</a>
          </nav>
          <article>
            <h2 id="scanner">The scanner</h2>
            <ul className="list">
              <li>Reads only the AI apps' settings files listed in the docs. It doesn't read documents, email or browser data.</li>
              <li>Makes no network calls unless it is told to upload, and then only to your console over https.</li>
              <li>Changes nothing unless a technician runs <code>fix-secrets --apply</code> or <code>rotate</code>. Fixes back up each file first.</li>
              <li>Refuses to follow redirects when uploading, so the upload token can't be sent somewhere else.</li>
              <li>Builds are published with SHA-256 checksums, and the install scripts check them before running anything.</li>
            </ul>
            <h2 id="sent">What is sent</h2>
            <p>For each connector: the app, the config file path, the command, the names of its settings, and the findings.</p>
            <p>
              Setting <b>values</b> are never sent. Arguments that look like tokens and the user and query parts of addresses
              are replaced with <code>[REDACTED]</code> on the laptop before the report is built.
            </p>
            <h2 id="console">The console</h2>
            <ul className="list">
              <li>Every table that holds MSP data is protected by row-level security in PostgreSQL. The app connects as a role that can only see the signed-in MSP's rows.</li>
              <li>Upload tokens and session tokens are stored only as SHA-256 hashes. Upload tokens are shown once.</li>
              <li>Uploads are limited to 2 MB and checked before they are stored.</li>
            </ul>
            <h2 id="accounts">Accounts</h2>
            <ul className="list">
              <li>Passwords are hashed with scrypt. Sign-in attempts are rate limited.</li>
              <li>Two-factor sign-in with an authenticator app is available for every user.</li>
              <li>Sessions expire after 12 hours and can be ended by signing out.</li>
            </ul>
            <h2 id="report">Reporting a problem</h2>
            <p>Email <b>security@zinloop.com</b>. We reply within two business days.</p>
          </article>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
