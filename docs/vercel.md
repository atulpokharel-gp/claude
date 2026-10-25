# Hosting Zinloop on Vercel

An alternative to the Docker servers in [deploy.md](deploy.md). Vercel runs the
console; everything Vercel can't run lives elsewhere:

| Part | Docker setup | Vercel setup |
| --- | --- | --- |
| Console (website + app) | `console` container | Vercel project, root directory `console` |
| Postgres | `db` container | **Neon** (managed Postgres; Supabase works too) |
| Migrations | `migrate` container | Vercel's production build runs them first ([vercel-migrate.ts](../console/scripts/vercel-migrate.ts)); a failed migration stops the deploy |
| Email every 5 min, daily jobs | `maintenance` container | **Vercel Cron** calling `/api/cron/mail` and `/api/cron/daily?job=…` (one schedule per daily job) ([vercel.json](../console/vercel.json)) |
| Nightly backups | `backup` container | Neon's point-in-time restore, plus a nightly encrypted copy from GitHub Actions ([vercel-backup.yml](../.github/workflows/vercel-backup.yml)) |
| HTTPS | Caddy | Vercel |

**Vercel plan:** use **Pro**. Hobby is for non-commercial use only, and it
can't run a cron job every 5 minutes (the deploy fails with the 5-minute cron
in `vercel.json`).

## 1. Database (Neon)

1. Create a Neon project in the region closest to your Vercel region (e.g.
   AWS us-east-1 next to Vercel `iad1`). Postgres 17 is fine.
2. Copy two connection strings from **Connect**:
   - The **direct** one (host without `-pooler`) for the owner role. This is
     `DATABASE_ADMIN_URL`. Migrations, background jobs and backups use it.
   - Make a long random password for the app role: `openssl rand -hex 24`.
     This is `DB_APP_PASSWORD`. The first deploy creates the `zinloop_app`
     role with it.
   - `DATABASE_URL` is the **pooled** string (host with `-pooler`) with the
     user and password swapped for `zinloop_app` and `DB_APP_PASSWORD`:
     `postgres://zinloop_app:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`
3. The owner role must have `BYPASSRLS` so the daily jobs see every MSP's
   data. Neon's default owner role should have it; the deploy checks and stops with a
   clear error if not.

## 2. Vercel project

1. In Vercel, **Add New → Project**, import this GitHub repository, and set
   **Root Directory** to `console`. Framework: Next.js. Pick the Pro team.
2. Under **Settings → Environment Variables**, add these for **Production**
   only (preview deployments then run on demo data and never touch the
   database):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Pooled app-role string from step 1 |
| `DATABASE_ADMIN_URL` | Direct owner string (migrations and cron jobs) |
| `DB_APP_PASSWORD` | The app role password from step 1 |
| `APP_SECRET` | `openssl rand -base64 32`. Keep it: changing it turns off everyone's two-factor setup |
| `CRON_SECRET` | `openssl rand -hex 32`. Vercel sends it to the cron routes; without it they answer 404 |
| `CONSOLE_URL` | `https://app.zinloop.com` (your real domain) |
| `TRUST_PROXY` | `1` (Vercel sets the client address) |
| `SMTP_URL`, `MAIL_FROM` | Your mail service, as in deploy.md |
| `M365_*`, `SSO_*`, `SCAN_KEEP_DAYS`, `DOWNLOAD_BASE_URL` | Same as deploy.md |

3. Under **Settings → Domains**, add `app.zinloop.com` and create the DNS
   record Vercel shows (a CNAME to Vercel) wherever the domain's DNS lives.

Every push to `main` now deploys to production. The `vercel-build` script
migrates the database first and sets the `zinloop_app` password, so a deploy
never goes live on an old schema. Create the first MSP account by signing up
on the site, or run `npm run db:create-msp` locally with `DATABASE_ADMIN_URL`
set.

## 3. Off-site backups (optional, recommended)

In the repository's **Settings → Environments**, create `vercel` and add:

- **Secrets:** `DATABASE_ADMIN_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- **Variables:** `BACKUP_S3_URI`, `BACKUP_S3_ENDPOINT` (for R2/B2),
  `BACKUP_AGE_RECIPIENT`, and `PG_MAJOR` if your Neon database isn't
  Postgres 17.

The [vercel-backup](../.github/workflows/vercel-backup.yml) workflow then
makes a nightly encrypted copy. Until `BACKUP_S3_URI` is set it skips.

The Docker deploy workflow keeps skipping while `SSH_HOST` isn't set, so the
two setups don't get in each other's way. Use one of them for production.

## Checking it works

- `https://app.zinloop.com/api/health` answers `{"ok":true,"database":"ok"}`.
- After a day, `/api/health?jobs=1` lists `mail_send`, `cleanup`, `m365_sync`,
  `snapshot`, `mail_weekly` and `backup` as `ok`. Point an uptime monitor at it.
- Vercel → **Cron Jobs** shows each run and its logs.

## Rolling back

Vercel → **Deployments** → pick the previous one → **Instant Rollback**. Migrations
are written so the previous version keeps working after them (see
migration 009). To restore data, use Neon's point-in-time restore, or
`deploy/backup/restore.sh` with an off-site copy.
