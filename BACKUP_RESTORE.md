# Backup and Restore Procedures

## Automated Backups

### Manual Backup
```bash
cd /opt/onyx
./backup.sh
```

### Scheduled Backups (Cron)
Add to crontab:
```bash
# Daily backup at 2 AM
0 2 * * * cd /opt/onyx && ./backup.sh >> backups/backup.log 2>&1
```

### Backup Location
- Default: `/opt/onyx/backups/`
- Format: `onyx_backup_YYYYMMDD_HHMMSS.tar.gz`
- Retention: 7 days (configurable in script)

## Manual Restore

### Restore All Data
```bash
# Stop the application
docker stop onyx

# Extract backup to data directory
tar -xzf backups/onyx_backup_YYYYMMDD_HHMMSS.tar.gz -C /opt/onyx

# Start the application
docker start onyx
```

### Restore Single File
```bash
# Extract single file from backup
tar -xzf backups/onyx_backup_YYYYMMDD_HHMMSS.tar.gz \
    -C /opt/onyx \
    data/requests.json
```

## Backup Contents

Critical files backed up:
- `requests.json` - Active book requests
- `history.json` - Request history
- `import_log.json` - Download import log
- `book_metadata.json` - Book metadata cache
- `discovery_cache.json` - Genre discovery data
- `telegram_session.txt` - Telegram authentication state

## Monitoring

### Check Backup Status
```bash
ls -lh /opt/onyx/backups/
```

### Backup Size
Typical backup size: ~2-3 MB (compressed)

## Troubleshooting

### Backup Fails
1. Check disk space: `df -h`
2. Check data directory exists: `ls -la /opt/onyx/data/`
3. Check script permissions: `ls -l /opt/onyx/backup.sh`

### Restore Fails
1. Verify backup file integrity: `tar -tzf backup.tar.gz | head`
2. Stop application before restoring
3. Check file permissions after restore
