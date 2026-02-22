const fs = require('fs').promises;
const path = require('path');
const googleBooksApi = require('./googleBooksApi');
const coverResolver = require('./coverResolver');
const hardcoverService = require('./hardcoverService');
const goodreadsShelfScraper = require('./goodreadsShelfScraper');
const masterBookCache = require('./masterBookCache');
const { validateBook } = require('../utils/bookValidator');

/**
 * Get genre sources configuration from the scraper
 */
function getGenreMappings() {
  return goodreadsShelfScraper.getGenreSources();
}

/**
 * Awards ISBNs - static list of award-winning books
 */
function getAwardsIsbns() {
  return [
    '9780765311788',  // The Name of the Wind (Hugo nominee)
    '9780765326355',  // The Way of Kings (Hugo nominee)
    '9780316042676',  // The Hunger Games
    '9780441013593',  // Dune (Hugo winner)
    '9780553382563',  // A Game of Thrones (Hugo nominee)
    '9780060853984',  // American Gods (Hugo winner)
    '9780316043918',  // The Windup Girl (Hugo winner)
    '9780765316882',  // Mistborn: The Final Empire
    '9780441005666',  // Ender's Game (Hugo winner)
    '9780345476882',  // The Curse of Chalion (Hugo nominee)
    '9780553803709',  // The City & The City (Hugo winner)
    '9780316068041',  // Ancillary Justice (Hugo winner)
    '9780765328663',  // Leviathan Wakes (Hugo nominee)
    '9781250312995',  // The Fifth Season (Hugo winner)
    '9781250765921',  // A Memory Called Empire (Hugo winner)
    '9780765377068',  // The Three-Body Problem (Hugo winner)
    '9781250303566',  // Gideon the Ninth (Hugo nominee)
    '9781250766607',  // Network Effect (Hugo winner)
    '9781250768359',  // A Desolation Called Peace (Hugo winner)
    '9780765375866',  // The Calculating Stars (Hugo winner)
    '9781250166901',  // The Stone Sky (Hugo winner)
    '9780765375620',  // All Systems Red (Hugo winner)
    '9780765397530',  // Binti (Hugo winner)
    '9780765377075'   // The Dark Forest (Hugo nominee)
  ];
}

