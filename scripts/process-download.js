#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Parse command line arguments from qBittorrent
// %I = Info hash, %N = Name, %F = Content path, %T = Tracker, %L = Category
const [infoHash, torrentName, contentPath, tracker, category] = process.argv.slice(2);
const importOverride = (() => {
    const raw = process.env.IMPORT_OVERRIDE_JSON;
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error(`[WARN] Failed to parse IMPORT_OVERRIDE_JSON: ${error.message}`);
        return null;
    }
})();

// Configuration
const AUDIOBOOK_EXTENSIONS = ['.m4b', '.mp3', '.m4a', '.flac', '.ogg', '.opus', '.aac'];
const EBOOK_EXTENSIONS = ['.epub', '.mobi', '.azw3', '.pdf', '.cbz', '.cbr'];
const SKIP_EXTENSIONS = ['.nfo', '.txt', '.torrent', '.url', '.sfv', '.md5', '.xml'];
const KEEP_IMAGES = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png'];

const AUDIOBOOK_DEST = '/mnt/unionfs/Media/Audiobooks';
const EBOOK_DEST = '/mnt/books/ebooks';
const LOG_FILE = '/app/data/import_log.json';
const MAM_MIN_SEED_HOURS = Number(process.env.MAM_MIN_SEED_HOURS || 72);
const MAM_RATIO_LIMIT = process.env.MAM_RATIO_LIMIT;
const INTERNAL_PROGRESS_URL = process.env.INTERNAL_PROGRESS_URL || 'http://localhost:3000/api/internal/download-progress';

function normalizeForKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.[^.]+$/, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function listFilesRecursive(targetPath) {
    const results = [];
    const stat = fs.statSync(targetPath);

    if (stat.isFile()) {
        results.push(targetPath);
        return results;
    }

    for (const item of fs.readdirSync(targetPath)) {
        const fullPath = path.join(targetPath, item);
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isDirectory()) {
            results.push(...listFilesRecursive(fullPath));
        } else {
            results.push(fullPath);
        }
    }

    return results;
}

function collectAudioFiles(targetPath) {
    return listFilesRecursive(targetPath).filter((file) =>
        AUDIOBOOK_EXTENSIONS.includes(path.extname(file).toLowerCase())
    );
}

function collectEbookFiles(targetPath) {
    return listFilesRecursive(targetPath).filter((file) =>
        EBOOK_EXTENSIONS.includes(path.extname(file).toLowerCase())
    );
}

function collectSiblingImages(audioFile, allFiles) {
    const audioDir = path.dirname(audioFile);
    const audioStem = path.basename(audioFile, path.extname(audioFile));
    return allFiles.filter((file) => {
        if (path.dirname(file) !== audioDir) return false;
        const ext = path.extname(file).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return false;
        const imageStem = path.basename(file, ext);
        return normalizeForKey(imageStem) === normalizeForKey(audioStem);
    });
}

function guessAuthorFromPaths(candidatePaths) {
    const counts = new Map();

    for (const candidatePath of candidatePaths) {
        const parsed = parseTorrentName(path.basename(candidatePath));
        const author = String(parsed.author || '').trim();
        if (!author) continue;
        counts.set(author, (counts.get(author) || 0) + 1);
    }

    let best = null;
    for (const [author, count] of counts.entries()) {
        if (!best || count > best.count) {
            best = { author, count };
        }
    }

    return best?.author || null;
}

function analyzeAudiobookImport(targetPath, parsed) {
    const audioFiles = collectAudioFiles(targetPath);
    const titleKeys = new Set();

    for (const file of audioFiles) {
        const basename = path.basename(file);
        const parsedFile = parseTorrentName(basename);
        const key = normalizeForKey(parsedFile.title || basename);
        if (key) {
            titleKeys.add(key);
        }
    }

    const inferredAuthor = parsed.author || guessAuthorFromPaths([
        targetPath,
        path.dirname(targetPath),
        ...audioFiles
    ]);

    const inferredTitle = parsed.title || path.basename(targetPath);
    const titleWords = normalizeForKey(inferredTitle).split(' ').filter(Boolean);
    const suspiciousTitle = titleWords.length === 0 || (
        titleWords.length <= 2 && titleWords.some((word) => word.length === 1)
    );
    const hasUnknownAuthor = !String(inferredAuthor || '').trim();
    const hasMultipleBookCandidates = titleKeys.size > 1;

    return {
        audioFiles,
        inferredAuthor,
        inferredTitle,
        titleKeys: Array.from(titleKeys),
        suspiciousTitle,
        hasUnknownAuthor,
        hasMultipleBookCandidates
    };
}

