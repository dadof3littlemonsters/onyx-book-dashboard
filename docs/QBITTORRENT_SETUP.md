# qBittorrent Post-Download Configuration

## Setup Instructions

### 1. Access qBittorrent Settings

1. Open qBittorrent web UI: `http://qbittorrent:8080` (or your configured URL)
2. Go to **Settings** (gear icon) → **Downloads**

### 2. Configure External Program

Scroll to **"Run external program on torrent completion"** and enter:

```bash
docker exec onyx node /app/scripts/process-download.js "%I" "%N" "%F" "%T" "%L"
```

**Parameter Explanation**:
- `%I` = Info hash (unique torrent identifier)
- `%N` = Torrent name
- `%F` = Content path (file or directory)
- `%T` = Tracker URL
- `%L` = Category

### 3. Save Settings

Click **Save** at the bottom of the settings page.

---

## How It Works

### Automatic Processing Flow

1. **Download Completes** → qBittorrent triggers the script
2. **Script Analyzes**:
   - Detects if tracker is MyAnonymouse (MAM)
   - Identifies media type (audiobook vs ebook)
   - Filters out junk files (`.nfo`, `.txt`, etc.)
   - Parses torrent name for author/title

3. **File Operation**:
   - **MAM torrents**: Creates hardlinks (keeps seeding)
   - **Other torrents**: Moves files (stops seeding)

4. **Organization**:
   - Audiobooks → `/mnt/unionfs/Media/Audiobooks/Author Name/Book.m4b`
   - Ebooks → `/mnt/unionfs/Media/Ebooks/Book.epub`

5. **Library Scan**: Triggers Audiobookshelf to scan for new content

6. **Logging**: Records import details in admin panel

---

## Testing

### Manual Test (Existing Download)

Test with the already-downloaded "The Atlas Complex":

```bash
docker exec onyx node /app/scripts/process-download.js \
  "7b42b36d4c31e2c21710078aa6ab373cf4224629" \
  "The Atlas Complex - Olivie Blake.m4b" \
  "/downloads/books/The Atlas Complex - Olivie Blake.m4b" \
  "https://t.myanonamouse.net/tracker.php/..." \
  "books"
```

**Expected Result**:
- Creates hardlink at: `/mnt/unionfs/Media/Audiobooks/Olivie Blake/The Atlas Complex - Olivie Blake.m4b`
- Original file remains in `/downloads/books/` for seeding
- Triggers Audiobookshelf scan
- Logs import in admin panel

---

## Viewing Import Logs

1. Go to Admin Dashboard
2. Click **"📊 Import Log"** in the header
3. View:
   - Import statistics
   - Individual import details
   - Success/failure status
   - MAM vs non-MAM operations
   - Files processed/skipped

---

## Troubleshooting

### Script Not Running

**Check qBittorrent logs**:
```bash
docker logs qbittorrent | grep "external program"
```

**Verify script permissions**:
```bash
docker exec onyx ls -la /app/scripts/process-download.js
```

### Files Not Appearing in Audiobookshelf

1. Check import log for errors
2. Verify paths exist:
   ```bash
   ls -la /mnt/unionfs/Media/Audiobooks/
   ```
3. Manually trigger Audiobookshelf scan
4. Check Audiobookshelf logs

### MAM Torrents Not Seeding

- Verify operation is "hardlink" in import log
- Check qBittorrent shows torrent still active
- Verify file exists in both locations:
  ```bash
  ls -i /downloads/books/file.m4b
  ls -i /Media/Audiobooks/Author/file.m4b
  ```
  (Same inode number = hardlink working)

---

## File Filtering

### Files Kept
- **Audiobooks**: `.m4b`, `.mp3`, `.m4a`, `.flac`, `.ogg`, `.opus`, `.aac`
- **Ebooks**: `.epub`, `.mobi`, `.azw3`, `.pdf`, `.cbz`, `.cbr`
- **Covers**: `cover.jpg`, `cover.png`, `folder.jpg`, `folder.png`

### Files Skipped
- Metadata: `.nfo`, `.txt`, `.opf`, `.xml`
- Images: `.jpg`, `.png` (except covers)
- Torrents: `.torrent`
- Other: `.url`, `.sfv`, `.md5`

---

## Notes

- **MAM Ratio**: Hardlinks preserve seeding without duplicating files
- **Disk Space**: Hardlinks use no additional space (same file, two paths)
- **Multi-file Books**: Folder structure is preserved
- **Author Detection**: Works best with "Title - Author" naming format
