/**
 * Cache Cleaner Utility
 *
 * Functions to clean, validate, and report on the discovery cache.
 * This can be used to manually clean existing caches or audit them.
 */

const fs = require('fs').promises;
const path = require('path');
const bookValidator = require('./bookValidator');

const DATA_DIR = path.join(__dirname, '../../data');
const DEFAULT_CACHE_PATH = path.join(DATA_DIR, 'discovery_cache.json');

/**
 * Clean existing cache file by applying validation filters
 * Reads the cache, validates each book, removes invalid ones, and saves back
 *
 * @param {string} cachePath - Path to cache file (default: data/discovery_cache.json)
 * @returns {Object} - Result with stats on what was cleaned
 */
async function cleanExistingCache(cachePath = DEFAULT_CACHE_PATH) {
  console.log(`[CacheCleaner] Reading cache from: ${cachePath}`);

  try {
    const data = await fs.readFile(cachePath, 'utf8');
    const cache = JSON.parse(data);

    if (!cache.genres) {
      throw new Error('Invalid cache format: missing genres');
    }

    const stats = {
      genres: {},
      totalRemoved: 0,
      totalKept: 0,
      genresProcessed: 0,
    };

    for (const [genreKey, books] of Object.entries(cache.genres)) {
      if (!Array.isArray(books)) {
        console.warn(`[CacheCleaner] Genre ${genreKey} is not an array, skipping`);
        continue;
      }

      const genreStats = {
        original: books.length,
        removed: 0,
        kept: 0,
        reasons: {},
      };

      const validBooks = [];

      for (const book of books) {
        const validation = bookValidator.isValidBook(book);

        if (validation.valid) {
          validBooks.push(book);
          genreStats.kept++;
        } else {
          genreStats.removed++;
          genreStats.reasons[validation.reason] = (genreStats.reasons[validation.reason] || 0) + 1;
        }
      }

      cache.genres[genreKey] = validBooks;
      stats.genres[genreKey] = genreStats;
      stats.totalRemoved += genreStats.removed;
      stats.totalKept += genreStats.kept;
      stats.genresProcessed++;

      console.log(`[CacheCleaner] ${genreKey}: kept ${genreStats.kept}, removed ${genreStats.removed}`);
    }

    // Update generated timestamp to reflect cleaning
    cache.cleanedAt = new Date().toISOString();

    // Save the cleaned cache
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
    console.log(`[CacheCleaner] Cleaned cache saved to: ${cachePath}`);

    return {
      success: true,
      stats,
      message: `Cleaned ${stats.genresProcessed} genres, removed ${stats.totalRemoved} invalid books, kept ${stats.totalKept} valid books`,
    };
  } catch (error) {
    console.error(`[CacheCleaner] Error cleaning cache:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Validate cache integrity without modifying it
 * Audits the cache and returns a detailed report
 *
 * @param {string} cachePath - Path to cache file (default: data/discovery_cache.json)
 * @returns {Object} - Validation report with detailed statistics
 */
async function validateCacheIntegrity(cachePath = DEFAULT_CACHE_PATH) {
  console.log(`[CacheCleaner] Validating cache: ${cachePath}`);

  try {
    const data = await fs.readFile(cachePath, 'utf8');
    const cache = JSON.parse(data);

    if (!cache.genres) {
      throw new Error('Invalid cache format: missing genres');
    }

    const report = {
      cacheInfo: {
        generatedAt: cache.generatedAt,
        cleanedAt: cache.cleanedAt || null,
        totalGenres: Object.keys(cache.genres).length,
      },
      genres: {},
      summary: {
        totalBooks: 0,
        validBooks: 0,
        invalidBooks: 0,
        duplicates: 0,
        issues: {},
      },
    };

    // Track for duplicate detection
    const seenIsbns = new Set();
    const seenTitleAuthor = new Set();

    for (const [genreKey, books] of Object.entries(cache.genres)) {
      if (!Array.isArray(books)) {
        report.genres[genreKey] = {
          error: 'Not an array',
          valid: 0,
          invalid: 0,
          duplicates: 0,
        };
        continue;
      }

      const genreReport = {
        total: books.length,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        reasons: {},
        samples: [],
      };

      for (const book of books) {
        report.summary.totalBooks++;

        // Check for duplicates
        const isbnKey = book.isbn13 || '';
        const titleKey = book.title?.toLowerCase().trim() || '';
        const authorKey = (Array.isArray(book.authors) ? book.authors[0] : book.author)?.toLowerCase().trim() || '';
        const compositeKey = `${titleKey}|${authorKey}`;

        let isDuplicate = false;
        if (isbnKey && seenIsbns.has(isbnKey)) {
          isDuplicate = true;
        } else if (seenTitleAuthor.has(compositeKey)) {
          isDuplicate = true;
        }

        if (isDuplicate) {
          genreReport.duplicates++;
          report.summary.duplicates++;
          if (genreReport.samples.length < 5) {
            genreReport.samples.push({
              title: book.title,
              author: authorKey,
              issue: 'Duplicate',
            });
          }
          if (isbnKey) seenIsbns.add(isbnKey);
          seenTitleAuthor.add(compositeKey);
          continue;
        }

        if (isbnKey) seenIsbns.add(isbnKey);
        seenTitleAuthor.add(compositeKey);

        // Validate book
        const validation = bookValidator.isValidBook(book);
        if (validation.valid) {
          genreReport.valid++;
          report.summary.validBooks++;
        } else {
          genreReport.invalid++;
          report.summary.invalidBooks++;
          genreReport.reasons[validation.reason] = (genreReport.reasons[validation.reason] || 0) + 1;
          report.summary.issues[validation.reason] = (report.summary.issues[validation.reason] || 0) + 1;

          if (genreReport.samples.length < 5) {
            genreReport.samples.push({
              title: book.title,
              author: authorKey,
              issue: validation.reason,
            });
          }
        }
      }

      report.genres[genreKey] = genreReport;
    }

    return {
      success: true,
      report,
    };
  } catch (error) {
    console.error(`[CacheCleaner] Error validating cache:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate a detailed report of cache issues
 * Similar to validate but focused on generating a readable report
 *
 * @param {string} cachePath - Path to cache file (default: data/discovery_cache.json)
 * @returns {Object} - Report with statistics by issue type
 */
async function generateReport(cachePath = DEFAULT_CACHE_PATH) {
  const result = await validateCacheIntegrity(cachePath);

  if (!result.success) {
    return result;
  }

  const { report } = result;

  // Format a human-readable summary
  const lines = [];
  lines.push('=== Discovery Cache Validation Report ===');
  lines.push(`Generated: ${report.cacheInfo.generatedAt}`);
  lines.push(`Cleaned: ${report.cacheInfo.cleanedAt || 'Never'}`);
  lines.push('');
  lines.push(`Total Books: ${report.summary.totalBooks}`);
  lines.push(`Valid: ${report.summary.validBooks} (${((report.summary.validBooks / report.summary.totalBooks) * 100).toFixed(1)}%)`);
  lines.push(`Invalid: ${report.summary.invalidBooks} (${((report.summary.invalidBooks / report.summary.totalBooks) * 100).toFixed(1)}%)`);
  lines.push(`Duplicates: ${report.summary.duplicates}`);
  lines.push('');

  if (Object.keys(report.summary.issues).length > 0) {
    lines.push('Issues by Type:');
    for (const [issue, count] of Object.entries(report.summary.issues)) {
      lines.push(`  - ${issue}: ${count}`);
    }
    lines.push('');
  }

  lines.push('By Genre:');
  for (const [genre, stats] of Object.entries(report.genres)) {
    lines.push(`  ${genre}:`);
    lines.push(`    Total: ${stats.total}`);
    lines.push(`    Valid: ${stats.valid}`);
    lines.push(`    Invalid: ${stats.invalid}`);
    lines.push(`    Duplicates: ${stats.duplicates}`);

    if (stats.samples && stats.samples.length > 0) {
      lines.push(`    Sample issues:`);
      for (const sample of stats.samples) {
        lines.push(`      - "${sample.title}" by ${sample.author}: ${sample.issue}`);
      }
    }
  }

  return {
    success: true,
    report,
    textReport: lines.join('\n'),
  };
}

/**
 * Get a quick summary of cache health
 *
 * @param {string} cachePath - Path to cache file (default: data/discovery_cache.json)
 * @returns {Object} - Quick health summary
 */
async function getCacheHealth(cachePath = DEFAULT_CACHE_PATH) {
  const result = await validateCacheIntegrity(cachePath);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const { report } = result;
  const total = report.summary.totalBooks;
  const valid = report.summary.validBooks;
  const invalid = report.summary.invalidBooks;
  const duplicates = report.summary.duplicates;

  let health = 'excellent';
  if (invalid > total * 0.1 || duplicates > total * 0.1) {
    health = 'poor';
  } else if (invalid > 0 || duplicates > 0) {
    health = 'fair';
  }

  return {
    success: true,
    health,
    stats: {
      total,
      valid,
      invalid,
      duplicates,
      validPercent: total > 0 ? ((valid / total) * 100).toFixed(1) : 0,
    },
    needsCleaning: invalid > 0 || duplicates > 0,
  };
}

module.exports = {
  cleanExistingCache,
  validateCacheIntegrity,
  generateReport,
  getCacheHealth,
  DEFAULT_CACHE_PATH,
};