function analyzeEbookImport(targetPath, parsed) {
    const ebookFiles = collectEbookFiles(targetPath);
    const titleKeys = new Set();

    for (const file of ebookFiles) {
        const basename = path.basename(file);
        const parsedFile = parseTorrentName(basename);
        const key = normalizeForKey(parsedFile.title || basename);
        if (key) {
            titleKeys.add(key);
        }
    }

    const inferredAuthor = parsed.author || guessAuthorFromPaths([
        targetPath,
        path.dirname(targetPath),
        ...ebookFiles
    ]);

    const inferredTitle = parsed.title || path.basename(targetPath);
    const titleWords = normalizeForKey(inferredTitle).split(' ').filter(Boolean);
    const suspiciousTitle = titleWords.length === 0 || (
        titleWords.length <= 2 && titleWords.some((word) => word.length === 1)
    );
    const hasUnknownAuthor = !String(inferredAuthor || '').trim();
    const hasMultipleBookCandidates = titleKeys.size > 1;

    return {
        ebookFiles,
        inferredAuthor,
        inferredTitle,
        titleKeys: Array.from(titleKeys),
        suspiciousTitle,
        hasUnknownAuthor,
        hasMultipleBookCandidates
    };
}

function importAudiobookPack({ sourceDir, destBase, overrideAuthor, overrideSeries, useHardlink }) {
    const allFiles = listFilesRecursive(sourceDir);
    const audioFiles = allFiles.filter((file) =>
        AUDIOBOOK_EXTENSIONS.includes(path.extname(file).toLowerCase())
    );
    const results = { processed: 0, skipped: 0, errors: [] };

    for (const audioFile of audioFiles) {
        const parsedFile = parseTorrentName(path.basename(audioFile));
        const title = (parsedFile.title || path.basename(audioFile, path.extname(audioFile))).trim();
        const author = (overrideAuthor || parsedFile.author || '').trim();
        const series = (overrideSeries || parsedFile.series || '').trim();

        if (!title || !author) {
            results.errors.push({
                file: path.basename(audioFile),
                error: 'Manual review import could not determine title/author for this file'
            });
            continue;
        }

        const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '_').trim();
        const authorDir = sanitize(author);
        const titleDir = sanitize(title);
        const bookDir = series
            ? path.join(destBase, authorDir, sanitize(series), titleDir)
            : path.join(destBase, authorDir, titleDir);

        const audioDest = path.join(bookDir, path.basename(audioFile));
        const audioResult = processFile(audioFile, audioDest, useHardlink);
        if (audioResult.success) {
            if (audioResult.skipped) {
                results.skipped++;
            } else {
                results.processed++;
            }
        } else {
            results.errors.push({ file: path.basename(audioFile), error: audioResult.error });
        }

        const siblingImages = collectSiblingImages(audioFile, allFiles);
        for (const imageFile of siblingImages) {
            const imageExt = path.extname(imageFile).toLowerCase();
            const coverDest = path.join(bookDir, `cover${imageExt === '.jpeg' ? '.jpg' : imageExt}`);
            const imageResult = processFile(imageFile, coverDest, useHardlink);
            if (imageResult.success) {
                if (imageResult.skipped) {
                    results.skipped++;
                } else {
                    results.processed++;
                }
            } else {
                results.errors.push({ file: path.basename(imageFile), error: imageResult.error });
            }
        }
    }

    return results;
}

