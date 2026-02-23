/**
 * Book Validator
 * Validates book objects before they are allowed into the discovery cache.
 * All checks must pass for a book to be accepted.
 */

const https = require('https');
const http  = require('http');

/**
 * Patterns that identify multi-book bundles / box sets / series collections.
 * Any title match → rejected.
 */
const COLLECTION_PATTERNS = [
  /box\s*set/i,            // "box set", "boxset"
  /boxed\s+set/i,          // "Boxed Set" (distinct from box\s*set which misses the 'd')
  /\bcollection\b/i,
  /\bomnibus\b/i,
  /complete\s+series/i,
  /books\s+1[-–]/i,
  /volumes?\s+1[-–]/i,
  /the\s+complete\b/i,
  /\d-book\b/i,
  /trilogy\s+collection/i,
  /series\s+collection/i,
  /starter\s+bundle/i,     // "Sarah J. Maas Starter Bundle"
  /fantasy\s+firsts/i,     // "Brandon Sanderson's Fantasy Firsts"
];

/**
 * Patterns that identify non-book items: merch, journals, stationery,
 * summaries, foreign-language editions, adaptation tie-ins, craft guides, etc.
 * Any title match → rejected.
 */
const NON_BOOK_PATTERNS = [
  // Physical / stationery items
  /\bjournal\b/i,
  /\bnotebook\b/i,
  /\bplanner\b/i,
  /\bdiary\b/i,
  /coloring\s+book/i,
  /activity\s+book/i,
  /\bworkbook\b/i,
  /\bstationery\b/i,

  // Summaries / study guides
  /\bsummary\s+of\b/i,     // "Summary of Morning Star", "Summary of Bookshops…"
  /summary\s*(?:and|&)\s*analysis/i,  // "Summary and Analysis of Ready Player One"

  // Combined / semicolon-joined multi-book titles ("Eragon; Eldest")
  /\w;\s+\w/,

  // Anthology / pack labels
  /\bsuper\s+pack\b/i,     // "Science Fiction Super Pack #1"

  // "Presents the great…" / "Presents:" anthology introductions
  /presents\s+the\s+great/i,
  /\bpresents\s*:/i,       // "Fantastic Stories Presents: …"

  // Foreign-language editions (these slip past langRestrict on Google Books)
  /\bsakrileg\b/i,         // German title for "The Da Vinci Code"
  /\baudgave\b/i,          // Danish/Norwegian "edition"
  /\budg[aå]va\b/i,        // Swedish "edition"
  /ausgabe/i,              // German "edition" (Ausgabe, Gesamtausgabe, etc.)
  /Edici[oó]n\b/i,         // Spanish "Edición"
  /\bNemira\b/i,           // Romanian publisher name frequently in title
  /\bitaliano\b/i,
  /\bdeutsch(e)?\b/i,

  // Romanian/Spanish word for "series" — appears as a title suffix
  // (but must NOT fire on the English word "series" → use \bserie\b not /series/)
  /\bserie\b/i,

  // Auction / collector catalogues
  /auction\s+catalog/i,
  /grand\s+format/i,

  // Year-based yearbook / annual titles
  /\bdas\s+jahr\b/i,       // German yearbook
  /\byear\s+\d{4}/i,       // "Year 2020 …"

  // Graphic-novel adaptations of prose works
  /graphic\s+novel\s+adaptation/i,

  // Writing-craft / how-to books (no fiction genre carries these)
  /\bwriting\s+magic\b/i,
  /\bguide\s+to\s+writing\b/i,
  /\bhow\s+to\s+write\b/i,
];

/**
 * Validate a book object for cache inclusion.
 *
 * Checks (all must pass):
 * 1. Non-empty title
 * 2. At least one author
 * 3. Title does not match collection/box-set patterns
 * 4. Title does not match non-book item patterns
 * 5. Has a valid isbn13 (13 digits) OR a valid googleBooksId
 * 6. pageCount, if present and > 0, must be greater than 50
 *
 * @param {Object} book - Book object to validate
 * @returns {{ valid: boolean, reason: string }}
 */
