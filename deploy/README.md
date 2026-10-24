# Deploy files

Copied to each server by the deploy workflow. See [docs/deploy.md](../docs/deploy.md).

- `deploy.sh`: runs on the server. Backs up, pulls the images, migrates, starts, waits for the health check and rolls back if it fails.
- `backup/`: the backup image (`backup.sh` nightly dumps and encrypted off-site copies, `restore.sh` to check or restore a dump).