function importEbookPack({ sourceDir, destBase, overrideAuthor, overrideSeries, useHardlink }) {
    const allFiles = listFilesRecursive(sourceDir);
    const ebookFiles = allFiles.filter((file) =>
        EBOOK_EXTENSIONS.includes(path.extname(file).toLowerCase())
    );
    const results = { processed: 0, skipped: 0, errors: [] };

    for (const ebookFile of ebookFiles) {
        const parsedFile = parseTorrentName(path.basename(ebookFile));
        const title = (parsedFile.title || path.basename(ebookFile, path.extname(ebookFile))).trim();
        const author = (overrideAuthor || parsedFile.author || '').trim();
        const series = (overrideSeries || parsedFile.series || '').trim();

        if (!title || !author) {
            results.errors.push({
                file: path.basename(ebookFile),
                error: 'Manual review import could not determine title/author for this file'
            });
            continue;
        }

        const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '_').trim();
        const authorDir = sanitize(author);
        const titleDir = sanitize(title);
        const bookDir = series
            ? path.join(destBase, authorDir, sanitize(series), titleDir)
            : path.join(destBase, authorDir, titleDir);

        const ebookDest = path.join(bookDir, path.basename(ebookFile));
        const ebookResult = processFile(ebookFile, ebookDest, useHardlink);
        if (ebookResult.success) {
            if (ebookResult.skipped) {
                results.skipped++;
            } else {
                results.processed++;
            }
        } else {
            results.errors.push({ file: path.basename(ebookFile), error: ebookResult.error });
        }

        const siblingImages = collectSiblingImages(ebookFile, allFiles);
        for (const imageFile of siblingImages) {
            const imageExt = path.extname(imageFile).toLowerCase();
            const coverDest = path.join(bookDir, `cover${imageExt === '.jpeg' ? '.jpg' : imageExt}`);
            const imageResult = processFile(imageFile, coverDest, useHardlink);
            if (imageResult.success) {
                if (imageResult.skipped) {
                    results.skipped++;
                } else {
                    results.processed++;
                }
            } else {
                results.errors.push({ file: path.basename(imageFile), error: imageResult.error });
            }
        }
    }

    return results;
}

// Detect if this is a MyAnonymouse torrent
function isMAM(trackerUrl) {
    return trackerUrl && trackerUrl.includes('myanonamouse.net');
}

