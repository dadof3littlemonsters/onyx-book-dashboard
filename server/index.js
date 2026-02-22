require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { execFile } = require('child_process');
const prowlarrService = require('./services/prowlarr');
const qbittorrentService = require('./services/qbittorrent');
const dataStore = require('./services/dataStore');
const audiobookshelfService = require('./services/audiobookshelf');
const MetadataAggregator = require('./metadata_aggregator');
const LibraryScanner = require('./scanner');
const TimeoutHandler = require('./utils/timeout');
const googleBooksApi = require('./services/googleBooksApi');
const coverResolver = require('./services/coverResolver');
const discoveryCache = require('./services/discoveryCache');
// const aiBookCurator = require('./services/aiBookCurator'); // Temporarily disabled - file deleted
const cacheCleaner = require('./utils/cacheCleaner');
const masterBookCache = require('./services/masterBookCache');
const { mockBooks } = require('./mockData');
const telegramService = require('./services/telegram');
const directDownloadService = require('./services/directDownload');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Process-level Error Handlers ---
// Prevents server from crashing on unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] at:', promise, 'reason:', reason);
  // Don't exit - log and continue
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  // Log but don't crash immediately - give time to cleanup
  // In production, you might want to exit gracefully after logging
  if (process.env.NODE_ENV === 'production') {
    // Give time for logging, then exit
    setTimeout(() => process.exit(1), 1000);
  }
});

