#!/usr/bin/env node
/**
 * Deduplicate master_book_cache.json.
 *
 * Strategy
 * --------
 * 1. Load the cache.
 * 2. Group every book by its aggressive normTitle key.
 * 3. Within each group pick the single winner:
 *      coverUrl present  >  highest averageRating  >  most populated metadata fields
 * 4. Merge genres from all group members into the winner so it still
 *    appears in every genre any duplicate belonged to.
 * 5. Rebuild genreIndex and stats from the surviving books.
 * 6. Write the cleaned cache atomically, print a before/after report.
 *
 * Usage:  node scripts/dedup-master-cache.js
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');
const { validateBook } = require('../server/utils/bookValidator');

const CACHE_PATH = path.join(__dirname, '../data/master_book_cache.json');

// ── normTitle ─────────────────────────────────────────────────────────────────
// Same logic as the API-level dedup in server/index.js.
// 5 words (not 4) so same-series books with a shared prefix don't collide
// (e.g. "Harry Potter and the Philosopher's Stone" vs "… Chamber of Secrets").
function normTitle(t) {
  let s = (t || '').toLowerCase();
  s = s.replace(/\s+by\s+\S.*$/, '');                          // strip " by Author"
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');                      // strip (…)
  s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ');                     // strip […]
  s = s.replace(/\s*:.*$/, '');                                 // strip subtitle after ":"
  s = s.replace(/\s+#\d+\S*/g, ' ');                           // strip "#N" series marker
  s = s.replace(/\s+(?:book|vol\.?|volume)\s+\d+\S*/gi, ' '); // strip "Book N" / "Vol N"
  s = s.replace(/^(?:the|a|an)\s+/, '');                       // strip leading article
  s = s.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.split(/\s+/).slice(0, 5).join(' ');
}