// Parse torrent name to extract author and title
function parseTorrentName(name) {
    // Remove file extension if present
    let cleanName = name.replace(/\.[^.]+$/, '');

    // Pattern 0: Z-Library format "Title (Author, First...) (Z-Library)"
    const zlibMatch = cleanName.match(/^(.+?)\s*\(([^)]+)\)\s*\(Z-Library\)/i);
    if (zlibMatch) {
        let title = zlibMatch[1].trim();
        let authorPart = zlibMatch[2].trim().replace(/\.\.\.$/, '');
        // Handle "Last, First" format -> "First Last"
        if (authorPart.includes(',')) {
            const parts = authorPart.split(',').map(p => p.trim());
            if (parts.length >= 2 && parts[0] && parts[1]) {
                authorPart = `${parts[1]} ${parts[0]}`;
            }
        }
        console.log(`[PARSER] Z-Library: Title="${title}" Author="${authorPart}"`);
        return { title, author: authorPart, series: null };
    }

    // Pattern 0b: Z-Library Telegram bot format (underscore-separated, no parens)
    // e.g. "Tress_of_the_Emerald_Sea_Brandon_San_z_library_sk,_1lib_sk,"
    // or "Some_Title_Author_Name_z-lib.org"
    const zlibTelegramMatch = cleanName.match(/^(.+?)_z[_-](?:library|lib)(?:[_,.]|$)/i);
    if (zlibTelegramMatch) {
        const raw = zlibTelegramMatch[1].replace(/_/g, ' ').trim();
        const words = raw.split(' ').filter(Boolean);
        let title, author = null;
        // Drop obvious trailing truncated author fragments, e.g. "... Glass Sar"
        // coming from "Sarah" clipping in Telegram source names.
        if (words.length > 4 && /^[A-Z][a-z]{1,3}$/.test(words[words.length - 1])) {
            words.pop();
        }
        // If last 2 words both start with uppercase they're likely "First Last" author name
        if (words.length > 3) {
            const lastTwo = words.slice(-2);
            if (lastTwo.every(w => /^[A-Z][a-z]{3,}$/.test(w))) {
                author = lastTwo.join(' ');
                title = words.slice(0, -2).join(' ');
            } else {
                title = words.join(' ');
            }
        } else {
            title = words.join(' ');
        }
        console.log(`[PARSER] Z-Library Telegram: Title="${title}" Author="${author || 'null'}"`);
        return { title, author, series: null };
    }

    // Pattern 0c: "(Author Name)" before cleaning
    // Pattern 0c-alt: "Title (Series #N) - Author"
    const titleSeriesAuthorMatch = cleanName.match(/^(.+?)\s*\(([^)]+)\)\s*-\s*(.+)$/);
    if (titleSeriesAuthorMatch) {
        const title = titleSeriesAuthorMatch[1].trim();
        const series = titleSeriesAuthorMatch[2].trim();
        const author = titleSeriesAuthorMatch[3].trim();
        console.log(`[PARSER] Title/Series/Author: Title="${title}" Series="${series}" Author="${author}"`);
        return { title, author, series };
    }

    // Pattern 0d: "(Author Name)" before cleaning
    const parenMatch = cleanName.match(/^(.+?)\s*\(([A-Z][a-z]+[,\s]+[A-Z][^)]*)\)/);
    if (parenMatch) {
        let title = parenMatch[1].trim();
        let authorPart = parenMatch[2].trim().replace(/\.\.\.$/, '');
        if (authorPart.includes(',')) {
            const parts = authorPart.split(',').map(p => p.trim());
            if (parts.length >= 2 && parts[0] && parts[1]) {
                authorPart = `${parts[1]} ${parts[0]}`;
            }
        }
        console.log(`[PARSER] Parenthetical author: Title="${title}" Author="${authorPart}"`);
        return { title, author: authorPart, series: null };
    }

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

