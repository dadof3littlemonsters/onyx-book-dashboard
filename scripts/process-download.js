#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Parse command line arguments from qBittorrent
// %I = Info hash, %N = Name, %F = Content path, %T = Tracker, %L = Category
const [infoHash, torrentName, contentPath, tracker, category] = process.argv.slice(2);

// Configuration
const AUDIOBOOK_EXTENSIONS = ['.m4b', '.mp3', '.m4a', '.flac', '.ogg', '.opus', '.aac'];
const EBOOK_EXTENSIONS = ['.epub', '.mobi', '.azw3', '.pdf', '.cbz', '.cbr'];
const SKIP_EXTENSIONS = ['.nfo', '.txt', '.torrent', '.url', '.sfv', '.md5', '.xml'];
const KEEP_IMAGES = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png'];

const AUDIOBOOK_DEST = '/mnt/books/audiobooks';
const EBOOK_DEST = '/mnt/books/ebooks';
const LOG_FILE = '/app/data/import_log.json';

// Detect if this is a MyAnonymouse torrent
function isMAM(trackerUrl) {
    return trackerUrl && trackerUrl.includes('myanonamouse.net');
}

// Parse torrent name to extract author and title
function parseTorrentName(name) {
    // Remove file extension if present
    let cleanName = name.replace(/\.[^.]+$/, '');

    // Remove common suffixes like (Unabridged), [MP3], {2020}, etc.
    cleanName = cleanName.replace(/\s*[\[\({\<][^\]\)}\>]*[\]\)}\>]\s*/g, ' ').trim();

    // Pattern 1: "Author - Title" (most common for books)
    // Pattern 2: "Author - Series ## - Title"
    // Pattern 3: "Title - Author"

    const dashMatch = cleanName.match(/^(.+?)\s*-\s*(.+)$/);

    if (dashMatch) {
        const [, part1, part2] = dashMatch;

        // Check if part2 has another dash (series pattern: "Author - Series 01 - Title")
        const part2Dash = part2.match(/^(.+?)\s*-\s*(.+)$/);
        if (part2Dash) {
            // Assume: Author - Series - Title
            return {
                author: part1.trim(),
                title: part2Dash[2].trim(),
                series: part2Dash[1].trim()
            };
        }

        // Heuristic: If part1 looks like author name (2-4 words, capitalized)
        const part1Words = part1.trim().split(/\s+/);
        const part2Words = part2.trim().split(/\s+/);

        // Check if part1 looks like an author (short, capitalized words)
        const looksLikeAuthor = (words) => {
            if (words.length < 2 || words.length > 4) return false;
            // Authors typically have capitalized names
            return words.every(w => /^[A-Z]/.test(w));
        };

        if (looksLikeAuthor(part1Words) && part2Words.length > 2) {
            // Part1 is author, part2 is title
            return { title: part2.trim(), author: part1.trim() };
        } else if (looksLikeAuthor(part2Words) && part1Words.length > 2) {
            // Part2 is author, part1 is title
            return { title: part1.trim(), author: part2.trim() };
        } else {
            // Default: assume "Author - Title" format (more common for torrent uploads)
            return { title: part2.trim(), author: part1.trim() };
        }
    }

    // No dash found - use as title only
    return { title: cleanName, author: null };
}


// Check if file should be processed
function shouldProcessFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    const basename = path.basename(filename).toLowerCase();

    // Keep audiobook/ebook files
    if (AUDIOBOOK_EXTENSIONS.includes(ext) || EBOOK_EXTENSIONS.includes(ext)) {
        return true;
    }

    // Keep specific cover images
    if (KEEP_IMAGES.includes(basename)) {
        return true;
    }

    // Skip everything else
    return false;
}

// Determine media type
function getMediaType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (AUDIOBOOK_EXTENSIONS.includes(ext)) return 'audiobook';
    if (EBOOK_EXTENSIONS.includes(ext)) return 'ebook';
    return 'unknown';
}

