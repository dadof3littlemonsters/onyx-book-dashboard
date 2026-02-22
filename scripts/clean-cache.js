#!/usr/bin/env node
/**
 * One-time cache cleaning script.
 *
 * Reads data/discovery_cache.json, applies the book validator,
 * drops books with no cover, deduplicates per genre by normalised
 * title+author, removes the 'test' genre, and writes the cleaned
 * cache back to disk.
 *
 * Usage: node scripts/clean-cache.js
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

const CACHE_PATH = path.join(__dirname, '../data/discovery_cache.json');
const { validateBook } = require('../server/utils/bookValidator');

// ---- normalisation helper (mirrors Fix 5 logic) ----
function normalKey(book) {
  const rawTitle = (book.title || '')
    .toLowerCase()
    .replace(/\s*[:|-]\s*.*/u, '')
    .replace(/[^\w\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstAuthor = (
    Array.isArray(book.authors) ? book.authors[0] : (book.author || '')
  )
    .toLowerCase()
    .replace(/[^\w\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${rawTitle}|${firstAuthor}`;
}

async function main() {
  console.log(`[CleanCache] Reading cache from: ${CACHE_PATH}`);

  let raw;
  try {
    raw = await fs.readFile(CACHE_PATH, 'utf8');
  } catch (err) {
    console.error(`[CleanCache] Cannot read cache file: ${err.message}`);
    process.exit(1);
  }

  let cache;
  try {
    cache = JSON.parse(raw);
  } catch (err) {
    console.error(`[CleanCache] Cache file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!cache.genres || typeof cache.genres !== 'object') {
    console.error('[CleanCache] Cache has no genres field, aborting.');
    process.exit(1);
  }

  const summary = {};
  const cleaned = {};

  for (const [genre, books] of Object.entries(cache.genres)) {
    // Remove the test genre entirely
    if (genre === 'test') {
      console.log(`[CleanCache] Removed genre "test" (${Array.isArray(books) ? books.length : '?'} books)`);
      summary[genre] = { before: Array.isArray(books) ? books.length : 0, after: 0, dropped: [], note: 'genre removed' };
      continue;
    }

    if (!Array.isArray(books)) {
      console.warn(`[CleanCache] Genre "${genre}" is not an array, skipping.`);
      continue;
    }

    const before = books.length;
    const dropped = [];
    const seen = new Map();   // normalKey → true
    const kept = [];

    for (const book of books) {
      // 1. Validate
      const v = validateBook(book);
      if (!v.valid) {
        dropped.push({ title: book.title, reason: v.reason });
        continue;
      }

      // 2. Require a non-null cover
      if (!book.coverUrl) {
        const author = Array.isArray(book.authors) ? book.authors[0] : (book.author || '');
        dropped.push({ title: book.title, reason: 'No cover URL' });
        console.warn(`[CleanCache] Dropped (no cover): "${book.title}" by ${author}`);
        continue;
      }

      // 3. Deduplicate by normalised title+author
      const key = normalKey(book);
      if (seen.has(key)) {
        dropped.push({ title: book.title, reason: 'Duplicate (normalised title+author)' });
        continue;
      }

      seen.set(key, true);
      kept.push(book);
    }

    cleaned[genre] = kept;

    const after = kept.length;
    summary[genre] = { before, after, dropped };
    console.log(`[CleanCache] ${genre}: ${before} → ${after} (dropped ${before - after})`);
  }

  // Write cleaned cache back
  cache.genres = cleaned;
  cache.cleanedAt = new Date().toISOString();

  try {
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log(`[CleanCache] Cleaned cache written to: ${CACHE_PATH}`);
  } catch (err) {
    console.error(`[CleanCache] Failed to write cache: ${err.message}`);
    process.exit(1);
  }

  // Print final summary
  console.log('\n=== Clean Cache Summary ===');
  let totalBefore = 0;
  let totalAfter = 0;
  for (const [genre, s] of Object.entries(summary)) {
    const droppedCount = s.before - s.after;
    console.log(`  ${genre}: ${s.before} → ${s.after} (${droppedCount} dropped)`);
    totalBefore += s.before;
    totalAfter += s.after;

    if (s.dropped && s.dropped.length > 0) {
      // Group drop reasons
      const reasons = {};
      for (const d of s.dropped) {
        reasons[d.reason] = (reasons[d.reason] || 0) + 1;
      }
      for (const [reason, count] of Object.entries(reasons)) {
        console.log(`    - ${reason}: ${count}`);
      }
    }
  }
  console.log(`  TOTAL: ${totalBefore} → ${totalAfter} (${totalBefore - totalAfter} dropped)`);
  console.log('===========================\n');
}

main();
