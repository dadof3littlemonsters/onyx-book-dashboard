#!/usr/bin/env node
/**
 * Deep-clean script for discovery_cache.json.
 *
 * Steps (in order):
 *   1. Load discovery_cache.json
 *   2. Run the expanded bookValidator against every book — drop invalid entries
 *   3. Within-genre deduplication by normalised title+author
 *   4. Cross-genre deduplication:
 *        – books appearing in exactly 1 or 2 genres are kept as-is
 *        – books appearing in 3+ genres are kept ONLY in the single
 *          highest-priority genre (priority = GENRE_PRIORITY order below)
 *   5. Log every removal with its reason
 *   6. Save the cleaned cache back to disk
 *   7. Print a before/after summary per genre
 *
 * Usage:  node scripts/deep-clean-cache.js
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');
const { validateBook } = require('../server/utils/bookValidator');

const CACHE_PATH = path.join(__dirname, '../data/discovery_cache.json');

/**
 * Genre priority order (most specific / focused first).
 * When a book appears in 3+ genres it is retained only in the
 * highest-priority genre that contains it.
 */
const GENRE_PRIORITY = [
  'romantasy',
  'fantasy',
  'scifi',
  'dark_fantasy',
  'cozy_fantasy',
  'enemies_to_lovers',
  'action_adventure',
  'dragons',
  'fairy_tale_retellings',
  'post_apocalyptic',
  'booktok_trending',
  'popular',
  'new_releases',
  'hidden_gems',
  'awards',
];

// ── helpers ──────────────────────────────────────────────────────────────────

/** Normalised title+author key, mirrors discoveryCache and googleBooksApi logic */
function normKey(book) {
  const t = (book.title || '')
    .toLowerCase()
    .replace(/\s*[:|-]\s*.*/u, '')   // strip subtitle
    .replace(/[^\w\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const a = (
    Array.isArray(book.authors) ? (book.authors[0] || '') : (book.author || '')
  )
    .toLowerCase()
    .replace(/[^\w\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${t}|${a}`;
}

/** Stable book identity key: prefer isbn13, fall back to norm key */
function bookId(book) {
  return book.isbn13 || normKey(book);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[DeepClean] Reading cache: ${CACHE_PATH}`);

  let raw;
  try { raw = await fs.readFile(CACHE_PATH, 'utf8'); }
  catch (err) { console.error(`[DeepClean] Cannot read cache: ${err.message}`); process.exit(1); }

  let cache;
  try { cache = JSON.parse(raw); }
  catch (err) { console.error(`[DeepClean] Invalid JSON: ${err.message}`); process.exit(1); }

  if (!cache.genres || typeof cache.genres !== 'object') {
    console.error('[DeepClean] Cache has no genres field, aborting.');
    process.exit(1);
  }

  const removals = [];   // { genre, title, reason }
  const beforeCounts = {};
  const afterCounts  = {};

  // ── Step 1: validation + within-genre dedup ──────────────────────────────

  for (const [genre, books] of Object.entries(cache.genres)) {
    if (!Array.isArray(books)) continue;
    beforeCounts[genre] = books.length;

    const kept   = [];
    const seenId = new Map();   // bookId → true (within this genre)

    for (const book of books) {
      // 2a. Validator
      const v = validateBook(book);
      if (!v.valid) {
        removals.push({ genre, title: book.title, reason: `Validator: ${v.reason}` });
        continue;
      }

      // 2b. Within-genre dedup (prefer higher rating when colliding)
      const id = bookId(book);
      if (seenId.has(id)) {
        removals.push({ genre, title: book.title, reason: 'Within-genre duplicate' });
        continue;
      }

      seenId.set(id, true);
      kept.push(book);
    }

    cache.genres[genre] = kept;
  }

  // ── Step 2: cross-genre dedup ────────────────────────────────────────────
  // Build a map: bookId → [ genre, ... ]  (using the post-validation books)

  const bookGenres = new Map();   // bookId → [genre, ...]

  for (const [genre, books] of Object.entries(cache.genres)) {
    for (const book of books) {
      const id = bookId(book);
      if (!bookGenres.has(id)) bookGenres.set(id, []);
      bookGenres.get(id).push(genre);
    }
  }

  // Collect books that appear in 3+ genres
  const crossDupes = new Map();  // bookId → winnerGenre
  for (const [id, genres] of bookGenres.entries()) {
    if (genres.length <= 2) continue;

    // Pick the winner: the genre with the lowest index in GENRE_PRIORITY
    let winner = genres[0];
    let winnerPriority = GENRE_PRIORITY.indexOf(genres[0]);
    if (winnerPriority === -1) winnerPriority = 999;

    for (const g of genres.slice(1)) {
      const p = GENRE_PRIORITY.indexOf(g);
      const eff = p === -1 ? 999 : p;
      if (eff < winnerPriority) {
        winner = g;
        winnerPriority = eff;
      }
    }
    crossDupes.set(id, { winner, allGenres: genres });
  }

  // Remove cross-dupe books from non-winner genres
  for (const [genre, books] of Object.entries(cache.genres)) {
    cache.genres[genre] = books.filter(book => {
      const id = bookId(book);
      const dupe = crossDupes.get(id);
      if (!dupe) return true;          // not a cross-dupe at all
      if (dupe.winner === genre) return true;  // this is the winner genre
      // Remove from this non-winner genre
      removals.push({
        genre,
        title: book.title,
        reason: `Cross-genre duplicate (kept in "${dupe.winner}"; appeared in [${dupe.allGenres.join(', ')}])`,
      });
      return false;
    });
  }

  // ── Counts ───────────────────────────────────────────────────────────────

  for (const [genre, books] of Object.entries(cache.genres)) {
    afterCounts[genre] = books.length;
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  cache.deepCleanedAt = new Date().toISOString();

  const tmpPath = CACHE_PATH + '.tmp';
  try {
    await fs.writeFile(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmpPath, CACHE_PATH);
    console.log(`[DeepClean] Saved cleaned cache to ${CACHE_PATH}`);
  } catch (err) {
    console.error(`[DeepClean] Failed to write cache: ${err.message}`);
    process.exit(1);
  }

  // ── Report ───────────────────────────────────────────────────────────────

  console.log('\n=== Removal log ===');
  if (removals.length === 0) {
    console.log('  (no books removed)');
  } else {
    for (const r of removals) {
      console.log(`  [${r.genre}] "${r.title}" → ${r.reason}`);
    }
  }

  console.log('\n=== Deep-Clean Summary ===');
  let totalBefore = 0, totalAfter = 0;
  const allGenres = new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)]);
  for (const genre of allGenres) {
    const before = beforeCounts[genre] || 0;
    const after  = afterCounts[genre]  || 0;
    const dropped = before - after;
    console.log(`  ${genre}: ${before} → ${after}  (-${dropped})`);
    totalBefore += before;
    totalAfter  += after;
  }
  console.log(`  TOTAL: ${totalBefore} → ${totalAfter}  (-${totalBefore - totalAfter})`);

  // Break down removal reasons
  const reasons = {};
  for (const r of removals) {
    // Simplify cross-genre reason for grouping
    const key = r.reason.startsWith('Cross-genre') ? 'Cross-genre duplicate' : r.reason;
    reasons[key] = (reasons[key] || 0) + 1;
  }
  console.log('\n  Removal reasons:');
  for (const [reason, count] of Object.entries(reasons)) {
    console.log(`    ${count}x  ${reason}`);
  }
  console.log('==========================\n');
}

main();