function validateBook(book) {
  // 1. Must have a non-empty title
  if (!book.title || typeof book.title !== 'string' || book.title.trim() === '') {
    return { valid: false, reason: 'Missing title' };
  }

  const title = book.title.trim();

  // 2. Must have at least one author
  const hasAuthor =
    (Array.isArray(book.authors) && book.authors.length > 0 && book.authors[0] &&
      book.authors[0].trim() !== '') ||
    (typeof book.author === 'string' && book.author.trim() !== '');

  if (!hasAuthor) {
    return { valid: false, reason: 'Missing author' };
  }

  // 3. Title must not match collection/box-set patterns
  for (const pattern of COLLECTION_PATTERNS) {
    if (pattern.test(title)) {
      return { valid: false, reason: `Collection or box set (title matches: ${pattern.source})` };
    }
  }

  // 4. Title must not match non-book item patterns
  for (const pattern of NON_BOOK_PATTERNS) {
    if (pattern.test(title)) {
      return { valid: false, reason: `Non-book item (title matches: ${pattern.source})` };
    }
  }

  // 5. Must have a valid isbn13 OR a valid googleBooksId
  const hasIsbn13 = typeof book.isbn13 === 'string' && /^\d{13}$/.test(book.isbn13.trim());
  const hasGoogleBooksId =
    typeof book.googleBooksId === 'string' && book.googleBooksId.trim() !== '';

  if (!hasIsbn13 && !hasGoogleBooksId) {
    return { valid: false, reason: 'No valid isbn13 or googleBooksId' };
  }

  // 6. Reject books whose only available cover comes from images-na.ssl-images-amazon.com
  //    (these URLs return a 43-byte stub; Amazon has blocked direct hotlinking from this CDN path)
  const DEAD_AMAZON_HOSTNAME = 'images-na.ssl-images-amazon.com';
  const coverFields = [book.coverUrl, book.thumbnail, book.goodreadsCoverUrl].filter(Boolean);
  const hasAnyCover = coverFields.length > 0;
  const allCoversAreDead = hasAnyCover && coverFields.every(
    (u) => typeof u === 'string' && u.includes(DEAD_AMAZON_HOSTNAME)
  );
  if (allCoversAreDead) {
    return { valid: false, reason: 'All cover URLs are dead Amazon SSL paths (images-na.ssl-images-amazon.com)' };
  }

  // 7. pageCount if present must be > 50 (filters out short-form content)
  if (
    book.pageCount !== undefined &&
    book.pageCount !== null &&
    typeof book.pageCount === 'number' &&
    book.pageCount > 0 &&
    book.pageCount <= 50
  ) {
    return { valid: false, reason: `Page count too low (${book.pageCount})` };
  }

  return { valid: true, reason: '' };
}

/**
 * Validate that a cover URL actually serves a real image.
 *
 * Rejects if:
 *  - URL is missing or not a string
 *  - HTTP response is not 2xx
 *  - Content-Type is not an image/*
 *  - Response body is less than 5 KB (Google placeholder is ~900 bytes)
 *
 * Uses only built-in Node.js modules (no external dependencies).
 * Follows up to 3 redirects.
 *
 * @param {string} url
 * @returns {Promise<{ valid: boolean, reason: string }>}
 */
function validateCoverUrl(url) {
  const MIN_BYTES = 5 * 1024; // 5 KB
  const TIMEOUT_MS = 10_000;
  const MAX_REDIRECTS = 3;

  if (!url || typeof url !== 'string') {
    return Promise.resolve({ valid: false, reason: 'Cover URL is missing or not a string' });
  }

  function fetch(urlStr, redirectsLeft) {
    return new Promise((resolve) => {
      let parsed;
      try { parsed = new URL(urlStr); }
      catch { return resolve({ valid: false, reason: `Invalid cover URL: ${urlStr}` }); }

      const isGoodreads = parsed.hostname.includes('gr-assets.com');
      const lib = parsed.protocol === 'https:' ? https : http;

      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (compatible; Onyx/1.0)',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      };
      if (isGoodreads) {
        reqHeaders['Referer'] = 'https://www.goodreads.com/';
        reqHeaders['Origin']  = 'https://www.goodreads.com';
      }

      const req = lib.request(urlStr, { method: 'GET', headers: reqHeaders, timeout: TIMEOUT_MS }, (res) => {
        const status = res.statusCode;

        // Follow redirects
        if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308)
            && res.headers.location && redirectsLeft > 0) {
          res.resume(); // drain
          const next = new URL(res.headers.location, urlStr).href;
          return resolve(fetch(next, redirectsLeft - 1));
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ valid: false, reason: `Cover URL returned HTTP ${status}` });
        }

        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (!ct.startsWith('image/')) {
          res.resume();
          return resolve({ valid: false, reason: `Cover URL content-type is not image/* (got: ${ct || 'none'})` });
        }

        // Collect bytes until we have MIN_BYTES or the response ends
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received >= MIN_BYTES) {
            res.destroy(); // we have enough
          }
        });
        res.on('close', () => {
          if (received < MIN_BYTES) {
            resolve({ valid: false, reason: `Cover image too small (${received} bytes, min ${MIN_BYTES})` });
          } else {
            resolve({ valid: true, reason: '' });
          }
        });
        res.on('error', (err) => resolve({ valid: false, reason: `Cover fetch error: ${err.message}` }));
      });

      req.on('timeout', () => { req.destroy(); resolve({ valid: false, reason: 'Cover URL request timed out' }); });
      req.on('error',   (err) => resolve({ valid: false, reason: `Cover request error: ${err.message}` }));
      req.end();
    });
  }

  return fetch(url, MAX_REDIRECTS);
}

module.exports = { validateBook, isValidBook: validateBook, validateCoverUrl };
