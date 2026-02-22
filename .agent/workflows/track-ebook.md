---
description: Track ebook download from Audiobookbay to Audiobookshelf
---

# Track Ebook Download Pipeline

This workflow helps you monitor an ebook/audiobook download from Audiobookbay through the complete Onyx pipeline to ensure it ends up in your Audiobookshelf library.

## Quick Start

Use the automated tracking script:

```bash
cd /opt/onyx/scripts
./track-download.sh "Book Title"
```

For real-time monitoring of an active download:

```bash
./track-download.sh --follow "Book Title"
```

## Pipeline Overview

Your downloads go through these stages:

1. **qBittorrent Download** → `/mnt/unionfs/downloads/books/`
2. **Webhook Trigger** → `/srv/scripts/qbit-webhook.sh`
3. **Processing** → Docker container runs `/app/scripts/process-download.js`
4. **File Organization** → Moved to `Author/Title/` structure
5. **Destination** → Audiobooks: `/mnt/unionfs/Media/Audiobooks/` or Ebooks: `/mnt/books/ebooks/`
6. **Import Log** → Logged to `/opt/onyx/data/import_log.json`
7. **Library Scan** → Audiobookshelf automatically scans (audiobooks only)

## Manual Tracking Steps

### 1. Check qBittorrent

```bash
# Access qBittorrent web UI
# Default: http://localhost:8080
# Look for your download in the "books" category
```

### 2. Monitor Webhook Log

```bash
# Watch for webhook triggers
tail -f /tmp/qbit-webhook.log

# Search for specific download
grep -i "book title" /tmp/qbit-webhook.log
```

### 3. Check Processing Logs

```bash
# View recent Docker container logs
docker logs onyx --tail 50

# Follow logs in real-time
docker logs -f onyx

# Search for specific download
docker logs onyx 2>&1 | grep -i "book title"
```

### 4. Verify Import Log

```bash
# View recent imports
cat /opt/onyx/data/import_log.json | jq '.imports[0:5]'

# Search for specific download
cat /opt/onyx/data/import_log.json | jq '.imports[] | select(.torrentName | test("book title"; "i"))'
```

### 5. Check File Location

```bash
# For audiobooks
ls -lah /mnt/unionfs/Media/Audiobooks/

# For ebooks
ls -lah /mnt/books/ebooks/

# Search for specific file
find /mnt/unionfs/Media/Audiobooks/ -iname "*book title*"
find /mnt/books/ebooks/ -iname "*book title*"
```

### 6. Verify Audiobookshelf

- Open Audiobookshelf web interface
- Check the appropriate library (Audiobooks or Ebooks)
- Search for the book title or author
- For audiobooks, the scan should trigger automatically
- For ebooks, you may need to manually trigger a scan

## Troubleshooting

### Download stuck in qBittorrent

```bash
# Check qBittorrent logs
docker logs qbittorrent --tail 50

# Verify download path is accessible
ls -lah /mnt/unionfs/downloads/books/
```

### Webhook not triggering

```bash
# Check webhook script exists and is executable
ls -lah /srv/scripts/qbit-webhook.sh

# Verify qBittorrent webhook configuration
# Settings → Downloads → Run external program on torrent completion
# Should be: /srv/scripts/qbit-webhook.sh "%I" "%N" "%F" "%T" "%L"
```

### Processing errors

```bash
# Check Docker container is running
docker ps | grep onyx

# View detailed processing logs
docker logs onyx 2>&1 | grep -A 20 "ERROR"

# Check import log for errors
cat /opt/onyx/data/import_log.json | jq '.imports[] | select(.status == "partial")'
```

### File not appearing in destination

```bash
# Check disk space
df -h /mnt/unionfs/Media/Audiobooks/
df -h /mnt/books/ebooks/

# Check permissions
ls -lah /mnt/unionfs/Media/Audiobooks/
ls -lah /mnt/books/ebooks/

# Verify mergerfs is mounted
mount | grep mergerfs
```

### Audiobookshelf not showing the book

```bash
# Manually trigger library scan via Audiobookshelf UI
# Or use the API (requires ABS_API_KEY)

# Check Audiobookshelf logs
docker logs audiobookshelf --tail 50

# Verify file permissions
ls -lah /mnt/unionfs/Media/Audiobooks/Author/Title/
```

## Advanced: Reorganize Flat Ebooks

If you have ebooks that weren't automatically organized:

```bash
# Dry run (preview changes)
node /opt/onyx/scripts/reorganize-ebooks.js /mnt/books/ebooks --dry-run

# Apply changes
node /opt/onyx/scripts/reorganize-ebooks.js /mnt/books/ebooks
```

## Key Files and Paths

| Component | Path |
|-----------|------|
| Download directory | `/mnt/unionfs/downloads/books/` |
| Audiobook library | `/mnt/unionfs/Media/Audiobooks/` |
| Ebook library | `/mnt/books/ebooks/` |
| Import log | `/opt/onyx/data/import_log.json` |
| Webhook log | `/tmp/qbit-webhook.log` |
| Processing script | `/opt/onyx/scripts/process-download.js` |
| Webhook script | `/srv/scripts/qbit-webhook.sh` |
| Tracking script | `/opt/onyx/scripts/track-download.sh` |
| Reorganize script | `/opt/onyx/scripts/reorganize-ebooks.js` |

## Notes

- **MyAnonymouse torrents** use hardlinks (keeps seeding)
- **Other torrents** are moved (stops seeding)
- **Audiobooks** trigger automatic Audiobookshelf scans
- **Ebooks** may require manual library scans
- Files are organized as: `Author/Title/files` or `Author/Series/Title/files`