class DiscoveryCache {
  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.cacheFile = path.join(this.dataDir, 'discovery_cache.json');
    this.cache = null;
    this.lastGenerated = null;
    this.isGenerating = false;
    this.genreMappings = getGenreMappings();
    this.awardsIsbns = getAwardsIsbns();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enrich a list of scraped books with Google Books metadata
   * @param {Array} scrapedBooks - Array of {title, author, goodreadsCoverUrl}
   * @returns {Promise<Array>} Array of enriched book objects
   */
  async enrichWithGoogleBooks(scrapedBooks) {
    const enrichedBooks = [];
    let foundCount = 0;
    let notFoundCount = 0;
    let droppedValidation = 0;
    let droppedNoCover = 0;

    for (let i = 0; i < scrapedBooks.length; i++) {
      const scrapedBook = scrapedBooks[i];
      const { title, author, goodreadsCoverUrl } = scrapedBook;

      try {
        // Try multiple search queries
        const queries = [
          `intitle:"${title}"+inauthor:"${author}"`,
          `"${title}"+${author}`,
          `${title}+${author}`
        ];

        let googleBook = null;

        for (const query of queries) {
          const results = await googleBooksApi.searchBooks(query, 5);
          if (results.length > 0) {
            // Find best match by comparing title and author similarity
            const bestMatch = results.find(b =>
              b.title && b.title.toLowerCase().includes(title.toLowerCase()) &&
              b.authors && b.authors.some(a => a && a.toLowerCase().includes(author.toLowerCase()))
            ) || results[0];

            googleBook = bestMatch;
            break;
          }
        }

        if (googleBook) {
          // Start with Google Books data
          const enrichedBook = {
            ...googleBook,
            goodreadsCoverUrl
          };

          // Try to get better cover from coverResolver
          const resolvedAuthor = Array.isArray(googleBook.authors) ? googleBook.authors[0] : author;
          const betterCover = await coverResolver.getCoverUrl(
            googleBook.isbn13,
            googleBook.thumbnail,
            googleBook.title,
            resolvedAuthor
          );

          // Cover priority:
          // 1. coverResolver result (Hardcover → OpenLibrary → Google Books → Amazon) — best quality
          // 2. goodreadsCoverUrl — server can proxy it; client routes gr-assets.com through /api/proxy-image
          // 3. Google Books thumbnail — direct browser access, no proxy needed
          // null → book is dropped below (Fix 4)
          const resolvedCover = (betterCover && !betterCover.includes('placeholder')) ? betterCover : null;
          enrichedBook.coverUrl = resolvedCover || goodreadsCoverUrl || googleBook.thumbnail || null;

          // Fix 4: Drop books with no resolvable cover
          if (!enrichedBook.coverUrl) {
            console.warn(`[DiscoveryCache] Dropped (no cover): "${googleBook.title}" by ${resolvedAuthor}`);
            droppedNoCover++;
            notFoundCount++;
            continue;
          }

          // Check if rating is missing and try Hardcover as fallback
          let rating = googleBook.averageRating || 0;
          if (rating === 0 && googleBook.isbn13) {
            try {
              const hardcoverRating = await hardcoverService.getRating(
                googleBook.isbn13,
                googleBook.title,
                resolvedAuthor
              );
              if (hardcoverRating) {
                rating = hardcoverRating;
              }
            } catch (ratingError) {
              // Silently continue without rating
            }
          }

          enrichedBook.averageRating = rating;

          // Fix 3: Validate the book before adding to cache
          const validation = validateBook(enrichedBook);
          if (!validation.valid) {
            console.log(`[DiscoveryCache] Dropped (validation): "${googleBook.title}" - ${validation.reason}`);
            droppedValidation++;
            notFoundCount++;
            continue;
          }

          // Normalize author string field from authors array so downstream
          // code that reads book.author gets a value (Google Books only
          // populates the `authors` array, not a flat `author` field).
          if (!enrichedBook.author) {
            enrichedBook.author = Array.isArray(enrichedBook.authors) && enrichedBook.authors[0]
              ? enrichedBook.authors[0]
              : (resolvedAuthor || '');
          }

          enrichedBooks.push(enrichedBook);
          foundCount++;
          console.log(`[DiscoveryCache] ✓ Enriched: "${googleBook.title}" by ${resolvedAuthor}`);
        } else {
          // Book not found in Google Books - drop it (no isbn13/googleBooksId means it fails validation)
          notFoundCount++;
          console.log(`[DiscoveryCache] ✗ Not found in Google Books: "${title}" by ${author}`);
        }

      } catch (error) {
        console.error(`[DiscoveryCache] Error enriching book "${title}":`, error.message);
        notFoundCount++;
      }
    }

    console.log(`[DiscoveryCache] Enrichment complete: ${foundCount} added, ${notFoundCount} not found/dropped (${droppedValidation} failed validation, ${droppedNoCover} no cover)`);
    return enrichedBooks;
  }

