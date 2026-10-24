# Deploying Zinloop Security

Zinloop runs on ordinary Linux servers with Docker. One server runs everything:
Postgres, the console, background jobs (email, Microsoft 365 checks, cleanup),
nightly backups and Caddy for HTTPS. A 2 vCPU / 4 GB server is plenty to start.

Run two of them:

- **Staging** (e.g. `staging.zinloop.com`): every commit on `main` that passes
  CI is deployed here automatically. Try changes here first.
- **Production** (e.g. `app.zinloop.com`): deployed when you push a version tag
  such as `v1.2.0`, after an optional approval.

Both use the same `docker-compose.yml`, each with its own `.env`, database and
secrets. Never point staging at production's database.

## 1. Set up a server (once per environment)

You need a Linux server with a public IP, a DNS record pointing at it, ports 80
and 443 open, and Docker with the compose plugin.

```sh
# as root on the new server
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/zinloop && chown deploy:deploy /opt/zinloop
```

Make a deploy key for GitHub Actions on your own computer, and put its public
half on the server:

```sh
ssh-keygen -t ed25519 -N "" -C zinloop-deploy-staging -f zinloop-deploy-staging
ssh-copy-id -i zinloop-deploy-staging.pub deploy@staging.zinloop.com
ssh-keyscan staging.zinloop.com > known_hosts-staging
```

Create `/opt/zinloop/.env` on the server from [`.env.example`](../.env.example):

| Setting | What to put |
| --- | --- |
| `CONSOLE_HOST` | The domain, e.g. `app.zinloop.com` |
| `CONSOLE_URL` | `https://` plus the domain |
| `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` | Two different long random passwords (`openssl rand -hex 24`), also used in the two connection strings |
| `DATABASE_ADMIN_URL`, `DATABASE_URL` | Keep the host `db`; put the passwords in |
| `APP_SECRET` | `openssl rand -base64 32`. Needed for two-factor sign-in, Microsoft 365 and unsubscribe links. Keep it safe: changing it turns off everyone's two-factor setup |
| `TRUST_PROXY` | `1` (Caddy sets the client address) |
| `M365_CLIENT_ID`, `M365_CLIENT_SECRET` | Optional, see [m365.md](m365.md). Use a separate Entra app for staging |
| `SMTP_URL`, `MAIL_FROM` | Optional, for alert and weekly emails. An SMTP address from any mail service, e.g. `smtps://user:password@smtp.postmarkapp.com:465`. Add the service's SPF and DKIM records for the `MAIL_FROM` domain. On staging, use a test inbox service (e.g. Mailtrap) so real people don't get test email |
| `BACKUP_*`, `AWS_*` | Off-site backups, see section 4 |
| `DOWNLOAD_BASE_URL` | Only if scanner builds aren't in this repo's public GitHub releases |

`chmod 600 /opt/zinloop/.env`. It holds every secret for that environment.

## 2. Connect GitHub Actions

In the repository's **Settings → Environments**, create `staging` and
`production`. In each, add:

- **Secrets:** `SSH_HOST` (the server), `SSH_USER` (`deploy`), `SSH_KEY` (the
  private key file's contents) and `SSH_KNOWN_HOSTS` (the `ssh-keyscan` output).
- **Variables:** `CONSOLE_URL` (e.g. `https://app.zinloop.com`, checked after
  each deploy) and optionally `DEPLOY_DIR` (default `/opt/zinloop`).
- For `production`, add yourself under **Required reviewers** so every
  production deploy waits for a click.

Until `SSH_HOST` is set, the deploy jobs build and store the images and skip
the deploy, so nothing breaks before the servers exist.

## 3. How a deploy works

1. A commit lands on `main`. CI runs the tests, builds the images and starts
   the whole stack to check health, backups and restore.
2. The [deploy workflow](../.github/workflows/deploy.yml) builds the console
   and backup images for that commit and stores them in GitHub's container
   registry (private to the repository).
3. It copies `docker-compose.yml` and `deploy/` to the staging server and runs
   [`deploy/deploy.sh`](../deploy/deploy.sh) there. That script backs up the
   database, pulls the images, runs migrations, starts everything and waits for
   the health check. **If the new version isn't healthy within 3 minutes, it
   starts the previous version again** and the workflow fails.
4. The workflow then checks `CONSOLE_URL/api/health` from outside.

To release to production, tag a commit that's already on staging:

```sh
git tag v1.2.0 && git push origin v1.2.0
```

The same images that ran on staging are deployed; nothing is rebuilt. The tag
also publishes scanner builds (the `release` workflow).

The first deploy on a new server creates the database. Then open the console,
click **Get a free scan** and create your account. Give your own account
unlimited clients:

```sh
cd /opt/zinloop && docker compose run --rm console npm run db:set-plan -- you@yourcompany.com msp
```

Each deploy records the running images as `CONSOLE_IMAGE` and `BACKUP_IMAGE`
in the server's `.env`, so commands you run there by hand (like the one above,
or `docker compose up -d backup`) use the deployed version. Don't edit those
two lines; the next deploy rewrites them.