// Create directory if it doesn't exist
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Process a single file
function processFile(sourcePath, destPath, useHardlink) {
    try {
        ensureDir(path.dirname(destPath));

        if (fs.existsSync(destPath)) {
            console.log(`[SKIP] File already exists: ${destPath}`);
            return { success: true, skipped: true };
        }

        if (useHardlink) {
            try {
                fs.linkSync(sourcePath, destPath);
                console.log(`[HARDLINK] ${sourcePath} -> ${destPath}`);
            } catch (linkError) {
                // If hardlink fails due to cross-device (EXDEV), fall back to copy
                if (linkError.code === 'EXDEV') {
                    console.log(`[WARN] Cross-device hardlink not supported, using copy instead`);
                    fs.copyFileSync(sourcePath, destPath);
                    console.log(`[COPY] ${sourcePath} -> ${destPath} (MAM - keeps seeding)`);
                } else {
                    throw linkError;
                }
            }
        } else {
            try {
                fs.renameSync(sourcePath, destPath);
                console.log(`[MOVE] ${sourcePath} -> ${destPath}`);
            } catch (moveError) {
                // If rename fails due to cross-device (EXDEV), use copy + delete
                if (moveError.code === 'EXDEV') {
                    console.log(`[WARN] Cross-device move not supported, using copy + delete`);
                    fs.copyFileSync(sourcePath, destPath);
                    fs.unlinkSync(sourcePath);
                    console.log(`[COPY+DELETE] ${sourcePath} -> ${destPath}`);
                } else {
                    throw moveError;
                }
            }
        }

        return { success: true, skipped: false };
    } catch (error) {
        console.error(`[ERROR] Failed to process ${sourcePath}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Process directory recursively
function processDirectory(sourceDir, destDir, useHardlink) {
    const results = { processed: 0, skipped: 0, errors: [] };

    const items = fs.readdirSync(sourceDir);

    for (const item of items) {
        const sourcePath = path.join(sourceDir, item);
        const stat = fs.statSync(sourcePath);

        if (stat.isDirectory()) {
            const subResults = processDirectory(
                sourcePath,
                path.join(destDir, item),
                useHardlink
            );
            results.processed += subResults.processed;
            results.skipped += subResults.skipped;
            results.errors.push(...subResults.errors);
        } else if (shouldProcessFile(item)) {
            const result = processFile(
                sourcePath,
                path.join(destDir, item),
                useHardlink
            );

            if (result.success) {
                if (result.skipped) {
                    results.skipped++;
                } else {
                    results.processed++;
                }
            } else {
                results.errors.push({ file: item, error: result.error });
            }
        } else {
            console.log(`[SKIP] Filtered out: ${item}`);
            results.skipped++;
        }
    }

    return results;
}

// Trigger Audiobookshelf library scan
async function triggerLibraryScan() {
    try {
        const absUrl = process.env.ABS_URL || 'http://audiobookshelf:13378';
        const absToken = process.env.ABS_API_KEY;

        if (!absToken) {
            console.log('[WARN] ABS_API_KEY not set, skipping library scan');
            return false;
        }

        const response = await axios.post(
            `${absUrl}/api/libraries/scan`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${absToken}`
                },
                timeout: 5000
            }
        );

        console.log('[SUCCESS] Triggered Audiobookshelf library scan');
        return true;
    } catch (error) {
        console.error(`[ERROR] Failed to trigger library scan: ${error.message}`);
        return false;
    }
}

// Log import result
function logImport(result) {
    try {
        let log = { imports: [] };

        if (fs.existsSync(LOG_FILE)) {
            log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }

        log.imports.unshift({
            id: `${Date.now()}-${infoHash}`,
            torrentHash: infoHash,
            torrentName,
            tracker,
            category,
            ...result,
            timestamp: new Date().toISOString()
        });

        // Keep only last 100 imports
        log.imports = log.imports.slice(0, 100);

        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
        console.log('[LOG] Import logged successfully');
    } catch (error) {
        console.error(`[ERROR] Failed to log import: ${error.message}`);
    }
}