  /**
   * Generate books for a genre using Goodreads scraping
   * @param {string} genreKey - The genre key
   * @param {boolean} isInitialPopulation - Whether this is initial population
   * @returns {Promise<Array>} Array of enriched book objects
   */
  async generateForGenreFromScraping(genreKey, isInitialPopulation = false) {
    const source = this.genreMappings[genreKey];
    if (!source) {
      throw new Error(`Unknown genre key: ${genreKey}`);
    }

    const count = isInitialPopulation ? source.initialCount : source.refreshCount;
    console.log(`[DiscoveryCache] Generating for genre "${genreKey}" (count: ${count}, initial: ${isInitialPopulation})`);

    // Initialize master cache
    await masterBookCache.init();

    // Scrape from Goodreads
    let scrapedBooks = source.type === 'list'
      ? await goodreadsShelfScraper.scrapeList(source.id, count)
      : await goodreadsShelfScraper.scrapeShelf(source.name, count);

    console.log(`[DiscoveryCache] Scraped ${scrapedBooks.length} books from Goodreads for "${genreKey}"`);

    // For refresh, filter out already-cached books
    let booksToEnrich = scrapedBooks;
    if (!isInitialPopulation) {
      booksToEnrich = scrapedBooks.filter(b => !masterBookCache.bookExists(b.title, b.author));
      console.log(`[DiscoveryCache] Filtered to ${booksToEnrich.length} new books (skipping ${scrapedBooks.length - booksToEnrich.length} cached)`);
    }

    // Enrich with Google Books
    const enrichedBooks = await this.enrichWithGoogleBooks(booksToEnrich);

    // Add to master cache
    for (const book of enrichedBooks) {
      masterBookCache.addBook(book, [genreKey]);
    }

    // Handle existing books (add genre tag if missing)
    if (!isInitialPopulation) {
      for (const scrapedBook of scrapedBooks) {
        const isbn = masterBookCache.bookExists(scrapedBook.title, scrapedBook.author);
        if (isbn) {
          const existing = masterBookCache.cache.books[isbn];
          if (existing && !existing.genres.includes(genreKey)) {
            existing.genres.push(genreKey);
            console.log(`[DiscoveryCache] Added genre "${genreKey}" to existing book: "${existing.title}"`);
          }
        }
      }
    }

    // Update scrape time
    masterBookCache.updateScrapeTime(genreKey);

    // Save master cache
    await masterBookCache.save();

    console.log(`[DiscoveryCache] Generated ${enrichedBooks.length} books for genre "${genreKey}"`);
    return enrichedBooks;
  }

  /**
   * Process a single genre for cache generation
   * Used by parallel cache generation
   */
  async processGenre(genreKey, config) {
    const startTime = Date.now();
    console.log(`[DiscoveryCache] [${genreKey}] Starting generation...`);

    try {
      let books = [];

      if (genreKey === 'awards') {
        // Awards genre uses ISBN-based lookup
        books = await this.fetchAwardsBooks(config.isbns);
      } else {
        // Use Goodreads scraping for all other genres
        books = await this.generateForGenreFromScraping(genreKey, config.isInitialPopulation || false);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[DiscoveryCache] [${genreKey}] ✓ Completed in ${elapsed}ms - ${books.length} books`);

      return { genreKey, books: books.slice(0, 200), success: true };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[DiscoveryCache] [${genreKey}] ✗ Failed after ${elapsed}ms:`, error.message);
      return { genreKey, books: [], success: false, error: error.message };
    }
  }

  /**
   * Process multiple genres in parallel with a concurrency limit
   * Saves cache incrementally after each chunk
   */
  async processGenresInParallel(genreEntries, cache, concurrency = 4) {
    const results = [];

    // Split genres into chunks
    for (let i = 0; i < genreEntries.length; i += concurrency) {
      const chunk = genreEntries.slice(i, i + concurrency);
      const chunkNum = Math.floor(i / concurrency) + 1;
      const totalChunks = Math.ceil(genreEntries.length / concurrency);

      console.log(`[DiscoveryCache] Processing chunk ${chunkNum}/${totalChunks} (${chunk.length} genres)...`);

      const chunkResults = await Promise.all(
        chunk.map(([genreKey, config]) => this.processGenre(genreKey, config))
      );

      // Collect results and update cache immediately after each chunk
      for (const result of chunkResults) {
        results.push(result);
        if (result.success) {
          cache.genres[result.genreKey] = result.books;
        } else {
          // Add empty array for failed genres
          cache.genres[result.genreKey] = [];
        }
      }

      // SAVE CACHE AFTER EACH CHUNK - don't lose progress if later chunks fail
      await this.saveCacheToFile(cache);
      this.cache = cache;
      this.lastGenerated = new Date();

      console.log(`[DiscoveryCache] ✓ Chunk ${chunkNum}/${totalChunks} saved - ${Object.keys(cache.genres).length} genres cached`);
    }

    return results;
  }