// Initialize services
const metadataAggregator = new MetadataAggregator();
const libraryScanner = new LibraryScanner();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "*.audnex.us", "*.hardcover.app", "*.m.media-amazon.com"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Rate limiter for login endpoint - prevents brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// --- Admin auth (PIN-backed signed cookie) ---
const ADMIN_COOKIE_NAME = 'onyx_admin';
const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getAdminSecret() {
  return (process.env.ADMIN_PIN || '1905').trim();
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function signAdminSession(ts, secret) {
  return crypto.createHmac('sha256', secret).update(String(ts)).digest('hex');
}

function isValidAdminCookie(value, secret) {
  if (!value || !secret) return false;
  const parts = String(value).split('.');
  if (parts.length !== 2) return false;
  const [tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return false;

  // Expire old sessions
  const age = Date.now() - ts;
  if (age < 0 || age > ADMIN_SESSION_MAX_AGE_MS) return false;

  const expected = signAdminSession(ts, secret);
  // Constant-time compare to reduce leakage
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const secret = getAdminSecret();
  if (!secret) {
    return res.status(500).json({ error: 'ADMIN_PIN not configured on server' });
  }

  // Allow header-based auth for scripts/tools if desired
  const headerPin = (req.headers['x-admin-pin'] || '').toString().trim();
  if (headerPin && headerPin === secret) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieVal = cookies[ADMIN_COOKIE_NAME];
  if (isValidAdminCookie(cookieVal, secret)) {
    return next();
  }

  return res.status(401).json({ error: 'Admin authentication required' });
}

// Check if current user is admin (for client-side UI)
app.get('/api/user/is-admin', requireAdmin, (req, res) => {
  // If we reach here, user is authenticated as admin
  res.json({
    isAdmin: true
  });
});


// --- Admin auth (PIN-backed signed cookie) ---

// API Routes
app.get('/api/books/:category', async (req, res) => {
  console.log('[API] Route /api/books/:category hit');
  const { category } = req.params;
  const { search, useDynamic = 'true' } = req.query;
  console.log(`[API] /api/books/${category} called, search=${search}, useDynamic=${useDynamic}`);

  try {
    let books = [];

    // Mock mode is allowed only in non-production for local dev.
    if (useDynamic !== 'true') {
      if (process.env.NODE_ENV === 'production') {
        return res.json([]);
      }
      books = mockBooks[category] || [];
    } else {
      console.log(`Fetching books for category: ${category}`);
      console.log('GOOGLE_BOOKS_API_KEY present?', !!process.env.GOOGLE_BOOKS_API_KEY);

      const discoveryGenreMap = {
        'romantasy': 'romantasy',
        'fantasy': 'fantasy',
        'highFantasy': 'fantasy',
        'dystopian': 'scifi',
        'scifi': 'scifi',
        'sciFi': 'scifi',
        'cozy': 'cozy',
        'cozy_fantasy': 'cozy',
        'palateCleanser': 'cozy',
        'fairy_tale_retellings': 'fairy_tale_retellings',
        'post_apocalyptic': 'post_apocalyptic',
        'enemies_to_lovers': 'enemies_to_lovers',
        'popular': 'popular',
        'hidden_gems': 'hidden_gems',
        'new_releases': 'new_releases',
        'booktok_trending': 'booktok_trending',
        'action_adventure': 'action_adventure',
        'dark_fantasy': 'dark_fantasy',
        'dragons': 'dragons',
        'bestSellers': 'best_sellers',
        'best_sellers': 'best_sellers'
      };

      const discoveryGenre = discoveryGenreMap[category];
      console.log(`Discovery genre mapping: ${category} -> ${discoveryGenre}`);
      if (discoveryGenre && process.env.GOOGLE_BOOKS_API_KEY) {
        try {
          const discoveryBooks = await discoveryCache.getRandomizedBooks(discoveryGenre, 50);
          books = discoveryBooks.map(book => ({
            id: book.googleBooksId || book.isbn13 || `google-${Math.random()}`,
            title: book.title || 'Unknown Title',
            author: Array.isArray(book.authors) ? book.authors.join(', ') : (book.author || 'Unknown Author'),
            thumbnail: book.thumbnail || book.coverUrl,
            synopsis: book.description || '',
            rating: book.averageRating || null,
            pages: book.pageCount || null,
            source: 'google_books'
          }));
          console.log(`✅ Using Google Books discovery cache for ${category} (${books.length} books)`);
        } catch (error) {
          console.error(`Error fetching from discovery cache for ${category}:`, error);
          books = [];
        }
      } else {
        // No Google Books API key - return empty array
        console.log(`No Google Books API key available for ${category}`);
        books = [];
      }

      // Overlay ownership status (ABS library) without mutating Hardcover truth.
      books = await Promise.all(books.map(async (book) => {
        const ownership = libraryScanner.checkOwnership(book.title, book.author);
        return {
          ...book,
          libraryStatus: ownership.owned ? 'owned' : 'available',
          exactMatch: ownership.exactMatch,
          fuzzyMatch: ownership.fuzzyMatch
        };
      }));
    }

    // Apply search filter if provided (client-side convenience)
    if (search) {
      const q = search.toLowerCase();
      books = books.filter(book =>
        (book.title || '').toLowerCase().includes(q) ||
        (book.author || '').toLowerCase().includes(q)
      );
    }

    res.json(books);
  } catch (error) {
    console.error(`Error fetching books for category ${category}:`, error);
    // Hardcover-only policy: return empty array on error, no mock fallback.
    res.json([]);
  }
});


app.get('/api/book/:id', (req, res) => {
  // This endpoint previously served mock data. To enforce Hardcover-only truth,
  // it's intentionally disabled. Use /api/search or /api/books/:category instead.
  res.status(410).json({
    error: 'Endpoint removed',
    message: 'Use /api/search or /api/books/:category (Hardcover-only).'
  });
});

// Webhook endpoint for qBittorrent download completion
app.post('/api/webhook/download-complete', async (req, res) => {
  const { hash, name, path: contentPath, tracker, category } = req.body;

  console.log(`[WEBHOOK] Download complete: ${name}`);
  console.log(`  Path: ${contentPath} | Tracker: ${tracker} | Category: ${category}`);

  if (!contentPath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Sanitize inputs to prevent command injection
  const sanitizeString = (str, allowedChars = '[\\w\\s\\-._]') => {
    return (str || '').replace(new RegExp(`[^${allowedChars}]`, 'g'), '');
  };

  const sanitizePath = (str) => {
    // Allow path characters: alphanumeric, spaces, slashes, dots, hyphens, underscores
    return (str || '').replace(/[^\w\s\/._\-]/g, '');
  };

  const sanitizedHash = sanitizeString(hash || 'webhook');
  const sanitizedName = sanitizeString(name);
  const sanitizedPath = sanitizePath(contentPath);
  const sanitizedTracker = sanitizeString(tracker || 'unknown');
  const sanitizedCategory = sanitizeString(category || 'books');

  // Use execFile with argument array instead of execSync with string interpolation
  // This prevents command injection attacks
  execFile('node', ['/app/scripts/process-download.js', sanitizedHash, sanitizedName, sanitizedPath, sanitizedTracker, sanitizedCategory], {
    timeout: 60000
  }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[WEBHOOK] Processing error:`, error.message);
      return res.status(500).json({ error: error.message, output: stdout });
    }
    console.log(`[WEBHOOK] Processing result:`, stdout);
    res.json({ success: true, output: stdout });
  });
});


app.post('/api/request/:id', async (req, res) => {
  const { id } = req.params;
  const { title, author, requestTypes, userId, userEmail, username } = req.body;

  try {
    const request = await dataStore.addRequest({
      bookId: id,
      title: title || `Book ${id}`,
      author: author || 'Unknown Author',
      type: 'book',
      requestTypes: requestTypes || { audiobook: false, ebook: true },
      requestedBy: userId || 'anonymous',
      userEmail: userEmail,
      username: username,
      submittedAt: new Date().toISOString()
    });

    console.log(`Book request submitted: ${title} by ${author} for user ${username} (${userEmail})`);

    res.json({
      success: true,
      message: 'Book request submitted successfully',
      requestId: request.id,
      status: 'pending',
      requestTypes: requestTypes,
      user: { id: userId, username, email: userEmail }
    });
  } catch (error) {
    console.error('Error submitting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit request'
    });
  }
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.json([]);
  }

  try {
    console.log(`[SEARCH] Query: "${q}"`);

    const hardcoverQuery = `
      query SearchBooks($query: String!) {
        search(query: $query) {
          results
        }
      }
    `;

    TimeoutHandler.logAuthHeader('Hardcover', process.env.HARDCOVER_TOKEN?.trim(), `(search: ${q.trim()})`);

    const apiUrl = 'https://api.hardcover.app/v1/graphql';
    const hardcoverResponse = await TimeoutHandler.fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN?.trim() || ''}`,
      },
      body: JSON.stringify({
        query: hardcoverQuery,
        variables: {
          query: q.trim()
        }
      })
    }, 10000);

    let results = [];

    if (hardcoverResponse.ok) {
      const contentType = hardcoverResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[SEARCH] Hardcover returned HTML instead of JSON`);
        throw new Error('Hardcover returned HTML - check authentication');
      }

      const hardcoverData = await hardcoverResponse.json();

      if (hardcoverData.errors) {
        console.error('[SEARCH] GraphQL Errors:', JSON.stringify(hardcoverData.errors, null, 2));
        throw new Error(`GraphQL error: ${hardcoverData.errors[0]?.message || 'Unknown error'}`);
      }

      if (hardcoverData.data?.search?.results?.hits && Array.isArray(hardcoverData.data.search.results.hits)) {
        console.log(`[SEARCH] ✅ Found ${hardcoverData.data.search.results.hits.length} results for "${q}"`);

        results = hardcoverData.data.search.results.hits.slice(0, 50).map(hit => ({
          id: `hardcover-${hit.document.id}`,
          title: hit.document.title,
          subtitle: hit.document.subtitle,
          author: hit.document.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: hit.document.image?.url ? `/api/proxy-image?url=${encodeURIComponent(hit.document.image.url)}` : null,
          thumbnail: hit.document.image?.url ? `/api/proxy-image?url=${encodeURIComponent(hit.document.image.url)}` : null,
          coverUrl: hit.document.image?.url ? `/api/proxy-image?url=${encodeURIComponent(hit.document.image.url)}` : null,
          synopsis: hit.document.description,
          rating: null,
          pages: hit.document.pages,
          publishDate: null,
          series: null,
          seriesPosition: null,
          reviewsCount: null,
          source: 'hardcover',
          category: 'search'
        }));
      } else {
        console.log(`[SEARCH] ⚠️ No results for "${q}"`);
      }
    } else {
      console.error(`[SEARCH] HTTP ${hardcoverResponse.status}: ${apiUrl}`);
    }

    res.json(results);
  } catch (error) {
    console.error('[SEARCH] Critical error:', error.message);
    TimeoutHandler.handleError('Search', error, 'Search temporarily unavailable');
    res.json([]);
  }
});

// Admin discovery routes - must come before generic discovery routes
app.post('/api/admin/discovery/generate-cache', requireAdmin, async (req, res) => {
  try {
    const cache = await discoveryCache.generateDailyCache();

    res.json({
      success: true,
      message: 'Discovery cache generated successfully',
      generatedAt: cache.generatedAt,
      stats: discoveryCache.getCacheStats()
    });
  } catch (error) {
    console.error('Error generating discovery cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate discovery cache: ' + error.message
    });
  }
});

// Initial population endpoint - forces full cache generation
app.post('/api/admin/discovery/initial-population', requireAdmin, async (req, res) => {
  try {
    console.log('[ADMIN] Starting initial population with full book counts...');
    const cache = await discoveryCache.generateDailyCache(true); // Force initial population

    res.json({
      success: true,
      message: 'Initial population completed successfully',
      generatedAt: cache.generatedAt,
      stats: discoveryCache.getCacheStats()
    });
  } catch (error) {
    console.error('[ADMIN] Initial population error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/discovery/clear-cache', requireAdmin, async (req, res) => {
  try {
    discoveryCache.clearCache();
    await discoveryCache.deleteCacheFile();

    res.json({
      success: true,
      message: 'Discovery cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing discovery cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear discovery cache: ' + error.message
    });
  }
});

// Nuke endpoint - wipes both discovery and master caches for a clean-slate reset
app.post('/api/admin/cache/nuke', requireAdmin, async (req, res) => {
  try {
    await masterBookCache.init();

    // Clear in-memory state and delete files for both caches
    discoveryCache.clearCache();
    await discoveryCache.deleteCacheFile();
    await masterBookCache.clear();

    console.log('[Admin] Cache nuke complete: discovery_cache.json and master_book_cache.json wiped');

    res.json({
      success: true,
      message: 'Both caches have been wiped. Trigger /api/admin/discovery/generate-cache to rebuild.',
      cleared: ['discovery_cache.json', 'master_book_cache.json']
    });
  } catch (error) {
    console.error('Error nuking caches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to nuke caches: ' + error.message
    });
  }
});

// Cache validation endpoint - audits cache without modifying
app.get('/api/admin/discovery/validate', requireAdmin, async (req, res) => {
  try {
    const result = await cacheCleaner.validateCacheIntegrity();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to validate cache: ' + result.error
      });
    }

    res.json({
      success: true,
      report: result.report
    });
  } catch (error) {
    console.error('Error validating discovery cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate cache: ' + error.message
    });
  }
});

// Cache health check - quick summary
app.get('/api/admin/discovery/health', requireAdmin, async (req, res) => {
  try {
    const result = await cacheCleaner.getCacheHealth();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to get cache health: ' + result.error
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting cache health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache health: ' + error.message
    });
  }
});

// Cache cleaning endpoint - removes invalid books from existing cache
app.post('/api/admin/discovery/clean', requireAdmin, async (req, res) => {
  try {
    const result = await cacheCleaner.cleanExistingCache();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to clean cache: ' + result.error
      });
    }

    // Clear in-memory cache so it gets reloaded with cleaned data
    discoveryCache.clearCache();

    res.json({
      success: true,
      message: result.message,
      stats: result.stats
    });
  } catch (error) {
    console.error('Error cleaning discovery cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean cache: ' + error.message
    });
  }
});

// Per-genre cache regeneration endpoint
app.post('/api/admin/discovery/regenerate-genre', requireAdmin, async (req, res) => {
  try {
    const { genre } = req.body;

    if (!genre) {
      return res.status(400).json({
        success: false,
        message: 'Genre is required'
      });
    }

    console.log(`[ADMIN] Regenerating cache for genre: ${genre}`);

    // Get the genre mapping
    const genreMapping = discoveryCache.genreMappings[genre];
    if (!genreMapping) {
      return res.status(404).json({
        success: false,
        message: `Unknown genre: ${genre}`
      });
    }

    let books = [];
    if (genreMapping.aiPrompt) {
      console.log(`[ADMIN] Using AI curation for ${genre}`);
      // books = await aiBookCurator.generateAndEnrich(genreMapping.aiPrompt);
      return res.status(503).json({
        success: false,
        message: `AI curation temporarily disabled - use initial population endpoint instead`
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Genre ${genre} does not have AI curation configured`
      });
    }

    // Load existing cache from disk first to preserve other genres
    if (!discoveryCache.cache) {
      await discoveryCache.loadCacheFromFile();
    }

    // Initialize cache structure if needed
    if (!discoveryCache.cache) {
      discoveryCache.cache = { generatedAt: new Date().toISOString(), genres: {} };
    }
    if (!discoveryCache.cache.genres) {
      discoveryCache.cache.genres = {};
    }

    // Update only this genre
    discoveryCache.cache.genres[genre] = books.slice(0, 40);

    // Save updated cache to file
    await discoveryCache.saveCacheToFile(discoveryCache.cache);
    discoveryCache.lastGenerated = new Date();

    console.log(`[ADMIN] Genre ${genre} regenerated with ${books.length} books`);

    res.json({
      success: true,
      message: `Genre "${genre}" regenerated successfully`,
      genre,
      bookCount: books.length,
      generatedAt: discoveryCache.cache.generatedAt
    });
  } catch (error) {
    console.error('Error regenerating genre cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate genre: ' + error.message
    });
  }
});

