#!/bin/bash
# Backup script for Onyx Book Dashboard
# Backs up critical data files

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/onyx/backups}"
DATA_DIR="/opt/onyx/data"
RETENTION_DAYS=7

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/onyx_backup_$TIMESTAMP.tar.gz"

# Files to backup
BACKUP_FILES=(
    "$DATA_DIR/requests.json"
    "$DATA_DIR/history.json"
    "$DATA_DIR/import_log.json"
    "$DATA_DIR/book_metadata.json"
    "$DATA_DIR/discovery_cache.json"
    "$DATA_DIR/telegram_session.txt"
)

echo "[BACKUP] Starting backup at $(date)"

# Create tar.gz archive
tar -czf "$BACKUP_FILE" -C /opt/onyx data/ 2>/dev/null || {
    echo "[BACKUP] ERROR: Failed to create backup"
    exit 1
}

# Get backup size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[BACKUP] Created: $BACKUP_FILE ($BACKUP_SIZE)"

# Clean up old backups (keep last RETENTION_DAYS days)
find "$BACKUP_DIR" -name "onyx_backup_*.tar.gz" -mtime +$RETENTION_DAYS -delete
echo "[BACKUP] Cleaned up backups older than $RETENTION_DAYS days"

# List current backups
echo "[BACKUP] Current backups:"
ls -lh "$BACKUP_DIR"/onyx_backup_*.tar.gz 2>/dev/null || echo "[BACKUP] No backups found"

echo "[BACKUP] Complete at $(date)"