**Rolling back by hand:** `cat /opt/zinloop/.deployed` shows the running images.
To go back, run `sh deploy/deploy.sh <older console image> <older backup image>`
with images from an earlier deploy (the image tag is the commit hash).
Migrations only move forward. New migrations should keep the previous version
working (add columns and functions rather than rename or drop them), so an
older version still runs on the newer database. When one can't, going back
means restoring the backup the deploy took just before it (section 4).

## 4. Backups

The `backup` service dumps the database every night into the `backups` volume
and keeps `BACKUP_KEEP_DAYS` (14) days. Every deploy also takes a backup first.
A backup that only lives on the same server isn't enough, so set up off-site
copies before the first customer:

1. Make an encryption key on your own computer (install
   [age](https://github.com/FiloSottile/age) first):
   `age-keygen -o zinloop-backup-key.txt`. It prints the public key
   (`age1...`). Store the key file in your password manager and **not** on the
   server. Without it, the off-site copies can't be read, by you or by anyone
   who steals them.
2. Create a bucket at any S3-compatible storage (Backblaze B2 and Cloudflare R2
   are cheap) and an access key that can only write to that bucket. Turn on the
   bucket's object lock or versioning if offered, so a compromised server can't
   delete old backups.
3. In the server's `.env`, set `BACKUP_S3_URI` (e.g. `s3://zinloop-backups/prod`),
   `BACKUP_S3_ENDPOINT` (the storage's S3 address, empty for AWS),
   `BACKUP_AGE_RECIPIENT` (the `age1...` public key) and the `AWS_*` keys.
   Then `docker compose up -d backup`.

The backup refuses to upload unless `BACKUP_AGE_RECIPIENT` is set, so
unencrypted data never leaves the server.

**Check a backup can be restored** (safe; it uses a scratch database):

```sh
docker compose exec backup sh -c 'restore.sh --check "$(ls -t /backups/*.dump | head -1)"'
```

Do this once a month, and after restoring from an off-site copy (copy the
`.dump.age` file and the key into the container and set `AGE_IDENTITY_FILE`).

**Restore for real** (replaces the live data):

```sh
docker compose stop console maintenance
docker compose exec backup restore.sh --yes /backups/zinloop-2026-10-24T030000Z.dump
docker compose start console maintenance
```

## 5. Monitoring

- **Uptime:** point an uptime monitor (Better Stack, UptimeRobot or similar,
  most have a free plan) at `https://app.zinloop.com/api/health?jobs=1` every
  few minutes and have it email or text you. It returns 503 when the database
  is unreachable or when a background job (backups, email, maintenance,
  Microsoft 365 checks) has failed or hasn't run on time. Use
  `/api/health` without `?jobs=1` if you only want "is the site up".
- **Logs:** `docker compose logs -f console` (or `maintenance`, `backup`).
  Logs are rotated automatically at 5 × 10 MB per service.
- **Disk:** keep an eye on free space (`df -h`); backups and Postgres grow
  over time. Most hosting providers can alert on disk use.
- **Updates:** turn on automatic security updates for the server's OS
  (`unattended-upgrades` on Ubuntu/Debian). Docker images update with each deploy.

## 6. When something goes wrong

| Symptom | Look at |
| --- | --- |
| Uptime monitor says down, `/api/health` fails | `docker compose ps`, then `docker compose logs --tail 100 console db` |
| `/api/health?jobs=1` says `backup: failing` | `docker compose logs --tail 50 backup` (usually storage credentials or a full disk) |
| `mail_send: failing` or `late` | `docker compose logs --tail 50 maintenance`; check `SMTP_URL` and the mail service's dashboard. Emails wait and are retried, so nothing is lost for about a day |
| A deploy failed | The workflow log shows the server's output, and the previous version is running again. Fix, push, and it redeploys |
| Need the database | `docker compose exec db psql -U zinloop_owner zinloop` |

## Before the first paying customer

- Get an outside penetration test of the console and the scanner.
- Have a lawyer replace the draft privacy and terms pages.
- Off-site backups set up and a restore tested (section 4).
- Uptime monitoring alerting a phone (section 5).

## Running without GitHub Actions

On a single server you can also deploy by hand: clone the repo into
`/opt/zinloop`, create `.env`, and run `docker compose up -d --build`. To
update: `git pull && docker compose up -d --build`. Migrations run first.
