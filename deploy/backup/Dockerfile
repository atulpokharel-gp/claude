# Nightly database backups for Zinloop. Same Postgres version as the db service,
# plus age (encryption) and the AWS CLI (any S3-compatible storage).
FROM postgres:16-alpine
RUN apk add --no-cache age aws-cli
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT []
CMD ["backup.sh"]
