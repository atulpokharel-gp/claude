import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atul Pokharel · Founder of Zinloop Security",
  description:
    "Why Atul Pokharel built Zinloop Security — an agent & MCP security product for MSPs serving the mid-market.",
  openGraph: {
    title: "Atul Pokharel · Founder of Zinloop Security",
    description:
      "Why Atul Pokharel built Zinloop Security — an agent & MCP security product for MSPs serving the mid-market.",
    url: "https://founder.zinloop.com",
    type: "profile",
  },
};

export default function FounderPage() {
  return (
    <div className="founder-page">
      <section className="hero">
        <p className="eyebrow">Founder · Zinloop Security</p>
        <h1>
          Hi, I&rsquo;m Atul.
          <br />
          I built <span className="accent">Zinloop</span> so the AI assistants
          already on your laptops stop being invisible.
        </h1>
        <p className="lead">
          Zinloop is an agent &amp; MCP security product sold through managed service providers
          to mid-market companies. It finds the AI assistants employees have plugged into
          work accounts, flags the keys sitting in plain text, and gives the MSP that already
          runs the IT a console to fix it.
        </p>
        <div className="meta">
          <a
            href="https://www.linkedin.com/in/atul-pokharel-372509308/"
            rel="noopener noreferrer"
            target="_blank"
          >
            LinkedIn
          </a>
          <span className="dot">·</span>
          <a href="https://github.com/atulpokharel-gp" rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
          <span className="dot">·</span>
          <a href="https://zinloop.com">zinloop.com</a>
        </div>
        <div className="cta-row">
          <a
            className="zbtn zbtn-main"
            href="https://www.linkedin.com/in/atul-pokharel-372509308/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Connect on LinkedIn
          </a>
          <Link className="zbtn zbtn-ghost" href="https://zinloop.com/free-scan">
            See the product
          </Link>
        </div>
      </section>

      <section className="block" id="story">
        <h2>
          Why I&rsquo;m <span className="accent">building this</span>
        </h2>
        <p>
          A few months ago I started noticing a pattern on friends&rsquo; and clients&rsquo;
          laptops. Someone had set up Claude Desktop, or Cursor, or ChatGPT, and alongside
          it was a small plain-text config file &mdash; <code>mcp.json</code>, usually &mdash;
          with API keys to their inbox, their code repos, their customer tools. No vault.
          No rotation. No inventory. Nobody at the company could tell me which laptops had
          these files, which systems the AI could reach, or whose keys were inside.
        </p>
        <p>
          I run a small IT practice and talk to MSP operators every week. The pattern was
          the same everywhere: mid-market companies plugging AI assistants into
          M365, Google Drive, GitHub and Salesforce, and the people responsible for
          security &mdash; usually an MSP, not an in-house team &mdash; had no tool for it.
          Their RMM manages the device. Their EDR watches for malware. Nothing watches
          the agent configs. Nothing even counts them.
        </p>
        <p className="pullquote">
          Every mid-market laptop is quietly becoming an identity provider for AI agents,
          and nobody is counting them.
        </p>
        <p>
          The incident waiting to happen is a Claude Desktop MCP server with full-tenant
          M365 scopes left in a stolen laptop&rsquo;s keychain. I didn&rsquo;t want to
          wait for that incident to be the thing that started this company, so I started
          it now.
        </p>
      </section>

      <section className="block" id="what">
        <h2>What <span className="accent">Zinloop</span> is</h2>
        <p>
          Three pieces, sold as one product to the MSP:
        </p>
        <p>
          <b>A laptop scanner</b> &mdash; <code>zinloop install</code> &mdash; discovers
          every MCP server configured on a device, extracts the scopes and references
          the API keys (never the raw secret), and maps which SaaS systems each agent can
          touch. Windows, macOS, Linux. Runs as a service. Daily by default.
        </p>
        <p>
          <b>An M365 / Entra read-only connector</b> that pulls the same picture from the
          cloud side: which OAuth apps hold tenant-wide consent, who granted them, which
          scopes they hold, and when they were last used.
        </p>
        <p>
          <b>An MSP console</b> &mdash; multi-tenant, Postgres row-level security per MSP
          and per client &mdash; where the provider sees every one of their clients&rsquo;
          agent exposure in one place, gets a mail when something widens, generates a PDF
          audit report, and one-clicks revoke a risky M365 grant.
        </p>
        <p>
          There&rsquo;s a sidecar module &mdash; <b>Zipax</b> &mdash; that scores how
          developers use AI coding assistants and feeds a public leaderboard. It started
          as a honeypot to get the scanner installed on dev laptops. It&rsquo;s working.
        </p>
      </section>

      <section className="block" id="now">
        <h2>Where it is <span className="accent">right now</span></h2>
        <div className="nowgrid">
          <div className="nowcard">
            <span className="k">Console</span>
            <span className="v">Live at zinloop.com</span>
          </div>
          <div className="nowcard">
            <span className="k">Scanner</span>
            <span className="v">Windows / macOS / Linux, v0.1.0</span>
          </div>
          <div className="nowcard">
            <span className="k">Design partners</span>
            <span className="v">Five slots open, 90 days free</span>
          </div>
          <div className="nowcard">
            <span className="k">Pricing</span>
            <span className="v">$2/device/mo to MSP · $99/mo min</span>
          </div>
        </div>
      </section>

      <section className="block" id="me">
        <h2>About <span className="accent">me</span></h2>
        <p>
          <b>Atul Pokharel.</b> Builder background, running a small IT practice with
          direct access to MSP operator conversations &mdash; which is how I keep hearing
          what&rsquo;s actually breaking on the ground. I&rsquo;m writing Zinloop
          end-to-end: the scanner in Go, the console in Next.js on Vercel, Postgres on
          Neon, with Claude as a day-to-day coding collaborator. The six-week velocity
          from first commit to live product is partly the AI stack and partly me doing
          nothing else right now.
        </p>
        <p>
          I&rsquo;m solo for now, and upfront about it. I&rsquo;m looking for a
          go-to-market partner once there are paid pilots &mdash; not a technical
          co-founder short-term.
        </p>
      </section>

      <section className="closer">
        <p className="small">
          If you&rsquo;re an MSP, a mid-market CTO, an operator in this space, or a
          potential partner &mdash; the fastest way to reach me is{" "}
          <a
            href="https://www.linkedin.com/in/atul-pokharel-372509308/"
            rel="noopener noreferrer"
            target="_blank"
          >
            LinkedIn
          </a>
          . If you&rsquo;re a developer, take a look at{" "}
          <a href="https://zipax.zinloop.com">Zipax</a>. If you want to see
          the product, start with a{" "}
          <a href="https://zinloop.com/free-scan">free scan</a>.
        </p>
      </section>
    </div>
  );
}