// Get detailed cache stats per genre
app.get('/api/admin/discovery/genre-stats', requireAdmin, async (req, res) => {
  try {
    const stats = discoveryCache.getCacheStats();

    // Add schedule information for each genre
    const genreSchedules = {
      best_sellers: { schedule: 'weekly', description: 'Sundays' },
      booktok_trending: { schedule: 'weekly', description: 'Sundays' },
      popular: { schedule: 'weekly', description: 'Sundays' },
      new_releases: { schedule: 'weekly', description: 'Sundays' },
      hidden_gems: { schedule: 'monthly', description: '1st of month' },
      romantasy: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' },
      fantasy: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' },
      action_adventure: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' },
      scifi: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' },
      dark_fantasy: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' },
      dragons: { schedule: 'quarterly', description: 'Jan 1, Apr 1, Jul 1, Oct 1' }
    };

    const detailedStats = {
      hasCache: stats.hasCache,
      generatedAt: stats.generatedAt,
      genres: {}
    };

    if (stats.genres) {
      for (const [genreKey, genreStats] of Object.entries(stats.genres)) {
        detailedStats.genres[genreKey] = {
          ...genreStats,
          schedule: genreSchedules[genreKey]?.schedule || 'unknown',
          scheduleDescription: genreSchedules[genreKey]?.description || 'N/A'
        };
      }
    }

    // Include all configured genres even if not yet cached
    for (const [genreKey, schedule] of Object.entries(genreSchedules)) {
      if (!detailedStats.genres[genreKey]) {
        detailedStats.genres[genreKey] = {
          bookCount: 0,
          hasCovers: 0,
          cached: false,
          schedule: schedule.schedule,
          scheduleDescription: schedule.description
        };
      }
    }

    res.json(detailedStats);
  } catch (error) {
    console.error('Error getting genre stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get genre stats: ' + error.message
    });
  }
});