// Determine media type (recursively check directories)
function getMediaType(filepath) {
    const stat = fs.statSync(filepath);

    if (stat.isDirectory()) {
        const items = fs.readdirSync(filepath);
        for (const item of items) {
            const result = getMediaType(path.join(filepath, item));
            if (result !== 'unknown') return result;
        }
        return 'unknown';
    }

    const ext = path.extname(filepath).toLowerCase();
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

// Set correct ownership for Audiobookshelf (uid/gid 1000)
function setCorrectOwnership(filePath) {
    try {
        // Audiobookshelf runs as uid/gid 1000 (node user in container, seed on host)
        fs.chownSync(filePath, 1000, 1000);
        console.log(`[CHOWN] Set ownership to 1000:1000 for ${filePath}`);
    } catch (error) {
        // Non-fatal error - log but continue
        console.log(`[WARN] Could not set ownership for ${filePath}: ${error.message}`);
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

        // Set correct ownership for Audiobookshelf to write covers
        setCorrectOwnership(destPath);
        // Also set ownership on parent directory
        setCorrectOwnership(path.dirname(destPath));

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
async function triggerLibraryScan(mediaType = 'audiobook') {
    try {
        const absUrl = process.env.ABS_URL || 'http://audiobookshelf:80';
        const absToken = process.env.ABS_API_KEY;

        if (!absToken) {
            console.log('[WARN] ABS_API_KEY not set, skipping library scan');
            return false;
        }

        // 1. Get libraries
        const libsResponse = await axios.get(`${absUrl}/api/libraries`, {
            headers: { 'Authorization': `Bearer ${absToken}` },
            timeout: 5000
        });

        // Handle both array and wrapped object responses
        const libraries = Array.isArray(libsResponse.data)
            ? libsResponse.data
            : (libsResponse.data.libraries || []);

        if (libraries.length === 0) {
            console.error('[ERROR] No libraries found in Audiobookshelf');
            return false;
        }

        // 2. Find appropriate library based on media type
        let targetLib;
        if (mediaType === 'audiobook') {
            // Look for audiobook library by name or mediaType
            targetLib = libraries.find(l =>
                l.name === 'Audio Books' ||
                l.name === 'Audiobooks' ||
                l.mediaType === 'book'
            ) || libraries[0];
        } else if (mediaType === 'ebook') {
            // Look for ebook library by name or mediaType
            targetLib = libraries.find(l =>
                l.name === 'Ebooks' ||
                l.name === 'E-Books' ||
                l.name === 'Books' ||
                l.mediaType === 'book'
            );

            // If no ebook library found, don't scan (ebooks might be managed by Calibre)
            if (!targetLib) {
                console.log('[INFO] No ebook library found in Audiobookshelf, skipping scan');
                return false;
            }
        }

        if (!targetLib) {
            console.error(`[ERROR] No suitable library found for ${mediaType}`);
            return false;
        }

        console.log(`[INFO] Found Audiobookshelf library: ${targetLib.name} (${targetLib.id}) for ${mediaType}`);

        // 3. Trigger scan for this library
        await axios.post(
            `${absUrl}/api/libraries/${targetLib.id}/scan`,
            { force: true },
            {
                headers: { 'Authorization': `Bearer ${absToken}` },
                timeout: 5000
            }
        );

        console.log(`[SUCCESS] Triggered scan for library "${targetLib.name}"`);
        return true;
    } catch (error) {
        console.error(`[ERROR] Failed to trigger library scan: ${error.message}`);
        if (error.response) {
            console.error(`[ERROR] Response: ${error.response.status} ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

async function emitProgress(stage, payload = {}) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret || !infoHash) return;

    try {
        await axios.post(
            INTERNAL_PROGRESS_URL,
            {
                hash: infoHash,
                title: torrentName,
                stage,
                ...payload
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-onyx-webhook-secret': secret
                },
                timeout: 3000
            }
        );
    } catch (_) {
        // Best-effort only; never fail the import pipeline because of UI progress updates.
    }
}

async function getQbitAuthCookie() {
    const qbitUrl = process.env.QBIT_URL || 'http://qbittorrent:8080';
    const qbitUser = (process.env.QBIT_USER || '').trim();
    const qbitPass = (process.env.QBIT_PASS || '').trim();

    if (!qbitUser || !qbitPass) {
        throw new Error('Missing qBittorrent credentials (QBIT_USER/QBIT_PASS)');
    }

    const response = await axios.post(
        `${qbitUrl}/api/v2/auth/login`,
        new URLSearchParams({
            username: qbitUser,
            password: qbitPass
        }),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        }
    );

    const setCookie = response.headers['set-cookie'];
    if (!setCookie || !setCookie[0]) {
        throw new Error('qBittorrent authentication did not return a cookie');
    }

    return { cookie: setCookie[0], qbitUrl };
}

async function applyMamShareLimits(torrentHash) {
    const seedingSeconds = Math.max(0, Math.floor(MAM_MIN_SEED_HOURS * 3600));
    const ratioLimit = Number.isFinite(Number(MAM_RATIO_LIMIT))
        ? Number(MAM_RATIO_LIMIT)
        : -2; // Keep qBittorrent global ratio when unset

    if (!torrentHash) {
        console.log('[WARN] Cannot set MAM share limits: missing torrent hash');
        return false;
    }

    try {
        const { cookie, qbitUrl } = await getQbitAuthCookie();

        await axios.post(
            `${qbitUrl}/api/v2/torrents/setShareLimits`,
            new URLSearchParams({
                hashes: torrentHash,
                ratioLimit: String(ratioLimit),
                seedingTimeLimit: String(seedingSeconds),
                inactiveSeedingTimeLimit: '-2'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookie
                },
                timeout: 10000
            }
        );

        console.log(`[QBIT] Applied MAM share limits to ${torrentHash}: seedingTimeLimit=${seedingSeconds}s ratioLimit=${ratioLimit}`);
        return true;
    } catch (error) {
        console.error(`[WARN] Failed to apply MAM share limits: ${error.message}`);
        return false;
    }
}

async function removeTorrentFromQbit(torrentHash) {
    if (!torrentHash) {
        console.log('[WARN] Cannot remove torrent: missing torrent hash');
        return false;
    }

    try {
        const { cookie, qbitUrl } = await getQbitAuthCookie();

        await axios.post(
            `${qbitUrl}/api/v2/torrents/delete`,
            new URLSearchParams({
                hashes: torrentHash,
                deleteFiles: 'true'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': cookie
                },
                timeout: 10000
            }
        );

        console.log(`[QBIT] Removed non-MAM torrent and data: ${torrentHash}`);
        return true;
    } catch (error) {
        console.error(`[WARN] Failed to remove non-MAM torrent ${torrentHash}: ${error.message}`);
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
    await emitProgress('processing_started', {
        status: 'processing',
        message: 'Post-download processing started'
    });

    const stat = fs.statSync(contentPath);
    const isDirectory = stat.isDirectory();

    // Determine media type (getMediaType handles directories recursively)
    const mediaType = getMediaType(contentPath);

    console.log(`[INFO] Media type: ${mediaType}`);
    await emitProgress('media_detected', {
        status: 'processing',
        message: `Detected media type: ${mediaType}`
    });

    // Determine destination base
    const destBase = mediaType === 'audiobook' ? AUDIOBOOK_DEST : EBOOK_DEST;

    // Parse torrent name for organization
    const parsed = parseTorrentName(torrentName);
    console.log(`[INFO] Parsed - Title: ${parsed.title}, Author: ${parsed.author || 'Unknown'}`);

    let importGuard = null;
    if (mediaType === 'audiobook') {
        importGuard = analyzeAudiobookImport(contentPath, parsed);
        console.log(
            `[INFO] Audiobook analysis: files=${importGuard.audioFiles.length}, ` +
            `distinctTitles=${importGuard.titleKeys.length}, ` +
            `inferredAuthor=${importGuard.inferredAuthor || 'Unknown'}, ` +
            `suspiciousTitle=${importGuard.suspiciousTitle}`
        );
    } else if (mediaType === 'ebook') {
        importGuard = analyzeEbookImport(contentPath, parsed);
        console.log(
            `[INFO] Ebook analysis: files=${importGuard.ebookFiles.length}, ` +
            `distinctTitles=${importGuard.titleKeys.length}, ` +
            `inferredAuthor=${importGuard.inferredAuthor || 'Unknown'}, ` +
            `suspiciousTitle=${importGuard.suspiciousTitle}`
        );
    }

    if (importGuard) {
        const guardReasons = [];
        if (importGuard.hasUnknownAuthor) {
            guardReasons.push('author could not be determined confidently');
        }
        if (importGuard.hasMultipleBookCandidates) {
            guardReasons.push('payload looks like multiple books, not a single import');
        }
        if (importGuard.suspiciousTitle) {
            guardReasons.push('title parsed to a suspiciously short value');
        }

        if (guardReasons.length > 0 && !importOverride?.forceImport) {
            const reasonText = guardReasons.join('; ');
            console.error(`[GUARD] Refusing ${mediaType} auto-import: ${reasonText}`);
            await emitProgress('manual_review_required', {
                status: 'failed',
                stage: 'manual_review_required',
                message: `Manual review required: ${reasonText}`,
                error: reasonText
            });

            logImport({
                operation,
                sourcePath: contentPath,
                destPath: null,
                mediaType,
                status: 'manual_review_required',
                filesProcessed: 0,
                filesSkipped: 0,
                errors: [{ file: path.basename(contentPath), error: reasonText }],
                scanTriggered: false,
                mamLimitsApplied: false,
                mamMinSeedHours: useHardlink ? MAM_MIN_SEED_HOURS : null,
                nonMamTorrentRemoved: false
            });

            process.exit(2);
        }
    }

    // Build destination path using Audiobookshelf convention: Author/[Series/]Title/files
    let destPath;
    const author = (importOverride?.author || (importGuard && importGuard.inferredAuthor) || parsed.author || 'Unknown Author').trim();
    const title = (importOverride?.title || (importGuard && importGuard.inferredTitle) || parsed.title || torrentName).trim();
    const series = (importOverride?.series || parsed.series || null);

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
    await emitProgress('moving_files', {
        status: 'processing',
        message: `Moving files to library destination`,
        progressPct: 100
    });


    // Process files
    let results;
    const shouldUsePackImport = Boolean(
        isDirectory &&
        importOverride?.forceImport &&
        importGuard?.hasMultipleBookCandidates
    );

    if (shouldUsePackImport && mediaType === 'audiobook') {
        results = importAudiobookPack({
            sourceDir: contentPath,
            destBase,
            overrideAuthor: author,
            overrideSeries: series,
            useHardlink
        });
    } else if (shouldUsePackImport && mediaType === 'ebook') {
        results = importEbookPack({
            sourceDir: contentPath,
            destBase,
            overrideAuthor: author,
            overrideSeries: series,
            useHardlink
        });
    } else if (isDirectory) {
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
    await emitProgress('processing_summary', {
        status: results.errors.length === 0 ? 'processing' : 'failed',
        message: `Processed ${results.processed}, skipped ${results.skipped}, errors ${results.errors.length}`,
        filesProcessed: results.processed,
        filesSkipped: results.skipped,
        error: results.errors.length > 0 ? 'Processing errors detected' : null
    });

    // Only apply MAM share limits after a successful import run.
    // This ensures qBittorrent only removes source data after the library copy/link is in place.
    let mamLimitsApplied = false;
    if (useHardlink && mediaType !== 'unknown' && results.errors.length === 0) {
        mamLimitsApplied = await applyMamShareLimits(infoHash);
        await emitProgress('mam_limits_applied', {
            status: 'processing',
            message: mamLimitsApplied ? `Applied MAM seed limit (${MAM_MIN_SEED_HOURS}h)` : 'Failed to apply MAM seed limits'
        });
    }

    // Trigger library scan if successful (for both audiobooks and ebooks)
    let scanTriggered = false;
    if (results.processed > 0 && (mediaType === 'audiobook' || mediaType === 'ebook')) {
        scanTriggered = await triggerLibraryScan(mediaType);
        await emitProgress('abs_scan', {
            status: scanTriggered ? 'scanning' : 'processing',
            stage: scanTriggered ? 'abs_scan_triggered' : 'abs_scan_failed',
            message: scanTriggered ? 'Audiobookshelf scan triggered' : 'Audiobookshelf scan trigger failed',
            scanTriggered
        });
    }

    // For non-MAM torrents, remove torrent+download data after successful import and scan trigger.
    let nonMamTorrentRemoved = false;
    if (!useHardlink && mediaType !== 'unknown' && results.errors.length === 0 && (results.processed > 0 || results.skipped > 0)) {
        nonMamTorrentRemoved = await removeTorrentFromQbit(infoHash);
        await emitProgress('non_mam_cleanup', {
            status: 'processing',
            message: nonMamTorrentRemoved ? 'Removed non-MAM torrent and source data' : 'Failed to remove non-MAM torrent/source data'
        });
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
        scanTriggered,
        mamLimitsApplied,
        mamMinSeedHours: useHardlink ? MAM_MIN_SEED_HOURS : null,
        nonMamTorrentRemoved
    });

    console.log('[DONE] Processing complete');
    await emitProgress('completed', {
        status: results.errors.length === 0 ? 'completed' : 'failed',
        stage: results.errors.length === 0 ? 'completed' : 'failed',
        message: results.errors.length === 0 ? 'Import and processing complete' : 'Import completed with errors',
        scanConfirmed: scanTriggered
    });
    process.exit(results.errors.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error('[FATAL]', error);
    emitProgress('failed', {
        status: 'failed',
        stage: 'failed',
        message: `Fatal processing error: ${error.message}`,
        error: error.message
    }).finally(() => process.exit(1));
});
