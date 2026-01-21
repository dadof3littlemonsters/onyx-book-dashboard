#!/usr/bin/env node

/**
 * Ebook Reorganizer Script
 * Reorganizes flat ebook files into Audiobookshelf folder structure:
 * Author/Title/file.epub
 */

const fs = require('fs');
const path = require('path');

// Configuration
const EBOOK_DIR = process.argv[2] || '/mnt/books/ebooks';
const DRY_RUN = process.argv.includes('--dry-run');
const EBOOK_EXTENSIONS = ['.epub', '.mobi', '.azw3', '.pdf', '.cbz', '.cbr'];

console.log('=== Ebook Reorganizer ===');
console.log(`Source Directory: ${EBOOK_DIR}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will move files)'}`);
console.log('');

// Parse filename to extract author and title
function parseFilename(filename) {
    // Remove extension
    let name = filename.replace(/\.[^.]+$/, '');

    let author = null;
    let title = null;

    // Pattern 0: Check for author in first parentheses like "Title (Author Name)" BEFORE cleaning
    const parenAuthorMatch = name.match(/^(.+?)\s*\(([A-Z][a-z]+ [A-Z][a-z]+)\)/);
    if (parenAuthorMatch) {
        title = parenAuthorMatch[1].trim();
        author = parenAuthorMatch[2].trim();
        return { author, title };
    }

    // Remove common suffixes like (Z-Library), [Unabridged], etc.
    name = name.replace(/\s*[\[\(][^\]\)]*[\]\)]\s*/g, ' ').trim();

    // Pattern 1: "Title - Author" (most common for ebooks)
    const dashMatch = name.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
        const [, part1, part2] = dashMatch;

        // Check if part2 looks like an author (2-4 capitalized words)
        const part2Words = part2.trim().split(/\s+/);
        const part1Words = part1.trim().split(/\s+/);

        const looksLikeAuthor = (words) => {
            if (words.length < 2 || words.length > 4) return false;
            return words.every(w => /^[A-Z]/.test(w));
        };

        if (looksLikeAuthor(part2Words)) {
            title = part1.trim();
            author = part2.trim();
        } else if (looksLikeAuthor(part1Words)) {
            title = part2.trim();
            author = part1.trim();
        } else {
            // Default: assume "Title - Author" since that's common for downloads
            title = part1.trim();
            author = part2.trim();
        }
    }

    // Pattern 2: "Title by Author"
    if (!author) {
        const byMatch = name.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
            title = byMatch[1].trim();
            author = byMatch[2].trim();
        }
    }

    // If no pattern matched, use filename as title
    if (!title) {
        title = name;
    }

    return { author, title };
}

// Sanitize folder names
function sanitize(str) {
    return str.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Main function
function reorganize() {
    if (!fs.existsSync(EBOOK_DIR)) {
        console.error(`Error: Directory does not exist: ${EBOOK_DIR}`);
        process.exit(1);
    }

    const items = fs.readdirSync(EBOOK_DIR);
    const stats = { moved: 0, skipped: 0, errors: [] };

    for (const item of items) {
        const sourcePath = path.join(EBOOK_DIR, item);
        const stat = fs.statSync(sourcePath);

        // Skip directories (already organized)
        if (stat.isDirectory()) {
            console.log(`[SKIP] Already a folder: ${item}`);
            stats.skipped++;
            continue;
        }

        // Check if it's an ebook file
        const ext = path.extname(item).toLowerCase();
        if (!EBOOK_EXTENSIONS.includes(ext)) {
            console.log(`[SKIP] Not an ebook: ${item}`);
            stats.skipped++;
            continue;
        }

        // Parse the filename
        const parsed = parseFilename(item);

        if (!parsed.author) {
            console.log(`[WARN] Could not detect author: ${item}`);
            parsed.author = 'Unknown Author';
        }

        // Build destination path
        const authorDir = sanitize(parsed.author);
        const titleDir = sanitize(parsed.title);
        const destDir = path.join(EBOOK_DIR, authorDir, titleDir);
        const destPath = path.join(destDir, item);

        console.log(`[${DRY_RUN ? 'WOULD MOVE' : 'MOVE'}] ${item}`);
        console.log(`    -> ${authorDir}/${titleDir}/${item}`);

        if (!DRY_RUN) {
            try {
                // Create directory structure
                fs.mkdirSync(destDir, { recursive: true });

                // Copy then delete (works across mergerfs branches)
                fs.copyFileSync(sourcePath, destPath);
                fs.unlinkSync(sourcePath);
                stats.moved++;
            } catch (error) {
                console.error(`    [ERROR] ${error.message}`);
                stats.errors.push({ file: item, error: error.message });
            }
        } else {
            stats.moved++;
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Files ${DRY_RUN ? 'to move' : 'moved'}: ${stats.moved}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (DRY_RUN && stats.moved > 0) {
        console.log('\nTo apply changes, run without --dry-run:');
        console.log(`  node ${process.argv[1]} ${EBOOK_DIR}`);
    }
}

reorganize();
