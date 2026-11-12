# Database backups

`backup.sh` backs up every NexMarket database (the first one and each organisation's `nm_*` database).
`restore-test.sh` proves one backup file can be restored, without touching a real database.

## Set up (once, on the database server or any machine that can reach it)

1. Install the PostgreSQL client tools of the same major version as the server.
2. Put the connection in `~/.pgpass` (mode 600) or in `PG*` environment variables. Never in the repository.
3. Choose where backups go and, strongly advised, an off-server copy:

       export BACKUP_DIR=/var/backups/nexmarket
       export BACKUP_REMOTE=s3://your-bucket/nexmarket     # needs the aws CLI and its own credentials
       export KEEP_DAYS=14

4. Run it once by hand and check the output: `./backup.sh`
5. Run it every night, and before every deploy. Example cron line (02:30 India time on a server set to UTC):

       0 21 * * * BACKUP_DIR=/var/backups/nexmarket BACKUP_REMOTE=s3://your-bucket/nexmarket /opt/nexmarket/deploy/backup/backup.sh >> /var/log/nexmarket-backup.log 2>&1

## Know that it works

- The script exits with an error when any database fails. Have cron mail you, or watch `backup.log`.
- Once a week, test a restore: `./restore-test.sh /var/backups/nexmarket/<date>/nexmarket.dump`
- A backup you have never restored is not a backup.

## What is not covered

- Uploaded files (photos, chat files, Team board files) live in object storage, not the database. Turn on
  versioning for that bucket.
- The agents service keeps its own tables (schema `agents`) in the first database, so they are included.
- Backups are not encrypted by this script. Use an encrypted bucket or disk.