  /**
   * Generate cache for all genres using Goodreads scraping
   * @param {boolean} forceInitialPopulation - Force initial population mode
   */
  async generateDailyCache(forceInitialPopulation = true) {
    if (this.isGenerating) {
      console.log('[DiscoveryCache] Cache generation already in progress, skipping...');
      if (this.cache) return this.cache;

      if (!this.cache) {
        console.log('[DiscoveryCache] No cache available and generation in progress, waiting...');
        await this.sleep(2000);
        return this.cache || { genres: {} };
      }
      return this.cache;
    }

    this.isGenerating = true;
    console.log('[DiscoveryCache] Starting PARALLEL cache generation with Goodreads scraper (concurrency: 4)...');
    const startTime = Date.now();

    try {
      await this.ensureDataDirectory();

      const cache = {
        generatedAt: new Date().toISOString(),
        genres: {}
      };

      // Initialize master cache
      await masterBookCache.init();

      // Prepare genre entries
      const genreEntries = Object.entries(this.genreMappings).map(([genreKey, source]) => {
        return [genreKey, { isInitialPopulation: forceInitialPopulation }];
      });

      // Add awards genre
      genreEntries.push(['awards', { isbns: this.awardsIsbns }]);

      // Process genres in parallel
      const results = await this.processGenresInParallel(genreEntries, cache, 4);

      // Count successes and failures
      let successCount = 0;
      let failCount = 0;
      for (const result of results) {
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      await this.saveCacheToFile(cache);
      this.cache = cache;
      this.lastGenerated = new Date();

      const elapsed = Date.now() - startTime;
      console.log(`[DiscoveryCache] Parallel cache generation completed in ${elapsed}ms`);
      console.log(`[DiscoveryCache] Summary: ${successCount} succeeded, ${failCount} failed`);

      this.isGenerating = false;
      return cache;
    } catch (error) {
      console.error('[DiscoveryCache] Error generating daily cache:', error);
      this.isGenerating = false;
      throw error;
    }
  }

  /**
   * Fetch award-winning books by ISBN
   */
  async fetchAwardsBooks(isbns) {
    const books = [];
    if (!isbns || !Array.isArray(isbns) || isbns.length === 0) {
      console.warn('[DiscoveryCache] No ISBNs provided for awards books');
      return [];
    }

    console.log(`[DiscoveryCache] Fetching ${isbns.length} award-winning books...`);

    for (let i = 0; i < isbns.length; i++) {
      const isbn = isbns[i];
      try {
        console.log(`[DiscoveryCache] Fetching awards book ${i + 1}/${isbns.length}: ISBN ${isbn}`);
        const result = await googleBooksApi.searchBooks(`isbn:${isbn}`, 1);
        if (result.length > 0) {
          const enrichedBook = result[0];

          // Enrich with cover
          const awardAuthor = Array.isArray(enrichedBook.authors) ? enrichedBook.authors[0] : '';
          const coverUrl = await coverResolver.getCoverUrl(
            enrichedBook.isbn13,
            enrichedBook.thumbnail,
            enrichedBook.title,
            awardAuthor
          );

          enrichedBook.coverUrl = (coverUrl && !coverUrl.includes('placeholder'))
            ? coverUrl
            : (enrichedBook.thumbnail || coverUrl);

          // Fix 4: Drop books with no resolvable cover
          if (!enrichedBook.coverUrl) {
            console.warn(`[DiscoveryCache] Awards: dropped (no cover): "${enrichedBook.title}"`);
            continue;
          }

          // Fix 3: Validate before adding to awards cache
          const validation = validateBook(enrichedBook);
          if (!validation.valid) {
            console.log(`[DiscoveryCache] Awards: dropped (validation): "${enrichedBook.title}" - ${validation.reason}`);
            continue;
          }

          // Normalize author string field (same as enrichWithGoogleBooks)
          if (!enrichedBook.author) {
            enrichedBook.author = Array.isArray(enrichedBook.authors) && enrichedBook.authors[0]
              ? enrichedBook.authors[0]
              : '';
          }

          books.push(enrichedBook);
          console.log(`[DiscoveryCache] ✓ Found: "${enrichedBook.title}"`);
        } else {
          console.log(`[DiscoveryCache] ✗ No results for ISBN ${isbn}`);
        }
      } catch (error) {
        console.error(`[DiscoveryCache] Error fetching awards book ISBN ${isbn}:`, error.message);
      }

      if (i < isbns.length - 1) {
        await this.sleep(500);
      }
    }

    console.log(`[DiscoveryCache] Found ${books.length} award-winning books`);
    return books;
  }

  /**
   * Get random books for a genre from the master cache
   * @param {string} genreKey - The genre key
   * @param {number} count - Number of books to return
   * @returns {Promise<Array>} Array of book objects
   */
  async getBooks(genreKey, count = 50) {
    await masterBookCache.init();

    // Check if genre exists in our mappings
    if (genreKey === 'awards') {
      // Awards genre uses special handling
      const cache = await this.loadCacheFromFile();
      if (cache?.genres?.awards) {
        const shuffled = [...cache.genres.awards].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
      }
      return [];
    }

    // Check if this is a valid genre key
    if (!this.genreMappings[genreKey]) {
      console.warn(`[DiscoveryCache] Unknown genre key: ${genreKey}`);
      return [];
    }

    let books = masterBookCache.getRandomBooks(genreKey, count);

    // If cache is empty, trigger generation
    if (books.length === 0) {
      console.log(`[DiscoveryCache] Cache empty for genre "${genreKey}", triggering generation...`);
      await this.generateForGenreFromScraping(genreKey, true);
      books = masterBookCache.getRandomBooks(genreKey, count);
    }

    return books;
  }

  async saveCacheToFile(cache) {
    try {
      await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2));
      console.log(`[DiscoveryCache] Cache saved to ${this.cacheFile}`);
    } catch (error) {
      console.error('[DiscoveryCache] Error saving cache to file:', error);
      throw error;
    }
  }

  async loadCacheFromFile() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf8');
      this.cache = JSON.parse(data);
      this.lastGenerated = new Date(this.cache.generatedAt);
      console.log(`[DiscoveryCache] Loaded cache from file (generated: ${this.cache.generatedAt})`);
      return this.cache;
    } catch (error) {
      console.log('[DiscoveryCache] No cache file found, will generate new cache');
      return null;
    }
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Legacy method for backward compatibility
   * Returns randomized books from cache
   */
  async getRandomizedBooks(genreKey, count = 50) {
    const startTime = Date.now();
    const logPrefix = `[DiscoveryCache] [${new Date().toISOString()}] [${genreKey}]`;

    try {
      // Try to get books from master cache first
      if (genreKey !== 'awards') {
        const books = await this.getBooks(genreKey, count);
        if (books.length > 0) {
          console.log(`${logPrefix} SUCCESS: Returned ${books.length} books from master cache in ${Date.now() - startTime}ms`);
          return books;
        }
      }

      // Fall back to old cache file for awards or if master cache is empty
      if (!this.cache) {
        console.log(`${logPrefix} No cache in memory, loading from file...`);
        await this.loadCacheFromFile();
      }

      if (!this.cache || this.isCacheStale()) {
        console.log(`${logPrefix} Cache is stale, generating new cache...`);
        await this.generateDailyCache();
      }

      const genreBooks = this.cache?.genres?.[genreKey];
      if (!genreBooks || !Array.isArray(genreBooks)) {
        console.error(`${logPrefix} ERROR: No books array found.`, {
          hasCache: !!this.cache,
          hasGenres: !!this.cache?.genres,
          availableGenres: this.cache?.genres ? Object.keys(this.cache.genres) : [],
        });
        return [];
      }

      if (genreBooks.length === 0) {
        console.warn(`${logPrefix} WARNING: Genre exists but has 0 books.`);
        return [];
      }

      const shuffled = [...genreBooks].sort(() => Math.random() - 0.5);
      const result = shuffled.slice(0, count);

      console.log(`${logPrefix} SUCCESS: Returned ${result.length} books in ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      console.error(`${logPrefix} FAILURE after ${Date.now() - startTime}ms:`, {
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      });

      // Try to return stale cache data if available
      if (this.cache?.genres?.[genreKey]) {
        console.log(`${logPrefix} FALLBACK: Returning stale cache data`);
        return this.cache.genres[genreKey].slice(0, count);
      }

      return [];
    }
  }

  isCacheStale() {
    if (!this.lastGenerated) return true;

    const now = new Date();
    const lastGen = new Date(this.lastGenerated);

    const hoursDiff = (now - lastGen) / (1000 * 60 * 60);
    return hoursDiff >= 24;
  }

  /**
   * Refresh a single genre in the cache without touching any other genre.
   *
   * Uses the same scrape → enrich → validate pipeline as generateDailyCache()
   * for a single genre, then merges the result into the existing cache file,
   * replacing only that genre's slot.
   *
   * @param {string} genreKey - A key from getGenreMappings(), or 'awards'
   * @returns {Promise<{ genre, booksAdded, totalInGenre, generatedAt }>}
   */
  async refreshGenre(genreKey) {
    const isAwards = genreKey === 'awards';

    // Validate the genre key
    if (!isAwards && !this.genreMappings[genreKey]) {
      throw new Error(
        `Unknown genre key: "${genreKey}". Valid keys: ${Object.keys(this.genreMappings).join(', ')}, awards`
      );
    }

    const startTime = Date.now();
    console.log(`[DiscoveryCache] refreshGenre: starting refresh for "${genreKey}"`);

    await this.ensureDataDirectory();

    // Load existing cache from file if not already in memory
    let cache = this.cache;
    if (!cache) {
      cache = await this.loadCacheFromFile();
    }
    // If no cache file exists yet, start with a fresh structure rather than failing
    if (!cache) {
      cache = {
        generatedAt: new Date().toISOString(),
        genres: {}
      };
      console.log(`[DiscoveryCache] refreshGenre: no existing cache found, creating new structure`);
    }

    // Initialize master cache (no-op if already loaded)
    await masterBookCache.init();

    // Build the config the same way generateDailyCache() does for each entry
    const config = isAwards
      ? { isbns: this.awardsIsbns }
      : { isInitialPopulation: false };

    // Use the same single-genre path that generateDailyCache() drives via processGenresInParallel()
    const result = await this.processGenre(genreKey, config);

    if (!result.success) {
      throw new Error(`Genre refresh failed for "${genreKey}": ${result.error}`);
    }

    // --- Additive merge ---
    // Existing books are preserved. Newly scraped books are added to the pool.
    // Duplicates are detected by ISBN13 (primary) then normalised title+author
    // (secondary, same pattern as deduplicateByIsbn13 in googleBooksApi.js).
    // When a duplicate is found the existing entry is replaced only if the
    // incoming one has a better cover or a higher rating.

    const existingBooks = Array.isArray(cache.genres[genreKey])
      ? [...cache.genres[genreKey]]
      : [];
    const previousCount = existingBooks.length;

    // Normalisation helper - mirrors deduplicateByIsbn13 secondary-pass logic
    const normBookKey = (book) => {
      const t = (book.title || '')
        .toLowerCase()
        .replace(/\s*[:|-]\s*.*/u, '')
        .replace(/[^\w\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      const a = (Array.isArray(book.authors) ? (book.authors[0] || '') : '')
        .toLowerCase()
        .replace(/[^\w\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${t}|${a}`;
    };

    const isBetterEntry = (incoming, current) => {
      const incomingHasCover = !!(incoming.coverUrl && !incoming.coverUrl.includes('placeholder'));
      const currentHasCover = !!(current.coverUrl && !current.coverUrl.includes('placeholder'));
      if (incomingHasCover && !currentHasCover) return true;
      return (incoming.averageRating || 0) > (current.averageRating || 0);
    };

    // Build indices into the merged array for fast duplicate lookup
    const isbnIndex = new Map();
    const normIndex = new Map();
    const merged = [...existingBooks];

    for (let i = 0; i < merged.length; i++) {
      const b = merged[i];
      if (b.isbn13) isbnIndex.set(b.isbn13, i);
      normIndex.set(normBookKey(b), i);
    }

    let genuinelyNew = 0;
    let deduplicated = 0;

    for (const newBook of result.books) {
      // Check by ISBN first (most reliable dedup key)
      let existingIdx = newBook.isbn13 ? isbnIndex.get(newBook.isbn13) : undefined;
      // Fall back to normalised title+author
      if (existingIdx === undefined) {
        existingIdx = normIndex.get(normBookKey(newBook));
      }

      if (existingIdx !== undefined) {
        // Already in pool - update only if the new entry is strictly better
        if (isBetterEntry(newBook, merged[existingIdx])) {
          merged[existingIdx] = newBook;
        }
        deduplicated++;
      } else {
        // Genuinely new - append and register in both indices
        const idx = merged.length;
        merged.push(newBook);
        if (newBook.isbn13) isbnIndex.set(newBook.isbn13, idx);
        normIndex.set(normBookKey(newBook), idx);
        genuinelyNew++;
      }
    }

    // Replace only this genre's slot; all other genres are untouched
    cache.genres[genreKey] = merged;
    cache.lastRefreshedGenre = genreKey;
    cache.lastRefreshedAt = new Date().toISOString();

    // Persist and update in-memory state
    await this.saveCacheToFile(cache);
    this.cache = cache;
    this.lastGenerated = new Date();

    const totalInGenre = merged.length;
    const elapsed = Date.now() - startTime;
    console.log(
      `[DiscoveryCache] refreshGenre: "${genreKey}" complete in ${elapsed}ms` +
      ` — before: ${previousCount}, scraped: ${result.books.length},` +
      ` new: ${genuinelyNew}, duplicates: ${deduplicated}, total: ${totalInGenre}`
    );

    return {
      genre: genreKey,
      booksAdded: genuinelyNew,
      totalInGenre,
      generatedAt: cache.lastRefreshedAt
    };
  }

  clearCache() {
    this.cache = null;
    this.lastGenerated = null;
    console.log('[DiscoveryCache] Memory cache cleared');
  }

  async deleteCacheFile() {
    try {
      await fs.unlink(this.cacheFile);
      console.log(`[DiscoveryCache] Cache file deleted: ${this.cacheFile}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[DiscoveryCache] Error deleting cache file:', error);
      }
    }
  }

  getCacheStats() {
    if (!this.cache) {
      return { hasCache: false };
    }

    const stats = {
      hasCache: true,
      generatedAt: this.cache.generatedAt,
      genres: {}
    };

    for (const [genreKey, books] of Object.entries(this.cache.genres)) {
      stats.genres[genreKey] = {
        bookCount: books.length,
        hasCovers: books.filter(b => b.coverUrl && !b.coverUrl.includes('placeholder')).length
      };
    }

    return stats;
  }

  /**
   * Get master cache statistics
   */
  getMasterCacheStats() {
    return masterBookCache.getStats();
  }

  deduplicateBooksAcrossGenres(cache) {
    // No longer needed with ISBN-based master cache
    // Books can belong to multiple genres
    return cache;
  }
}

module.exports = new DiscoveryCache();
