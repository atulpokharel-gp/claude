# Nightly database backups for Zinloop. Same Postgres version as the database
# (16 for docker-compose; pass --build-arg PG_MAJOR=17 for a Postgres 17 host),
# plus age (encryption) and the AWS CLI (any S3-compatible storage).
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-alpine
RUN apk add --no-cache age aws-cli
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh \
 && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT []
CMD ["backup.sh"]
