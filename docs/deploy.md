# Deploying Zinloop Security

One Linux server with Docker runs everything: Postgres, the console, a daily
maintenance job and Caddy for HTTPS. A 2 vCPU / 4 GB server is plenty to start.

## 1. Before you start

- A domain record pointing at the server, for example `app.zinloop.com`.
- Ports 80 and 443 open (Caddy gets a certificate from Let's Encrypt).
- Docker with the compose plugin.

## 2. Configure

```sh
git clone <this repo> zinloop && cd zinloop
cp .env.example .env
```

Fill in `.env`:

| Setting | What to put |
| --- | --- |
| `CONSOLE_HOST` | The domain, e.g. `app.zinloop.com` |
| `CONSOLE_URL` | `https://` plus the domain |
| `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` | Two different long random passwords (`openssl rand -hex 24`), also used in the two connection strings |
| `DATABASE_ADMIN_URL`, `DATABASE_URL` | Keep the host `db`; put the passwords in |
| `APP_SECRET` | `openssl rand -base64 32`. Needed for two-factor sign-in and Microsoft 365. Keep it safe: changing it turns off everyone's two-factor setup |
| `TRUST_PROXY` | `1` (Caddy sets the client address) |
| `M365_CLIENT_ID`, `M365_CLIENT_SECRET` | Optional, see [m365.md](m365.md) |
| `DOWNLOAD_BASE_URL` | Only if scanner builds aren't in this repo's public GitHub releases |

## 3. Start

```sh
docker compose up -d --build
docker compose logs -f migrate   # should end with "applied 002_accounts.sql"
```

Open `https://app.zinloop.com`, click **Get a free scan** and create your
account. Give your own account unlimited clients:

```sh
docker compose run --rm console npm run db:set-plan -- you@yourcompany.com msp
```

## 4. Publish scanner builds

Laptops download the scanner through `https://<console>/download/...`, which
points at GitHub releases. Tag a release to build them:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The `release` workflow builds Windows, macOS and Linux binaries, the RMM
scripts and `checksums.txt`. If the repository is private, laptops can't
download from it: host the release files somewhere public and set
`DOWNLOAD_BASE_URL`.

## 5. Day to day

- **Backups:** `docker compose exec db pg_dump -U zinloop_owner zinloop | gzip > backup-$(date +%F).sql.gz`, daily, copied off the server.
- **Updates:** `git pull && docker compose up -d --build`. Migrations run first.
- **Maintenance** runs daily by itself: expired sessions and invites, scans
  older than `SCAN_KEEP_DAYS`, and a fresh Microsoft 365 check.
- **Plans:** payments aren't built yet. Move an MSP between `free`, `partner`
  and `msp` with `npm run db:set-plan` as above.

## Before the first paying customer

- Get an outside penetration test of the console and the scanner.
- Have a lawyer replace the draft privacy and terms pages.
- Set up off-site backups and uptime monitoring.