// Cache regeneration endpoint - clears and regenerates with strict filtering
app.post('/api/admin/discovery/regenerate', requireAdmin, async (req, res) => {
  try {
    console.log('[ADMIN] Starting cache regeneration with strict filtering...');

    // First, clear existing cache
    discoveryCache.clearCache();
    await discoveryCache.deleteCacheFile();
    console.log('[ADMIN] Old cache cleared');

    // Generate new cache (will use bookValidator filtering)
    const cache = await discoveryCache.generateDailyCache();

    res.json({
      success: true,
      message: 'Discovery cache regenerated successfully with strict filtering',
      generatedAt: cache.generatedAt,
      stats: discoveryCache.getCacheStats()
    });
  } catch (error) {
    console.error('Error regenerating discovery cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate cache: ' + error.message
    });
  }
});

// Discovery routes
app.get('/api/discovery/:genre', async (req, res) => {
  const { genre } = req.params;
  const { count = 50 } = req.query;

  const validGenres = [
    'new_releases', 'hidden_gems', 'popular', 'fantasy',
    'scifi', 'romantasy', 'cozy', 'awards', 'series_starters'
  ];

  if (!validGenres.includes(genre)) {
    return res.status(400).json({
      error: 'Invalid genre',
      message: `Valid genres: ${validGenres.join(', ')}`
    });
  }

  try {
    const books = await discoveryCache.getRandomizedBooks(genre, parseInt(count));
    res.json({
      success: true,
      genre,
      count: books.length,
      books
    });
  } catch (error) {
    console.error(`Error fetching discovery books for genre ${genre}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discovery books'
    });
  }
});

app.get('/api/discovery/stats', async (req, res) => {
  try {
    const stats = discoveryCache.getCacheStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching discovery stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discovery stats'
    });
  }
});

// Health check endpoint for monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: process.memoryUsage()
  });
});

// Admin routes
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { pin } = req.body;
  const adminPin = getAdminSecret();

  if ((pin || '').toString().trim() === adminPin) {
    const ts = Date.now();
    const sig = signAdminSession(ts, adminPin);
    const cookieVal = `${ts}.${sig}`;

    res.cookie(ADMIN_COOKIE_NAME, cookieVal, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_MAX_AGE_MS
    });

    return res.json({
      success: true,
      message: 'Admin authenticated'
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid PIN'
  });
});


app.get('/api/admin/requests', requireAdmin, async (req, res) => {
  try {
    const requests = await dataStore.getPendingRequests();
    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

app.post('/api/admin/search/:requestId', requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  const { query } = req.body;

  try {
    // Get request details to determine what type to search for
    const request = await dataStore.getRequestById(requestId);

    // Unified search: query both Prowlarr and Telegram in parallel
    const [prowlarrResults, telegramResults] = await Promise.all([
      prowlarrService.search(query).catch(err => {
        console.error('Prowlarr search failed:', err.message);
        return [];
      }),
      telegramService.search(query).catch(err => {
        console.error('Telegram search failed:', err.message);
        return [];
      }),
    ]);

    // Format Prowlarr results with source field
    const formattedProwlarr = prowlarrResults.map(result => ({
      ...result,
      source: 'prowlarr',
      formattedSize: prowlarrService.formatSize(result.size),
      categoryName: prowlarrService.getCategoryName(result.category),
    }));

    // Format Telegram results with source field
    const formattedTelegram = telegramResults.map(result => ({
      ...result,
      source: 'telegram',
      formattedSize: result.size || 'Unknown',
      categoryName: result.format ? result.format.toUpperCase() : 'Ebook',
      seeders: 'Direct',
      leechers: 0,
    }));

    // Merge results: Prowlarr first (torrents), then Telegram (direct)
    const allResults = [...formattedProwlarr, ...formattedTelegram];

    res.json({
      success: true,
      results: allResults,
      total: allResults.length,
      sources: {
        prowlarr: formattedProwlarr.length,
        telegram: formattedTelegram.length,
      },
    });
  } catch (error) {
    console.error('Error in unified search:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed: ' + error.message,
    });
  }
});

app.post('/api/admin/download/:requestId', requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  const { magnetUrl, title, tracker, source, downloadInfo } = req.body;

  try {
    let downloadResult;

    // Unified download: dispatch based on source
    if (source === 'telegram') {
      // Telegram direct download
      console.log(`[Download] Using Telegram for: ${title}`);
      const telegramResult = await telegramService.download(downloadInfo || { title });

      if (telegramResult.success && telegramResult.filePath) {
        // Process the downloaded file
        const processResult = await directDownloadService.processDownload(
          telegramResult.filePath,
          telegramResult.fileName,
          'telegram'
        );
        downloadResult = {
          success: processResult.success,
          message: processResult.message,
        };
      } else {
        downloadResult = telegramResult;
      }
    } else {
      // Default: qBittorrent torrent download
      console.log(`[Download] Using qBittorrent for: ${title}`);
      downloadResult = await qbittorrentService.addTorrent(magnetUrl);
    }

    if (downloadResult.success) {
      await dataStore.updateRequestStatus(requestId, 'approved', {
        magnetUrl: magnetUrl || null,
        title,
        tracker: tracker || source,
        source: source || 'prowlarr',
        downloadedAt: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: downloadResult.message || 'Download started successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        message: downloadResult.message,
      });
    }
  } catch (error) {
    console.error('Error starting download:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start download: ' + error.message,
    });
  }
});

app.get('/api/admin/history', requireAdmin, async (req, res) => {
  try {
    const history = await dataStore.getHistory();
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Import log routes
const importLog = require('./services/importLog');

app.get('/api/admin/import-log', requireAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const imports = importLog.getImports(parseInt(limit));
    res.json(imports);
  } catch (error) {
    console.error('Error fetching import log:', error);
    res.status(500).json({ error: 'Failed to fetch import log' });
  }
});

app.get('/api/admin/import-log/stats', requireAdmin, async (req, res) => {
  try {
    const stats = importLog.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching import stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.delete('/api/admin/import-log/cleanup', requireAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const result = importLog.clearOldImports(days);
    res.json(result);
  } catch (error) {
    console.error('Error cleaning up import log:', error);
    res.status(500).json({ error: 'Failed to cleanup import log' });
  }
});

// Telegram integration routes
app.get('/api/telegram/status', async (req, res) => {
  try {
    const status = telegramService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting Telegram status:', error);
    res.status(500).json({ error: 'Failed to get Telegram status' });
  }
});

app.post('/api/telegram/auth/phone', requireAdmin, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number required' });
    }
    const result = await telegramService.sendPhoneNumber(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error sending phone number:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/telegram/auth/code', requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Code required' });
    }
    const result = await telegramService.sendCode(code);
    res.json(result);
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/telegram/auth/password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }
    const result = await telegramService.sendPassword(password);
    res.json(result);
  } catch (error) {
    console.error('Error verifying 2FA password:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/telegram/search', requireAdmin, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query required', results: [] });
    }
    const results = await telegramService.search(query);
    res.json({ success: true, results, total: results.length });
  } catch (error) {
    console.error('Error searching via Telegram:', error);
    res.status(500).json({ success: false, message: error.message, results: [] });
  }
});

app.post('/api/telegram/download', requireAdmin, async (req, res) => {
  try {
    const { downloadInfo, title } = req.body;
    const result = await telegramService.download(downloadInfo || { title });

    if (result.success && result.filePath) {
      // Process the downloaded file
      const processResult = await directDownloadService.processDownload(
        result.filePath,
        result.fileName,
        'telegram'
      );
      res.json({
        success: processResult.success,
        message: processResult.message,
        filePath: result.filePath,
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('Error downloading via Telegram:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Library management routes
app.post('/api/admin/scan-library', requireAdmin, async (req, res) => {
  try {
    const { forceRescan = false } = req.body;
    const libraryItems = await libraryScanner.scanLibrary(forceRescan);

    res.json({
      success: true,
      message: 'Library scan completed',
      items: libraryItems.length,
      stats: await libraryScanner.getLibraryStats()
    });
  } catch (error) {
    console.error('Error scanning library:', error);
    res.status(500).json({
      success: false,
      message: 'Library scan failed: ' + error.message
    });
  }
});

app.get('/api/admin/library-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await libraryScanner.getLibraryStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching library stats:', error);
    res.status(500).json({ error: 'Failed to fetch library stats' });
  }
});

app.get('/api/admin/library-search', requireAdmin, async (req, res) => {
  try {
    const { q, type } = req.query;
    const results = await libraryScanner.searchLibrary(q, type);
    res.json(results);
  } catch (error) {
    console.error('Error searching library:', error);
    res.status(500).json({ error: 'Failed to search library' });
  }
});

// Image proxy route using axios

// TEST ROUTE
app.get('/api/test-route-12345', (req, res) => {
  console.log('[TEST] Test route was hit!');
  res.json({ message: 'Test route works!' });
});

// Image proxy route using axios (new implementation as specified)
app.get('/api/proxy-image', async (req, res) => {
  console.log('[IMAGE-PROXY] *** ROUTE HIT - UPDATED VERSION ***');
  const { url } = req.query;
  console.log('[IMAGE-PROXY] Requested URL:', url);

  // Transparent 1x1 pixel PNG for error fallback
  const transparentPixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  if (!url) {
    // Return transparent pixel instead of error
    res.set('Content-Type', 'image/png');
    return res.send(transparentPixel);
  }

  // Only allow trusted domains for security
  const allowedDomains = [
    'assets.hardcover.app',
    'via.placeholder.com',
    'covers.openlibrary.org',
    'images-na.ssl-images-amazon.com',
    'images-eu.ssl-images-amazon.com',
    'images-fe.ssl-images-amazon.com',
    'm.media-amazon.com',
    'images.amazon.com',
    'books.google.com',
    'storage.googleapis.com',
    'lh3.googleusercontent.com',
    'covers.googleapis.com'
  ];

  try {
    const imageUrl = new URL(url);
    if (!allowedDomains.includes(imageUrl.hostname)) {
      console.log(`[IMAGE-PROXY] Domain not allowed: ${imageUrl.hostname}`);
      // Return transparent pixel instead of error
      res.set('Content-Type', 'image/png');
      return res.send(transparentPixel);
    }

    console.log(`[IMAGE-PROXY] Fetching image: ${url}`);

    // Determine referer based on domain
    const isAmazon = imageUrl.hostname.includes('amazon.com');
    const referer = isAmazon ? 'https://www.amazon.com/' : 'https://hardcover.app/';

    // Use axios to fetch the image with proper browser-like headers
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream', // Important: stream the response
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      timeout: 10000 // 10 second timeout
    });

    // Set appropriate response headers
    res.set({
      'Content-Type': response.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      'Access-Control-Allow-Origin': '*'
    });

    // Pipe with proper error handling
    response.data.pipe(res);

    // Handle stream errors - prevent 500 errors
    response.data.on('error', (err) => {
      console.error(`[IMAGE-PROXY] Stream error for ${url}:`, err.message);
      if (!res.headersSent) {
        res.end();
      }
    });

    // Handle upstream closing connection
    response.data.on('close', () => {
      console.log(`[IMAGE-PROXY] Stream closed for ${url}`);
    });

    // Handle response finish
    res.on('close', () => {
      if (!res.writableEnded) {
        response.data.destroy();
      }
    });

    console.log(`[IMAGE-PROXY] Successfully proxied image: ${response.status} ${response.headers['content-type']}`);

  } catch (error) {
    // Log detailed error info for debugging
    console.error(`[IMAGE-PROXY] Failed to proxy ${url}:`, {
      error: error.message,
      code: error.code,
      hostname: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return 'unknown';
        }
      })()
    });

    // Return transparent pixel on any error
    res.set('Content-Type', 'image/png');
    res.send(transparentPixel);
  }
});

// Metadata routes
app.get('/api/metadata/:title/:author', async (req, res) => {
  try {
    const { title, author } = req.params;
    const { type = 'book', forceRefresh = false } = req.query;

    const metadata = await metadataAggregator.getMetadata(title, author, type, forceRefresh === 'true');

    if (metadata) {
      res.json(metadata);
    } else {
      res.status(404).json({ error: 'Metadata not found' });
    }
  } catch (error) {
    console.error('Error fetching metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

app.post('/api/admin/clear-caches', requireAdmin, async (req, res) => {
  try {
    await Promise.all([
      metadataAggregator.clearCache(),
      libraryScanner.clearLibrary(),
      discoveryCache.clearCache(),
      coverResolver.clearCache()
    ]);

    res.json({
      success: true,
      message: 'All caches cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing caches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear caches: ' + error.message
    });
  }
});


// Audiobookshelf routes
app.get('/api/abs/users', async (req, res) => {
  try {
    const users = await audiobookshelfService.getUsers();
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('Error fetching ABS users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users from Audiobookshelf',
      error: error.message
    });
  }
});

app.get('/api/abs/test', async (req, res) => {
  try {
    const result = await audiobookshelfService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('ABS connection test error:', error);
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error.message
    });
  }
});

app.get('/api/abs/libraries', async (req, res) => {
  try {
    const libraries = await audiobookshelfService.getLibraries();
    res.json({
      success: true,
      libraries: libraries
    });
  } catch (error) {
    console.error('Error fetching ABS libraries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch libraries from Audiobookshelf',
      error: error.message
    });
  }
});

// --- Global Error Handler ---
// Must be AFTER all routes and BEFORE app.listen
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);

  // Don't send error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    error: message
  });
});

// Catch 404s for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found'
  });
});

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    express.static(path.join(__dirname, '../client/build'))(req, res, next);
  });

  app.get('*', (req, res) => {
    // Skip API routes - they should have been handled by now
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
} else {
  // Development catch-all route to prevent 404 on page refresh
  app.get('*', (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      message: 'This is a development server. Use the React dev server on port 3000 for frontend routes.',
      path: req.path
    });
  });
}

// Start server immediately - no blocking operations
app.listen(PORT, () => {
  console.log(`Onyx server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Prowlarr URL: ${process.env.PROWLARR_URL}`);
  console.log(`qBittorrent URL: ${process.env.QBIT_URL}`);

  // Initialize Google Books discovery cache
  // DISABLED for AI curation - cache generation now handled via admin endpoint only
  /*
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    console.log('[INIT] Google Books API key found, generating discovery cache...');
    discoveryCache.generateDailyCache()
      .then(() => console.log('[INIT] Discovery cache generated successfully'))
      .catch(err => console.error('[INIT] Discovery cache generation failed:', err));
  } else {
    console.warn('[INIT] No Google Books API key - discovery cache disabled');
  }
  */

  // Move initialization to background - non-blocking
  setImmediate(async () => {
    console.log('[INIT] Starting background initialization...');

    try {
      // Test ABS connection in background
      console.log('[INIT] Testing ABS connection...');
      const absTest = await audiobookshelfService.testConnection();
      if (absTest.success) {
        console.log('[INIT] ABS connection successful');

        // Preload ABS users in background
        try {
          const users = await audiobookshelfService.getUsers();
          console.log(`[INIT] Successfully loaded ${users.length} ABS users`);
        } catch (error) {
          console.log(`[INIT] ABS users load failed: ${error.message}`);
        }
      } else {
        console.log(`[INIT] ABS connection failed: ${absTest.message}`);
      }
    } catch (error) {
      console.log(`[INIT] ABS initialization failed: ${error.message}`);
    }

    // Preload library scan in background
    try {
      console.log('[INIT] Starting library scan...');
      const stats = await libraryScanner.getLibraryStats();
      console.log(`[INIT] Library scan complete: ${stats.totalItems || 0} items`);
    } catch (error) {
      console.log(`[INIT] Library scan failed: ${error.message}`);
    }

    // Initialize Telegram service
    try {
      console.log('[INIT] Initializing Telegram service...');
      const connected = await telegramService.connect();
      const status = telegramService.getStatus();
      console.log(`[INIT] Telegram: configured=${status.configured}, authState=${status.authState}`);
    } catch (error) {
      console.log(`[INIT] Telegram initialization failed: ${error.message}`);
    }

    // Validate Hardcover token before genre discovery
    try {
      console.log('[INIT] Validating Hardcover token...');
      const tokenValid = await metadataAggregator.validateHardcoverToken();
      if (!tokenValid) {
        console.log('[INIT] Hardcover token validation failed - genre discovery may fail');
      }
    } catch (error) {
      console.log(`[INIT] Hardcover token validation failed: ${error.message}`);
    }



    // Initialize discovery cache if Google Books API key is available
    // DISABLED for AI curation - cache generation now handled via admin endpoint only
    /*
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      try {
        console.log('[INIT] Starting discovery cache initialization...');
        const cacheStats = discoveryCache.getCacheStats();

        if (!cacheStats.hasCache || discoveryCache.isCacheStale()) {
          console.log('[INIT] Discovery cache is stale or missing, generating...');
          await discoveryCache.generateDailyCache();
          console.log('[INIT] Discovery cache generated successfully');
        } else {
          console.log(`[INIT] Discovery cache is fresh (generated: ${cacheStats.generatedAt})`);
        }
      } catch (error) {
        console.log(`[INIT] Discovery cache initialization failed: ${error.message}`);
      }
    } else {
      console.log('[INIT] GOOGLE_BOOKS_API_KEY not set, skipping discovery cache');
    }
    */

    console.log('[INIT] Background initialization complete');
  });
});