// Main processing function
async function main() {
    console.log('=== Onyx Post-Download Processor ===');
    console.log(`Torrent: ${torrentName}`);
    console.log(`Path: ${contentPath}`);
    console.log(`Tracker: ${tracker}`);
    console.log(`Category: ${category}`);

    if (!contentPath || !fs.existsSync(contentPath)) {
        console.error('[ERROR] Content path does not exist');
        process.exit(1);
    }

    const useHardlink = isMAM(tracker);
    const operation = useHardlink ? 'hardlink' : 'move';
    console.log(`[INFO] Operation: ${operation} (MAM: ${useHardlink})`);

    const stat = fs.statSync(contentPath);
    const isDirectory = stat.isDirectory();

    // Determine media type from first file
    let mediaType = 'unknown';
    if (isDirectory) {
        const files = fs.readdirSync(contentPath);
        for (const file of files) {
            mediaType = getMediaType(file);
            if (mediaType !== 'unknown') break;
        }
    } else {
        mediaType = getMediaType(contentPath);
    }

    console.log(`[INFO] Media type: ${mediaType}`);

    // Determine destination base
    const destBase = mediaType === 'audiobook' ? AUDIOBOOK_DEST : EBOOK_DEST;

    // Parse torrent name for organization
    const parsed = parseTorrentName(torrentName);
    console.log(`[INFO] Parsed - Title: ${parsed.title}, Author: ${parsed.author || 'Unknown'}`);

    // Build destination path using Audiobookshelf convention: Author/[Series/]Title/files
    let destPath;
    const author = parsed.author || 'Unknown Author';
    const title = parsed.title || torrentName;
    const series = parsed.series || null;

    // Sanitize folder names (remove invalid characters)
    const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '_').trim();
    const authorDir = sanitize(author);
    const titleDir = sanitize(title);
    const seriesDir = series ? sanitize(series) : null;

    // Build path: Author/Series/Title/ or Author/Title/
    let basePath;
    if (seriesDir) {
        basePath = path.join(destBase, authorDir, seriesDir, titleDir);
        console.log(`[INFO] Series detected: ${series}`);
    } else {
        basePath = path.join(destBase, authorDir, titleDir);
    }

    if (isDirectory) {
        // For directories: just use the base path
        destPath = basePath;
    } else {
        // For single files: basePath/filename
        destPath = path.join(basePath, path.basename(contentPath));
    }

    console.log(`[INFO] Destination: ${destPath}`);
    console.log(`[INFO] Structure: Author="${author}" | Series="${series || 'none'}" | Title="${title}"`);


    // Process files
    let results;
    if (isDirectory) {
        results = processDirectory(contentPath, destPath, useHardlink);
    } else {
        const result = processFile(contentPath, destPath, useHardlink);
        results = {
            processed: result.success && !result.skipped ? 1 : 0,
            skipped: result.skipped ? 1 : 0,
            errors: result.success ? [] : [{ file: path.basename(contentPath), error: result.error }]
        };
    }

    console.log(`[SUMMARY] Processed: ${results.processed}, Skipped: ${results.skipped}, Errors: ${results.errors.length}`);

    // Trigger library scan if successful
    let scanTriggered = false;
    if (results.processed > 0 && mediaType === 'audiobook') {
        scanTriggered = await triggerLibraryScan();
    }

    // Log the import
    logImport({
        operation,
        sourcePath: contentPath,
        destPath,
        mediaType,
        status: results.errors.length === 0 ? 'success' : 'partial',
        filesProcessed: results.processed,
        filesSkipped: results.skipped,
        errors: results.errors,
        scanTriggered
    });

    console.log('[DONE] Processing complete');
    process.exit(results.errors.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error('[FATAL]', error);
    process.exit(1);
});