// ── scoring ───────────────────────────────────────────────────────────────────
// Returns a numeric score; higher = better quality entry to keep.
function score(book) {
  let s = 0;
  if (book.coverUrl)                                        s += 10000; // cover is king
  s += Math.round((book.averageRating || 0) * 1000);                   // rating
  if (book.description && book.description.length > 20)    s += 100;
  if (book.publishedDate && book.publishedDate.length > 0) s += 10;
  if ((book.pageCount || 0) > 0)                           s += 10;
  if (book.publisher && book.publisher.length > 0)         s += 5;
  if ((book.ratingsCount || 0) > 0)                        s += 5;
  if (book.googleBooksId)                                  s += 5;
  if (book.isbn13)                                         s += 5;
  return s;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[DedupMaster] Reading: ${CACHE_PATH}`);

  let raw;
  try { raw = await fs.readFile(CACHE_PATH, 'utf8'); }
  catch (err) { console.error('[DedupMaster] Cannot read cache:', err.message); process.exit(1); }

  let cache;
  try { cache = JSON.parse(raw); }
  catch (err) { console.error('[DedupMaster] Invalid JSON:', err.message); process.exit(1); }

  const books = cache.books || {};
  const totalBefore = Object.keys(books).length;
  console.log(`[DedupMaster] ${totalBefore} books before dedup`);

  // ── Step 0: drop invalid entries ────────────────────────────────────────────

  let droppedValidation = 0;
  for (const [key, book] of Object.entries(books)) {
    const v = validateBook(book);
    if (!v.valid) {
      console.log(`[DedupMaster] Dropped (validation): "${book.title}" — ${v.reason}`);
      delete books[key];
      droppedValidation++;
    }
  }
  if (droppedValidation > 0) {
    console.log(`[DedupMaster] Dropped ${droppedValidation} invalid entries before dedup`);
  }

  // ── Step 1: group by normTitle ─────────────────────────────────────────────

  // groups: normKey → [ [cacheKey, bookData], … ]
  const groups = new Map();

  for (const [key, book] of Object.entries(books)) {
    const nk = normTitle(book.title);
    if (!nk) continue; // skip books with empty title after normalisation
    if (!groups.has(nk)) groups.set(nk, []);
    groups.get(nk).push([key, book]);
  }

  // ── Step 2: pick winner per group, merge genres ────────────────────────────

  const survivors     = {};   // cacheKey → book  (survivors only)
  const removedKeys   = new Set();
  const groupReport   = [];   // for summary logging

  for (const [nk, entries] of groups.entries()) {
    if (entries.length === 1) {
      const [key, book] = entries[0];
      survivors[key] = book;
      continue;
    }

    // Sort descending by score; best entry first
    entries.sort((a, b) => score(b[1]) - score(a[1]));

    const [winnerKey, winnerBook] = entries[0];

    // Merge genres from all duplicates into the winner
    const mergedGenres = new Set(winnerBook.genres || []);
    for (const [, dupBook] of entries.slice(1)) {
      for (const g of (dupBook.genres || [])) mergedGenres.add(g);
    }
    winnerBook.genres = [...mergedGenres];

    survivors[winnerKey] = winnerBook;

    // Track removed keys
    for (const [key] of entries.slice(1)) {
      removedKeys.add(key);
    }

    groupReport.push({
      norm:    nk,
      count:   entries.length,
      kept:    winnerBook.title,
      removed: entries.slice(1).map(([, b]) => b.title),
    });
  }

  const totalAfter = Object.keys(survivors).length;
  const removed    = totalBefore - totalAfter;

  // ── Step 3: rebuild genreIndex ─────────────────────────────────────────────

  const newGenreIndex  = {};
  const newBooksByGenre = {};

  for (const [key, book] of Object.entries(survivors)) {
    for (const genre of (book.genres || [])) {
      if (!newGenreIndex[genre]) {
        newGenreIndex[genre]  = [];
        newBooksByGenre[genre] = 0;
      }
      newGenreIndex[genre].push(key);
      newBooksByGenre[genre]++;
    }
  }

  // ── Step 4: update cache ───────────────────────────────────────────────────

  cache.books       = survivors;
  cache.genreIndex  = newGenreIndex;
  cache.stats       = {
    totalBooks:   totalAfter,
    totalGenres:  Object.keys(newGenreIndex).length,
    booksByGenre: newBooksByGenre,
    lastScrape:   cache.stats?.lastScrape || {},
  };
  cache.dedupedAt   = new Date().toISOString();

  // ── Step 5: write atomically ───────────────────────────────────────────────

  const tmpPath = CACHE_PATH + '.tmp';
  try {
    await fs.writeFile(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmpPath, CACHE_PATH);
    console.log(`[DedupMaster] Saved to ${CACHE_PATH}`);
  } catch (err) {
    console.error('[DedupMaster] Failed to write cache:', err.message);
    process.exit(1);
  }

  // ── Step 6: report ─────────────────────────────────────────────────────────

  console.log('\n=== Dedup Report (groups with 5+ duplicates) ===');
  const bigGroups = groupReport
    .filter(g => g.count >= 5)
    .sort((a, b) => b.count - a.count);

  for (const g of bigGroups) {
    console.log(`  [${g.count}x] kept "${g.kept}"`);
  }

  console.log('\n=== Genre Index after dedup ===');
  for (const [genre, keys] of Object.entries(newGenreIndex)) {
    console.log(`  ${genre}: ${keys.length} books`);
  }

  console.log('\n=== Summary ===');
  console.log(`  Books before : ${totalBefore}`);
  console.log(`  Books after  : ${totalAfter}`);
  console.log(`  Removed      : ${removed}  (${((removed / totalBefore) * 100).toFixed(1)}%)`);
  console.log(`  Groups merged: ${groupReport.length}`);
  console.log(`  Largest group: ${groupReport.length ? Math.max(...groupReport.map(g => g.count)) : 0} copies of same title`);
  console.log('================\n');
}

main();
