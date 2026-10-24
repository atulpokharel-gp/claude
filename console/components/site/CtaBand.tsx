import Link from "next/link";

export function CtaBand({ title = "See what AI your clients have connected" }: { title?: string }) {
  return (
    <section className="dark section">
      <div className="wrap row center">
        <div className="col stack">
          <h2 className="disp h2">{title}</h2>
          <p className="lead">
            Create a free account, add one client and run the scanner on up to 25 laptops. You keep the findings.
          </p>
        </div>
        <div className="col buttons">
          <Link className="zbtn zbtn-main" href="/free-scan">Get a free scan</Link>
          <Link className="zbtn zbtn-ghost" href="/docs" style={{ color: "var(--z-dark-ink)", borderColor: "var(--z-dark-ink)" }}>Read the docs</Link>
        </div>
      </div>
    </section>
  );
}
