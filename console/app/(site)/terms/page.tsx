import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <section className="section">
      <div className="wrap doc">
        <article>
          <p className="eyebrow">Draft · not yet reviewed by a lawyer</p>
          <h1 className="disp h2">Terms of service</h1>
          <p>Full terms will be published before paid plans open. Until then, the free plan is provided as is, for evaluation, with no service-level commitment.</p>
          <p>Only scan computers you or your client are authorized to manage.</p>
          <p>Questions: <b>hello@zinloop.com</b></p>
        </article>
      </div>
    </section>
  );
}
