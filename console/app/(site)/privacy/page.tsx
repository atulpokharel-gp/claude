import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <section className="section">
      <div className="wrap doc">
        <article>
          <p className="eyebrow">Draft · not yet reviewed by a lawyer</p>
          <h1 className="disp h2">Privacy summary</h1>
          <p>This is a plain summary of what Zinloop Security collects. A full privacy policy will replace it before paid plans open.</p>
          <h2>What we collect</h2>
          <ul className="list">
            <li><b>Account details</b>: your name, your MSP's name, your work email and a hash of your password.</li>
            <li><b>Client names</b> you add to the console.</li>
            <li><b>Scan reports</b> from laptops: computer name, operating system, AI apps and connectors found, setting names and findings. Setting values and keys are never collected.</li>
          </ul>
          <h2>How we use it</h2>
          <p>Only to run the console for you. We don't sell data or use scan reports for advertising.</p>
          <h2>Deleting data</h2>
          <p>Email <b>privacy@zinloop.com</b> and we'll delete your account and every scan it holds.</p>
        </article>
      </div>
    </section>
  );
}
