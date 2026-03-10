require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

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
const userStore = require('./services/userStore');
const telegramBotNotifier = require('./services/telegramBotNotifier');
const downloadJobStore = require('./services/downloadJobStore');
const LibraryOwnershipIndex = require('./services/libraryOwnershipIndex');
const { DashboardSnapshotService, DASHBOARD_GENRES } = require('./services/dashboardSnapshot');
const {
  passport,
  configurePassport,
  requireAuth,
  requireApproved,
  requireAdmin,
  buildAuthMeResponse,
  resolvePostAuthRedirect,
  needsOnboarding,
} = require('./auth/passport');

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
const ownershipIndex = new LibraryOwnershipIndex({
  audiobookshelfService,
  libraryScanner
});
const dashboardSnapshotService = new DashboardSnapshotService({
  discoveryCache,
  masterBookCache,
  ownershipIndex
});

const incrementalRefreshGenres = DASHBOARD_GENRES.map((g) => g.key);
let incrementalRefreshIndex = 0;
let incrementalRefreshInFlight = false;
let nightlyAbsMaintenanceInFlight = false;
let nightlyAbsMaintenanceLastRunDate = null;

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

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// --- Session + Google OAuth auth ---
app.set('trust proxy', 1);

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const sessionCookieName = 'onyx.sid';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[AUTH] SESSION_SECRET is required in production');
  }
  console.warn('[AUTH] SESSION_SECRET is not set; using insecure development fallback secret');
}
const effectiveSessionSecret = sessionSecret || 'change-this-onyx-session-secret';

const webhookSecret = process.env.WEBHOOK_SECRET;
if (!webhookSecret && process.env.NODE_ENV === 'production') {
  throw new Error('[WEBHOOK] WEBHOOK_SECRET is required in production');
}

const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: dataDir,
  table: 'sessions',
});

app.use(session({
  store: sessionStore,
  name: sessionCookieName,
  secret: effectiveSessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: process.env.NODE_ENV === 'production',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

const { googleAuthConfigured } = configurePassport();
app.use(passport.initialize());
app.use(passport.session());

function respondGoogleAuthNotConfigured(req, res) {
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) {
    return res.redirect('/login?error=google_oauth_not_configured');
  }
  return res.status(503).json({ error: 'Google OAuth is not configured on server' });
}

function ensureGoogleAuthConfigured(req, res, next) {
  if (!googleAuthConfigured) {
    return respondGoogleAuthNotConfigured(req, res);
  }
  return next();
}

function sendLogoutResponse(req, res) {
  const wantsJson = req.method === 'POST' || String(req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    return res.json({ success: true, authenticated: false });
  }
  return res.redirect('/login');
}

function handleLogout(req, res) {
  const finalize = () => {
    if (req.session) {
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('[AUTH] Session destroy error:', destroyErr);
        }
        res.clearCookie(sessionCookieName, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
        return sendLogoutResponse(req, res);
      });
      return;
    }

    res.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return sendLogoutResponse(req, res);
  };

  if (typeof req.logout === 'function') {
    return req.logout((logoutErr) => {
      if (logoutErr) {
        console.error('[AUTH] Logout error:', logoutErr);
      }
      return finalize();
    });
  }

  return finalize();
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/auth/google', ensureGoogleAuthConfigured, passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
  '/auth/google/callback',
  ensureGoogleAuthConfigured,
  passport.authenticate('google', { failureRedirect: '/login?error=oauth_failed' }),
  (req, res) => {
    res.redirect(resolvePostAuthRedirect(req.user));
  }
);

app.get('/auth/me', (req, res) => {
  const authenticated = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user);
  res.json(buildAuthMeResponse(authenticated ? req.user : null));
});

app.get('/auth/logout', handleLogout);
app.post('/auth/logout', handleLogout);

// API auth protection (public exceptions are handled here)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  if (req.path === '/api/health') {
    return next();
  }

  if (req.path === '/api/webhook/download-complete') {
    return next();
  }

  if (req.path === '/api/internal/download-progress') {
    return next();
  }

  if (req.path === '/api/onboarding') {
    return requireAuth(req, res, next);
  }

  // Allow public access to manifest and service worker for PWA installation
  if (req.path === '/manifest.json' || req.path === '/service-worker.js') {
    return next();
  }

  if (req.path.startsWith('/api/admin/') || req.path.startsWith('/api/telegram/') || req.path.startsWith('/api/abs/')) {
    return requireAdmin(req, res, next);
  }

  return requireApproved(req, res, next);
});

// API Routes
app.get('/api/dashboard', async (req, res) => {
  const { force = 'false' } = req.query;
  try {
    const snapshot = await dashboardSnapshotService.getSnapshot({
      forceRebuild: force === 'true'
    });

    res.json(snapshot);
  } catch (error) {
    console.error('[Dashboard] Failed to load snapshot:', error.message);
    res.status(500).json({
      generatedAt: null,
      genres: [],
      rows: {},
      error: 'Failed to generate dashboard snapshot'
    });
  }
});

app.get('/api/dashboard/genre/:genreKey', async (req, res) => {
  const { genreKey } = req.params;
  const count = Math.min(parseInt(req.query.count || '500', 10) || 500, 1000);

  try {
    const validGenre = (dashboardSnapshotService.snapshot?.genres || [])
      .some((g) => g.key === genreKey);
    if (!validGenre && !['romantasy', 'fantasy', 'dark_fantasy', 'cozy_fantasy', 'fairy_tale_retellings', 'scifi', 'post_apocalyptic', 'enemies_to_lovers', 'action_adventure'].includes(genreKey)) {
      return res.status(404).json({ error: `Unknown genre: ${genreKey}` });
    }

    await ownershipIndex.ensureFresh();
    const { selected } = await dashboardSnapshotService.getGenreBooks(genreKey, { maxItems: count });
    const books = selected.map((book) => {
      const owned = ownershipIndex.getOwnership(book);
      const hasAudiobook = Boolean(owned.audiobook);
      const hasEbook = Boolean(owned.ebook);
      const allOwned = hasAudiobook && hasEbook;
      const anyOwned = hasAudiobook || hasEbook;

      return {
        ...book,
        libraryStatus: allOwned ? 'owned' : (anyOwned ? 'partial' : 'available'),
        formatAvailability: {
          audiobook: hasAudiobook,
          ebook: hasEbook
        },
        ownershipSource: owned.source,
        ownershipMatchedBy: owned.matchedBy
      };
    });

    res.json({
      genre: genreKey,
      count: books.length,
      books
    });
  } catch (error) {
    console.error('[Dashboard] Failed to load genre books:', error.message);
    res.status(500).json({ error: 'Failed to load genre books' });
  }
});

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
        'cozy': 'cozy_fantasy',
        'cozy_fantasy': 'cozy_fantasy',
        'palateCleanser': 'cozy_fantasy',
        'fairy_tale_retellings': 'fairy_tale_retellings',
        'post_apocalyptic': 'post_apocalyptic',
        'enemies_to_lovers': 'enemies_to_lovers',
        'popular': 'popular',
        'hidden_gems': 'hidden_gems',
        'new_releases': 'new_releases',
        'booktok_trending': 'booktok_trending',
        'action_adventure': 'action_adventure',
        'dark_fantasy': 'dark_fantasy',
        'dragons': 'dragons'
      };

      const discoveryGenre = discoveryGenreMap[category];
      console.log(`Discovery genre mapping: ${category} -> ${discoveryGenre}`);
      if (discoveryGenre && process.env.GOOGLE_BOOKS_API_KEY) {
        try {
          const discoveryBooks = await discoveryCache.getRandomizedBooks(discoveryGenre, 20);
          books = discoveryBooks.map((book, idx) => ({
            id: book.googleBooksId || book.isbn13 || `discovery-${(book.title || '').replace(/\s+/g, '-').substring(0, 30)}-${idx}`,
            title: book.title || 'Unknown Title',
            author: Array.isArray(book.authors) ? book.authors.join(', ') : (book.author || 'Unknown Author'),
            coverUrl: (() => {
              const raw = (book.goodreadsCoverUrl ? normalizeGoodreadsCoverUrl(book.goodreadsCoverUrl) : null) || book.thumbnail || book.coverUrl || null;
              if (raw && raw.includes('covers.openlibrary.org')) {
                return `/api/proxy-image?url=${encodeURIComponent(raw)}`;
              }
              return raw;
            })(),
            thumbnail: book.thumbnail || book.coverUrl || null,
            goodreadsCoverUrl: book.goodreadsCoverUrl ? normalizeGoodreadsCoverUrl(book.goodreadsCoverUrl) : null,
            isbn13: book.isbn13 || null,
            isbn: book.isbn || null,
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
        const audiobookOwnership = libraryScanner.checkOwnership(book.title, book.author, 'audiobook');
        const ebookOwnership = libraryScanner.checkOwnership(book.title, book.author, 'ebook');
        const hasAudiobook = Boolean(audiobookOwnership.owned);
        const hasEbook = Boolean(ebookOwnership.owned);
        const anyOwned = hasAudiobook || hasEbook;
        const allOwned = hasAudiobook && hasEbook;

        return {
          ...book,
          libraryStatus: allOwned ? 'owned' : (anyOwned ? 'partial' : 'available'),
          formatAvailability: {
            audiobook: hasAudiobook,
            ebook: hasEbook
          },
          exactMatch: Boolean(audiobookOwnership.exactMatch || ebookOwnership.exactMatch),
          fuzzyMatch: Boolean(audiobookOwnership.fuzzyMatch || ebookOwnership.fuzzyMatch)
        };
      }));
    }

    // Deduplicate at the API response level (does not mutate cache data).
    // Primary key: isbn13. Secondary key: normalised title (lowercase,
    // punctuation stripped, parenthetical/bracket suffixes removed).
    // When two entries collide, the one with a coverUrl is preferred.
    {
      // Aggressive title normalisation for deduplication.
      // Uses 3 words so foreign/alternate editions collapse ("Inferno - ein neuer Fall" → "inferno").
      // HP series books collide at this level but are already distinct in the master cache.
      const normTitle = (t) => {
        let s = (t || '').toLowerCase();
        s = s.replace(/\s+by\s+\S.*$/, '');                          // strip " by Author"
        s = s.replace(/\s*-\s+.+$/, '');                             // strip " - subtitle" (foreign editions etc.)
        s = s.replace(/\s*\([^)]*\)\s*/g, ' ');                      // strip (…)
        s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ');                     // strip […]
        s = s.replace(/\s*:.*$/, '');                                 // strip subtitle after ":"
        s = s.replace(/\s+#\d+\S*/g, ' ');                           // strip "#N" series marker
        s = s.replace(/\s+(?:book|vol\.?|volume)\s+\d+\S*/gi, ' '); // strip "Book N" / "Vol N"
        s = s.replace(/^(?:the|a|an)\s+/, '');                       // strip leading article
        s = s.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        return s.split(/\s+/).slice(0, 3).join(' ');
      };

      const isbnSeen  = new Map(); // isbn → index in deduped[]
      const titleSeen = new Map(); // normTitle → index in deduped[]
      const deduped   = [];

      for (const book of books) {
        const isbn  = book.isbn13 || null;
        const norm  = normTitle(book.title);
        const hasCover = !!(book.coverUrl);

        // Check for a collision
        let collisionIdx =
          (isbn && isbnSeen.has(isbn))   ? isbnSeen.get(isbn)   :
          (norm && titleSeen.has(norm))   ? titleSeen.get(norm)  :
          undefined;

        if (collisionIdx !== undefined) {
          // Replace existing entry only if current book has a cover and existing doesn't
          if (hasCover && !deduped[collisionIdx].coverUrl) {
            deduped[collisionIdx] = book;
          }
          continue;
        }

        // New entry
        const idx = deduped.length;
        deduped.push(book);
        if (isbn) isbnSeen.set(isbn, idx);
        if (norm) titleSeen.set(norm, idx);
      }

      books = deduped.slice(0, 50);
    }

    // Ensure API-level id uniqueness for client rendering/state keys.
    // Upstream sources can occasionally repeat googleBooksId/isbn across distinct
    // entries, which leads to React key collisions in list rendering.
    {
      const idCounts = new Map();
      books = books.map((book, idx) => {
        const baseId = String(book.id || book.googleBooksId || book.isbn13 || `book-${idx}`);
        const seen = idCounts.get(baseId) || 0;
        idCounts.set(baseId, seen + 1);

        if (seen === 0) {
          return { ...book, id: baseId };
        }

        return { ...book, id: `${baseId}-${seen}` };
      });
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
  const providedWebhookSecret =
    String(req.headers['x-onyx-webhook-secret'] || '') ||
    String(req.query.secret || '') ||
    String(req.body?.secret || '');

  if (!webhookSecret || providedWebhookSecret !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid webhook credentials' });
  }

  const { hash, name, path: contentPath, tracker, category } = req.body;
  downloadJobStore.updateByHash(hash, {
    title: name || null,
    tracker: tracker || null,
    status: 'processing',
    stage: 'processing',
    progressPct: 100,
  }, 'Download completed in qBittorrent, starting processing');

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
    // Keep original path characters (including &, commas, brackets, apostrophes, etc.)
    // because qBittorrent content paths commonly contain them.
    // execFile() already prevents command injection; we only reject null bytes.
    const value = String(str || '');
    if (value.includes('\0')) return '';
    return value;
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
      if (error.code === 2) {
        downloadJobStore.updateByHash(hash, {
          status: 'failed',
          stage: 'manual_review_required',
          error: 'Manual review required before import'
        }, 'Manual review required before import');
        return res.json({ success: false, manualReviewRequired: true, output: stdout });
      }
      console.error(`[WEBHOOK] Processing error:`, error.message);
      downloadJobStore.updateByHash(hash, {
        status: 'failed',
        stage: 'failed',
        error: error.message,
      }, `Processing failed: ${error.message}`);
      return res.status(500).json({ error: error.message, output: stdout });
    }
    console.log(`[WEBHOOK] Processing result:`, stdout);
    downloadJobStore.updateByHash(hash, {
      status: 'completed',
      stage: 'completed',
      error: null,
    }, 'Processing completed successfully');
    res.json({ success: true, output: stdout });
  });
});


app.post('/api/request/:id', async (req, res) => {
  const { id } = req.params;
  const { title, author, requestTypes } = req.body;
  const sessionUser = req.user || {};

  const requestedBy = sessionUser.googleId || sessionUser.email || 'unknown-user';
  const userEmail = sessionUser.email || null;
  const username = sessionUser.username || sessionUser.displayName || (sessionUser.email ? sessionUser.email.split('@')[0] : null);

  try {
    const request = await dataStore.addRequest({
      bookId: id,
      title: title || `Book ${id}`,
      author: author || 'Unknown Author',
      type: 'book',
      requestTypes: requestTypes || { audiobook: false, ebook: true },
      requestedBy,
      userEmail,
      username,
      submittedAt: new Date().toISOString()
    });

    console.log(`Book request submitted: ${title} by ${author} for user ${username} (${userEmail})`);

    res.json({
      success: true,
      message: 'Book request submitted successfully',
      requestId: request.id,
      status: 'pending',
      requestTypes: requestTypes,
      user: { id: requestedBy, username, email: userEmail }
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

// Per-genre refresh endpoint - tops up a single genre without touching the rest of the cache
app.post('/api/admin/cache/refresh-genre', requireAdmin, async (req, res) => {
  const { genre } = req.body;

  if (!genre) {
    return res.status(400).json({
      success: false,
      message: 'Request body must include a "genre" field'
    });
  }

  console.log(`[Admin] cache/refresh-genre requested: genre="${genre}"`);

  try {
    const result = await discoveryCache.refreshGenre(genre);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.message.startsWith('Unknown genre key')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error(`[Admin] cache/refresh-genre failed for "${genre}":`, error.message);
    res.status(500).json({
      success: false,
      message: `Failed to refresh genre "${genre}": ${error.message}`
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
    'scifi', 'romantasy', 'cozy_fantasy', 'awards', 'series_starters'
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

app.post('/api/onboarding', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.status !== 'pending') {
      return res.status(403).json({ success: false, message: 'Onboarding is only available for pending users' });
    }

    const displayName = String(req.body.displayName || '').trim();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    const confirmPassword = String(req.body.confirmPassword || '').trim();
    const kindleEmail = String(req.body.kindleEmail || '').trim();

    if (!displayName || !username || !password) {
      return res.status(400).json({ success: false, message: 'Display name, username and password are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    const updatedUser = await userStore.completeOnboarding(req.user.googleId, {
      displayName,
      username,
      password,
      kindleEmail,
    });

    // Refresh req.user for this request response consistency.
    req.user = updatedUser;

    // Best effort notification only.
    telegramBotNotifier.sendPendingUserNotification(updatedUser).catch(err => {
      console.error('[ONBOARDING] Telegram notification failed:', err.message || err);
    });

    res.json({
      success: true,
      message: 'Onboarding submitted. Awaiting admin approval.',
      user: userStore.sanitizeForClient(updatedUser),
      needsOnboarding: false,
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ success: false, message: 'Failed to save onboarding details' });
  }
});

// Admin routes
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await userStore.getAllUsers();
    res.json({
      success: true,
      users: users.map(user => userStore.sanitizeForClient(user)),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users/:googleId/approve', requireAdmin, async (req, res) => {
  const { googleId } = req.params;

  try {
    let approvedUser = await userStore.approveUser(googleId);

    let absProvisioning = { attempted: false, success: false, warning: null };
    const absPassword = userStore.getAbsPassword(approvedUser);
    if (approvedUser.username && absPassword) {
      absProvisioning.attempted = true;
      try {
        await audiobookshelfService.createUser({
          username: approvedUser.username,
          password: absPassword,
          email: approvedUser.email,
          type: 'user',
        });

        approvedUser = await userStore.clearAbsPassword(googleId);
        absProvisioning.success = true;
      } catch (absError) {
        console.error(`[ADMIN USERS] ABS provisioning failed for ${approvedUser.email}:`, absError.message);
        absProvisioning.warning = `Approved in Onyx, but Audiobookshelf user provisioning failed: ${absError.message}`;
      }
    } else {
      absProvisioning.warning = 'Approved in Onyx, but no stored Audiobookshelf credentials were available for provisioning.';
    }

    res.json({
      success: true,
      user: userStore.sanitizeForClient(approvedUser),
      absProvisioning,
    });
  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({ success: false, message: 'Failed to approve user' });
  }
});

app.post('/api/admin/users/:googleId/reject', requireAdmin, async (req, res) => {
  const { googleId } = req.params;

  try {
    const user = await userStore.rejectUser(googleId);
    res.json({
      success: true,
      user: userStore.sanitizeForClient(user),
    });
  } catch (error) {
    console.error('Error rejecting user:', error);
    res.status(500).json({ success: false, message: 'Failed to reject user' });
  }
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
  const { magnetUrl, title, tracker, source, downloadInfo, selectedFormat, categoryName } = req.body;

  const inferFormatFromResult = (resultTitle = '', categoryName = '', fallback = null) => {
    const text = `${resultTitle} ${categoryName}`.toLowerCase();
    if (/\b(audiobook|audio\s*book|audible|m4b|mp3|aac)\b/.test(text)) return 'audiobook';
    if (/\b(e-?book|ebook|epub|pdf|mobi|azw|azw3|fb2|djvu)\b/.test(text)) return 'ebook';
    const normalizedFallback = String(fallback || '').toLowerCase();
    if (normalizedFallback === 'audiobook' || normalizedFallback === 'ebook') return normalizedFallback;
    return null;
  };

  try {
    const request = await dataStore.getRequestById(requestId);
    const requestTitle = title || request?.title || 'Unknown Title';
    const requestAuthor = request?.author || 'Unknown Author';

    downloadJobStore.upsertJob(requestId, {
      title: requestTitle,
      author: requestAuthor,
      source: source || 'prowlarr',
      status: 'queued',
      stage: 'queued',
      progressPct: 0,
      error: null,
    }, 'Download queued');

    let downloadResult;

    // Unified download: dispatch based on source
    if (source === 'telegram') {
      // Telegram direct download
      console.log(`[Download] Using Telegram for: ${title}`);
      downloadJobStore.upsertJob(requestId, {
        status: 'processing',
        stage: 'telegram_download',
      }, 'Starting Telegram direct download');
      const telegramResult = await telegramService.download(downloadInfo || { title });

      if (telegramResult.success && telegramResult.filePath) {
        // Process the downloaded file
        const logicalName = [requestTitle, requestAuthor].filter(Boolean).join(' - ');
        const processResult = await directDownloadService.processDownload(
          telegramResult.filePath,
          telegramResult.fileName,
          'telegram',
          { logicalName }
        );
        downloadResult = {
          success: processResult.success,
          message: processResult.message,
        };
        if (processResult.success) {
          downloadJobStore.upsertJob(requestId, {
            status: 'completed',
            stage: 'completed',
            progressPct: 100,
          }, 'Telegram download processed successfully');
        } else {
          downloadJobStore.upsertJob(requestId, {
            status: 'failed',
            stage: 'failed',
            error: processResult.message || 'Telegram processing failed',
          }, processResult.message || 'Telegram processing failed');
        }
      } else {
        downloadResult = telegramResult;
        downloadJobStore.upsertJob(requestId, {
          status: 'failed',
          stage: 'failed',
          error: telegramResult.message || 'Telegram download failed',
        }, telegramResult.message || 'Telegram download failed');
      }
    } else {
      // Default: qBittorrent torrent download
      console.log(`[Download] Using qBittorrent for: ${title}`);
      downloadResult = await qbittorrentService.addTorrent(magnetUrl);
      if (downloadResult.success) {
        let resolvedHash = downloadResult.hash || null;
        if (!resolvedHash) {
          resolvedHash = await qbittorrentService.resolveTorrentHashByName(requestTitle);
        }

        downloadJobStore.upsertJob(requestId, {
          status: 'downloading',
          stage: 'downloading',
          torrentHash: resolvedHash,
          progressPct: 0,
        }, resolvedHash ? `Torrent added (hash ${resolvedHash.slice(0, 8)}...)` : 'Torrent added to qBittorrent');
      } else {
        downloadJobStore.upsertJob(requestId, {
          status: 'failed',
          stage: 'failed',
          error: downloadResult.message || 'Failed to add torrent',
        }, downloadResult.message || 'Failed to add torrent');
      }
    }

    if (downloadResult.success) {
      const fulfilledFormat = inferFormatFromResult(
        title,
        downloadInfo?.format || categoryName || tracker || source,
        selectedFormat
      );
      const fulfillment = await dataStore.markFormatFulfilled(requestId, fulfilledFormat, {
        magnetUrl: magnetUrl || null,
        title,
        tracker: tracker || source,
        source: source || 'prowlarr',
        downloadedAt: new Date().toISOString(),
      });

      const remaining = [];
      if (fulfillment.remainingFormats.audiobook) remaining.push('audiobook');
      if (fulfillment.remainingFormats.ebook) remaining.push('ebook');

      res.json({
        success: true,
        message: fulfillment.completed
          ? (downloadResult.message || 'Download started successfully')
          : `Download started successfully. Remaining requested format(s): ${remaining.join(', ')}`,
        requestStatus: fulfillment.request.status,
        remainingFormats: fulfillment.remainingFormats
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

app.post('/api/admin/import-log/:id/review', requireAdmin, async (req, res) => {
  try {
    const entry = importLog.getImportById(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Import not found' });
    }

    const author = String(req.body?.author || '').trim();
    const title = String(req.body?.title || '').trim();
    const seriesRaw = String(req.body?.series || '').trim();
    const series = seriesRaw || null;

    if (!author || !title) {
      return res.status(400).json({ success: false, message: 'Author and title are required' });
    }

    if (!entry.sourcePath || !fs.existsSync(entry.sourcePath)) {
      return res.status(400).json({ success: false, message: 'Source path no longer exists' });
    }

    importLog.updateImport(req.params.id, {
      status: 'review_processing',
      review: {
        author,
        title,
        series,
        submittedAt: new Date().toISOString(),
        submittedBy: req.user?.email || req.user?.username || 'admin'
      }
    });

    execFile(
      'node',
      ['/app/scripts/process-download.js', entry.torrentHash || 'manual-review', entry.torrentName || title, entry.sourcePath, entry.tracker || 'manual-review', entry.category || 'audiobook'],
      {
        timeout: 10 * 60 * 1000,
        env: {
          ...process.env,
          IMPORT_OVERRIDE_JSON: JSON.stringify({
            forceImport: true,
            author,
            title,
            series
          })
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          importLog.updateImport(req.params.id, {
            status: 'manual_review_required',
            review: {
              ...(entry.review || {}),
              author,
              title,
              series,
              lastError: error.message,
              stdout: stdout || null,
              stderr: stderr || null,
              failedAt: new Date().toISOString()
            }
          });
          return;
        }

        importLog.updateImport(req.params.id, {
          status: 'review_completed',
          review: {
            ...(entry.review || {}),
            author,
            title,
            series,
            completedAt: new Date().toISOString()
          }
        });
      }
    );

    return res.json({ success: true, message: 'Manual review import started' });
  } catch (error) {
    console.error('Error processing import review:', error);
    res.status(500).json({ success: false, message: 'Failed to process manual review' });
  }
});

app.get('/api/admin/jobs', requireAdmin, (req, res) => {
  const { limit = 100 } = req.query;
  const parsedLimit = Number.parseInt(limit, 10);
  res.json({
    success: true,
    jobs: downloadJobStore.getRecentJobs(Number.isFinite(parsedLimit) ? parsedLimit : 100),
  });
});

app.get('/api/admin/jobs/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: 'snapshot', jobs: downloadJobStore.getRecentJobs(100) });

  const onUpdate = (update) => send(update);
  downloadJobStore.emitter.on('update', onUpdate);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    downloadJobStore.emitter.off('update', onUpdate);
    res.end();
  });
});

app.post('/api/internal/download-progress', (req, res) => {
  const providedWebhookSecret = String(req.headers['x-onyx-webhook-secret'] || '');
  if (!webhookSecret || providedWebhookSecret !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid internal credentials' });
  }

  const {
    hash,
    title,
    status,
    stage,
    message,
    progressPct,
    filesProcessed,
    filesSkipped,
    scanTriggered,
    scanConfirmed,
    error,
  } = req.body || {};

  if (!hash) {
    return res.status(400).json({ error: 'hash is required' });
  }

  const patch = {};
  if (title !== undefined) patch.title = title;
  if (status !== undefined) patch.status = status;
  if (stage !== undefined) patch.stage = stage;
  if (progressPct !== undefined) patch.progressPct = progressPct;
  if (filesProcessed !== undefined) patch.filesProcessed = filesProcessed;
  if (filesSkipped !== undefined) patch.filesSkipped = filesSkipped;
  if (scanTriggered !== undefined) patch.scanTriggered = !!scanTriggered;
  if (scanConfirmed !== undefined) patch.scanConfirmed = !!scanConfirmed;
  if (error !== undefined) patch.error = error;

  const job = downloadJobStore.updateByHash(hash, patch, message || null);
  return res.json({ success: true, matched: Boolean(job) });
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

app.get('/api/admin/library-ownership/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await ownershipIndex.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching ownership index stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/library-ownership/refresh', requireAdmin, async (req, res) => {
  try {
    const index = await ownershipIndex.refresh(true);
    res.json({
      success: true,
      generatedAt: index.generatedAt,
      source: index.source,
      stats: index.stats
    });
  } catch (error) {
    console.error('Error refreshing ownership index:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/dashboard/refresh', requireAdmin, async (req, res) => {
  try {
    const snapshot = await dashboardSnapshotService.getSnapshot({ forceRebuild: true });
    res.json({
      success: true,
      generatedAt: snapshot.generatedAt,
      booksPerGenre: snapshot.booksPerGenre,
      rows: Object.fromEntries(
        Object.entries(snapshot.rows || {}).map(([key, books]) => [key, books.length])
      )
    });
  } catch (error) {
    console.error('Error refreshing dashboard snapshot:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Upscale Goodreads thumbnail URLs by replacing small size hints (_SY75_, _SX50_, etc.)
// with a medium-large width (_SX318_) that loads reliably through the image proxy.
function normalizeGoodreadsCoverUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\._S[XY]\d+_\./g, '._SX318_.');
}

// Image proxy route using axios (new implementation as specified)
app.get('/api/proxy-image', async (req, res) => {
  console.log('[IMAGE-PROXY] *** ROUTE HIT - UPDATED VERSION ***');
  const { url } = req.query;
  console.log('[IMAGE-PROXY] Requested URL:', url);

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
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
    'covers.googleapis.com',
    'i.gr-assets.com',
    'images.gr-assets.com'
  ];

  try {
    const imageUrl = new URL(url);
    if (!allowedDomains.includes(imageUrl.hostname)) {
      console.log(`[IMAGE-PROXY] Domain not allowed: ${imageUrl.hostname}`);
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log(`[IMAGE-PROXY] Fetching image: ${url}`);

    const isAmazon = imageUrl.hostname.includes('amazon.com');
    const isGoodreads = imageUrl.hostname.includes('gr-assets.com');
    let referer = 'https://hardcover.app/';
    if (isAmazon) referer = 'https://www.amazon.com/';
    if (isGoodreads) referer = 'https://www.goodreads.com/';

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': referer,
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
    if (isGoodreads) fetchHeaders['Origin'] = 'https://www.goodreads.com';

    // Use axios to fetch the image with proper browser-like headers
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: fetchHeaders,
      timeout: 10000
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

    if (!res.headersSent) {
      res.status(404).json({ error: 'Image fetch failed' });
    } else {
      res.end();
    }
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

// --- Share Target Endpoints ---
// Helper function to fetch and extract metadata from a URL
async function extractBookMetadataFromUrl(targetUrl, sharedTitle = '', sharedText = '') {
  const result = {
    title: '',
    author: '',
    coverUrl: '',
    synopsis: '',
    isbn: '',
    sourceUrl: targetUrl,
    confidence: 'low'
  };

  try {
    // Determine source type early for pre-fetch strategies
    const urlLower = targetUrl.toLowerCase();
    const isAmazon = urlLower.includes('amazon.') || urlLower.includes('amzn.');

    // Amazon blocks scraping, so extract info from shared text + ASIN lookup instead
    if (isAmazon) {
      console.log('[Share] Amazon URL detected, using shared text + ASIN lookup strategy');
      console.log('[Share] Shared title:', sharedTitle);
      console.log('[Share] Shared text:', sharedText);

      // Extract ASIN from Amazon URL (often ISBN-10 for books)
      const asinMatch = targetUrl.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})/i);
      const asin = asinMatch ? asinMatch[1] : null;
      if (asin) {
        console.log('[Share] Extracted ASIN:', asin);
        result.isbn = asin;
      }

      // Parse shared text — Amazon app typically shares:
      //   "Book Title: Author Name https://..." or
      //   "Book Title by Author Name https://..." or
      //   just "Book Title https://..."
      const textToParse = sharedText || sharedTitle || '';
      // Remove URL from text first
      const cleanText = textToParse.replace(/https?:\/\/\S+/g, '').trim();

      if (cleanText) {
        // Try "Title: Author" pattern (Amazon app format)
        const colonMatch = cleanText.match(/^(.+?):\s*(.+?)$/);
        // Try "Title by Author" pattern
        const byMatch = cleanText.match(/^(.+?)\s+by\s+(.+?)$/i);

        if (colonMatch) {
          result.title = colonMatch[1].trim();
          result.author = colonMatch[2].trim();
        } else if (byMatch) {
          result.title = byMatch[1].trim();
          result.author = byMatch[2].trim();
        } else {
          // Just use the whole text as title
          result.title = cleanText;
        }
      }

      // Helper: check if a Google Books result roughly matches our parsed title
      const titleMatches = (gbTitle, parsedTitle) => {
        if (!gbTitle || !parsedTitle) return false;
        const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const gt = norm(gbTitle);
        const pt = norm(parsedTitle);
        return gt.includes(pt) || pt.includes(gt);
      };

      // Try Google Books lookup to enrich with cover/synopsis/ISBN-13
      // Strategy: search by title+author first (most reliable), fall back to ASIN
      const parsedTitle = result.title;
      const parsedAuthor = result.author;

      let gbMatch = null;

      // Search by title+author if we have them (more reliable than ASIN)
      if (parsedTitle) {
        try {
          const query = parsedAuthor ? `${parsedTitle} ${parsedAuthor}` : parsedTitle;
          const gbResults = await googleBooksApi.searchBooks(query, 3);
          if (gbResults && gbResults.length > 0) {
            // Find the best match — prefer one whose title matches what we parsed
            gbMatch = gbResults.find(gb => titleMatches(gb.title, parsedTitle)) || null;
            console.log('[Share] Google Books title search:', gbMatch ? `matched "${gbMatch.title}"` : 'no good match');
          }
        } catch (e) {
          console.log('[Share] Google Books title search failed:', e.message);
        }
      }

      // If title search didn't match well, try ASIN as ISBN
      if (!gbMatch && asin) {
        try {
          const gbResults = await googleBooksApi.searchBooks(`isbn:${asin}`, 1);
          if (gbResults && gbResults.length > 0) {
            const gb = gbResults[0];
            // Only use if title roughly matches (ASIN might map to wrong edition/book)
            if (!parsedTitle || titleMatches(gb.title, parsedTitle)) {
              gbMatch = gb;
              console.log('[Share] Google Books ASIN match:', gb.title);
            } else {
              console.log('[Share] Google Books ASIN match rejected (title mismatch):', gb.title, 'vs parsed:', parsedTitle);
            }
          }
        } catch (e) {
          console.log('[Share] Google Books ASIN lookup failed:', e.message);
        }
      }

      // Enrich result from Google Books — but never overwrite parsed title/author
      if (gbMatch) {
        result.coverUrl = gbMatch.coverUrl || gbMatch.thumbnail || result.coverUrl;
        result.synopsis = gbMatch.description || gbMatch.synopsis || result.synopsis;
        result.isbn = gbMatch.isbn13 || gbMatch.isbn || result.isbn;
        // Only fill in title/author if we didn't parse them from shared text
        if (!result.title) result.title = gbMatch.title || '';
        if (!result.author) result.author = gbMatch.author || (gbMatch.authors && gbMatch.authors.join(', ')) || '';
        result.confidence = result.title && result.author ? 'high' : 'medium';
      }

      // If we got at least a title from parsing, that's enough
      if (result.title) {
        if (!result.confidence || result.confidence === 'low') {
          result.confidence = result.author ? 'medium' : 'low';
        }
        return result;
      }

      // Fall through to scraping as last resort
      console.log('[Share] Amazon: no title from shared text or ASIN, falling through to scrape attempt');
    }

    // Fetch the page with browser-like headers
    const response = await axios.get(targetUrl, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }
    });

    const html = response.data;
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Determine source type for site-specific extraction
    const isGoodreads = urlLower.includes('goodreads.com');
    const isGoogleBooks = urlLower.includes('books.google.') || urlLower.includes('google.com/books');

    // Try Schema.org JSON-LD first (most reliable)
    const jsonLdScripts = $('script[type="application/ld+json"]');
    let schemaData = null;

    jsonLdScripts.each((i, elem) => {
      try {
        const data = JSON.parse($(elem).html() || '{}');
        // Handle @graph arrays
        const graph = data['@graph'] || [data];
        for (const item of graph) {
          if (item['@type'] === 'Book' || item['@type'] === 'Product' ||
              (Array.isArray(item['@type']) && item['@type'].some(t => t === 'Book' || t === 'Product'))) {
            schemaData = item;
            break;
          }
        }
      } catch (e) {
        // Ignore malformed JSON-LD
      }
    });

    if (schemaData) {
      // Extract from Schema.org
      result.title = schemaData.name || schemaData.headline || '';
      result.synopsis = schemaData.description || '';

      // Author extraction
      if (schemaData.author) {
        if (typeof schemaData.author === 'string') {
          result.author = schemaData.author;
        } else if (schemaData.author.name) {
          result.author = schemaData.author.name;
        } else if (Array.isArray(schemaData.author)) {
          result.author = schemaData.author.map(a => typeof a === 'string' ? a : a.name).filter(Boolean).join(', ');
        }
      }

      // ISBN extraction
      if (schemaData.isbn) {
        result.isbn = String(schemaData.isbn).replace(/[^0-9X]/gi, '');
      } else if (schemaData.identifier) {
        const isbnId = schemaData.identifier.find(id => id.propertyID === 'ISBN' || id.name === 'ISBN');
        if (isbnId) {
          result.isbn = String(isbnId.value).replace(/[^0-9X]/gi, '');
        }
      }

      // Image extraction
      if (schemaData.image) {
        if (typeof schemaData.image === 'string') {
          result.coverUrl = schemaData.image;
        } else if (schemaData.image.url) {
          result.coverUrl = schemaData.image.url;
        } else if (schemaData.image.contentUrl) {
          result.coverUrl = schemaData.image.contentUrl;
        }
      }

      result.confidence = 'high';
    }

    // If no Schema.org data or missing fields, try Open Graph
    if (!result.title) {
      result.title = $('meta[property="og:title"]').attr('content') || '';
    }
    if (!result.synopsis) {
      result.synopsis = $('meta[property="og:description"]').attr('content') || '';
    }
    if (!result.coverUrl) {
      result.coverUrl = $('meta[property="og:image"]').attr('content') || '';
    }

    // Site-specific extractors
    if (isGoodreads) {
      // Goodreads specific extraction
      if (!result.title) {
        result.title = $('h1[data-testid="bookTitle"]').text().trim() ||
                      $('h1#bookTitle').text().trim() ||
                      $('h1.bookTitle').text().trim() ||
                      $('h1').first().text().trim();
      }

      if (!result.author) {
        result.author = $('a[href*="/author/show/"]').first().text().trim() ||
                       $('.authorName').first().text().trim() ||
                       $('span[itemprop="author"]').text().trim();
      }

      if (!result.synopsis) {
        result.synopsis = $('#description span:last-child').text().trim() ||
                         $('[data-testid="description"]').text().trim() ||
                         $('div[itemprop="description"]').text().trim();
      }

      if (!result.coverUrl) {
        result.coverUrl = $('img[data-testid="coverImage"]').attr('src') ||
                         $('#coverImage').attr('src') ||
                         $('img[itemprop="image"]').attr('src');
      }

      // Extract ISBN from page
      if (!result.isbn) {
        const isbnText = $('div[itemprop="isbn"]').text().trim() ||
                        $('dt:contains("ISBN")').next('dd').text().trim() ||
                        $('.infoBoxRowItem:contains("ISBN")').text().trim();
        if (isbnText) {
          const isbnMatch = isbnText.match(/[\d-]{10,17}/);
          if (isbnMatch) {
            result.isbn = isbnMatch[0].replace(/-/g, '');
          }
        }
      }

      // Goodreads has reliable data
      if (result.title && result.author) {
        result.confidence = 'high';
      }
    }

    if (isAmazon) {
      // Amazon specific extraction
      if (!result.title) {
        result.title = $('#productTitle').text().trim() ||
                      $('h1.a-size-large span').text().trim() ||
                      $('h1[data-automation-id="title"]').text().trim();
      }

      if (!result.author) {
        result.author = $('.author a').first().text().trim() ||
                       $('#bylineInfo .author a').first().text().trim() ||
                       $('a[href*="field-author"]').first().text().trim();
      }

      if (!result.synopsis) {
        result.synopsis = $('#bookDescription_feature_div').text().trim() ||
                         $('#productDescription').text().trim() ||
                         $('.a-expander-content').first().text().trim();
      }

      if (!result.coverUrl) {
        result.coverUrl = $('#imgBlkFront').attr('src') ||
                         $('#landingImage').attr('src') ||
                         $('img[data-a-dynamic-image]').first().attr('src');
      }

      // Amazon ISBN extraction
      if (!result.isbn) {
        const detailsText = $('#detailBullets_feature_div').text() ||
                           $('#productDetailsTable').text() ||
                           $('.a-section:contains("ISBN")').text();
        const isbnMatch = detailsText.match(/ISBN-?1?3?:?\s*([\d-]{10,17})/i);
        if (isbnMatch) {
          result.isbn = isbnMatch[1].replace(/-/g, '');
        }
      }

      if (result.title) {
        result.confidence = result.author ? 'high' : 'medium';
      }
    }

    if (isGoogleBooks) {
      // Google Books specific extraction
      if (!result.title) {
        result.title = $('h1').first().text().trim() ||
                      $('.book-title').text().trim();
      }

      if (!result.author) {
        result.author = $('.book-author').text().trim() ||
                       $('a[href*="q=author:"]').first().text().trim();
      }

      if (!result.synopsis) {
        result.synopsis = $('#synopsis').text().trim() ||
                         $('.book-description').text().trim();
      }

      // Extract ISBN from Google Books URL
      if (!result.isbn) {
        const vidMatch = targetUrl.match(/[?&]vid=([^&]+)/);
        if (vidMatch) {
          result.isbn = vidMatch[1];
        }
      }

      if (result.title) {
        result.confidence = 'medium';
      }
    }

    // Fallback to standard meta tags if still missing
    if (!result.title) {
      result.title = $('title').text().trim() || sharedTitle;
      // Clean up title (remove site name suffixes)
      result.title = result.title.replace(/\s*[\|\-–—]\s*(Goodreads|Amazon|Google Books).*$/i, '');
    }

    if (!result.synopsis) {
      result.synopsis = $('meta[name="description"]').attr('content') || sharedText;
    }

    // Clean up extracted data
    result.title = result.title.trim();
    result.author = result.author.trim();
    result.synopsis = result.synopsis.trim();

    // Remove "by Author Name" from title if present
    if (result.title && result.author) {
      result.title = result.title.replace(new RegExp(`\\s*by\\s+${result.author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '');
    }

    // Limit synopsis length
    if (result.synopsis.length > 2000) {
      result.synopsis = result.synopsis.substring(0, 2000) + '...';
    }

    return result;

  } catch (error) {
    console.error('Error extracting metadata from URL:', error.message);

    // Return basic info from shared data if extraction fails
    return {
      title: sharedTitle || '',
      author: '',
      coverUrl: '',
      synopsis: sharedText || '',
      isbn: '',
      sourceUrl: targetUrl,
      confidence: 'low'
    };
  }
}

// POST /api/share/resolve - Extract book metadata from shared URL
app.post('/api/share/resolve', async (req, res) => {
  try {
    const { url, title, text } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    console.log(`[SHARE] Resolving metadata for: ${url}`);

    const metadata = await extractBookMetadataFromUrl(url, title || '', text || '');

    console.log(`[SHARE] Extracted metadata - Title: "${metadata.title}", Author: "${metadata.author}", Confidence: ${metadata.confidence}`);

    res.json(metadata);

  } catch (error) {
    console.error('[SHARE] Error resolving share:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve book metadata',
      error: error.message
    });
  }
});

// POST /api/share/request - Submit a book request from share
app.post('/api/share/request', async (req, res) => {
  try {
    const {
      title,
      author,
      synopsis,
      isbn,
      coverUrl,
      sourceUrl,
      requestTypes = { audiobook: false, ebook: true }
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Book title is required'
      });
    }

    const sessionUser = req.user || {};
    const requestedBy = sessionUser.googleId || sessionUser.email || 'anonymous-share';
    const userEmail = sessionUser.email || null;
    const username = sessionUser.username || sessionUser.displayName || (sessionUser.email ? sessionUser.email.split('@')[0] : 'Anonymous User');

    // Generate a unique ID for this shared book request
    const bookId = `share-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const request = await dataStore.addRequest({
      bookId: bookId,
      title: title.trim(),
      author: author || 'Unknown Author',
      type: 'book',
      requestTypes: requestTypes,
      requestedBy,
      userEmail,
      username,
      submittedAt: new Date().toISOString(),
      sourceUrl: sourceUrl || null,
      synopsis: synopsis || null,
      isbn: isbn || null,
      coverUrl: coverUrl || null,
      source: 'share_target'
    });

    console.log(`[SHARE] Book request submitted: "${title}" by "${author}" from ${sourceUrl || 'unknown source'} by user ${username} (${userEmail || 'anonymous'})`);

    // Send Telegram notification if configured
    if (telegramBotNotifier && telegramBotNotifier.sendNotification) {
      try {
        const formatText = [];
        if (requestTypes.audiobook) formatText.push('Audiobook');
        if (requestTypes.ebook) formatText.push('Ebook');

        await telegramBotNotifier.sendNotification({
          type: 'book_request',
          title: title.trim(),
          author: author || 'Unknown Author',
          formats: formatText.join(' + ') || 'Ebook',
          requestedBy: username || userEmail || 'Anonymous User',
          source: sourceUrl ? new URL(sourceUrl).hostname : 'Shared via PWA'
        });
      } catch (notifyError) {
        console.error('[SHARE] Failed to send Telegram notification:', notifyError.message);
      }
    }

    res.json({
      success: true,
      message: 'Book request submitted successfully',
      requestId: request.id,
      status: 'pending',
      requestTypes: requestTypes,
      user: { id: requestedBy, username, email: userEmail }
    });

  } catch (error) {
    console.error('[SHARE] Error submitting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit request'
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
  const clientBuildDir = path.join(__dirname, '../client/build');
  const serveStatic = express.static(clientBuildDir, { index: false });

  // Serve manifest and service worker without auth (required for PWA)
  app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(clientBuildDir, 'manifest.json'));
  });

  app.get('/service-worker.js', (req, res) => {
    res.sendFile(path.join(clientBuildDir, 'service-worker.js'));
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      return next();
    }
    if (req.path === '/' || req.path.endsWith('.html')) {
      return next();
    }
    // Skip manifest and service worker (already handled above)
    if (req.path === '/manifest.json' || req.path === '/service-worker.js') {
      return next();
    }
    return serveStatic(req, res, next);
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }

    if (req.path === '/health') {
      return res.status(200).json({ status: 'ok' });
    }

    if (req.path.startsWith('/auth/')) {
      return next();
    }

    // Share page should always be served directly (preserves query params from PWA share target)
    if (req.path === '/share') {
      return res.sendFile(path.join(clientBuildDir, 'index.html'));
    }

    if (req.path === '/login') {
      const isAuthed = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user);
      if (!isAuthed) {
        return res.sendFile(path.join(clientBuildDir, 'index.html'));
      }
      return res.redirect(resolvePostAuthRedirect(req.user));
    }

    const isAuthed = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user);
    if (!isAuthed) {
      return res.redirect('/login');
    }

    if (req.user.status === 'rejected') {
      if (req.path !== '/awaiting-approval') {
        return res.redirect('/awaiting-approval?status=rejected');
      }
      return res.sendFile(path.join(clientBuildDir, 'index.html'));
    }

    if (req.user.status === 'pending' && needsOnboarding(req.user)) {
      if (req.path !== '/onboarding') {
        return res.redirect('/onboarding');
      }
      return res.sendFile(path.join(clientBuildDir, 'index.html'));
    }

    if (req.user.status !== 'approved') {
      if (req.path !== '/awaiting-approval') {
        return res.redirect('/awaiting-approval');
      }
      return res.sendFile(path.join(clientBuildDir, 'index.html'));
    }

    if ((req.path === '/onboarding' || req.path === '/awaiting-approval' || req.path === '/login')) {
      return res.redirect('/');
    }

    if (req.path.startsWith('/admin') && req.user.role !== 'admin') {
      return res.redirect('/');
    }

    return res.sendFile(path.join(clientBuildDir, 'index.html'));
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

async function runIncrementalCacheTick() {
  if (incrementalRefreshInFlight) {
    console.log('[SCHEDULER] Incremental refresh skipped: previous run still in progress');
    return;
  }

  incrementalRefreshInFlight = true;
  const genre = incrementalRefreshGenres[incrementalRefreshIndex % incrementalRefreshGenres.length];
  incrementalRefreshIndex += 1;

  try {
    console.log(`[SCHEDULER] Incremental refresh starting for genre: ${genre}`);
    const result = await discoveryCache.refreshGenre(genre);
    console.log(
      `[SCHEDULER] Incremental refresh completed for ${genre}: +${result.booksAdded}, total=${result.totalInGenre}`
    );

    await ownershipIndex.refresh(true);
    await dashboardSnapshotService.getSnapshot({ forceRebuild: true });
    console.log('[SCHEDULER] Ownership index and dashboard snapshot refreshed');
  } catch (error) {
    console.error(`[SCHEDULER] Incremental refresh failed for ${genre}:`, error.message);
  } finally {
    incrementalRefreshInFlight = false;
  }
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function maybeRunNightlyAbsMaintenance() {
  const enabled = String(process.env.NIGHTLY_ABS_MAINTENANCE_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled || nightlyAbsMaintenanceInFlight) return;

  const targetHour = Math.max(0, Math.min(23, parseInt(process.env.NIGHTLY_ABS_MAINTENANCE_HOUR || '3', 10) || 3));
  const targetMinute = Math.max(0, Math.min(59, parseInt(process.env.NIGHTLY_ABS_MAINTENANCE_MINUTE || '30', 10) || 30));
  const now = new Date();
  const dateKey = getLocalDateKey(now);
  const pastWindow = now.getHours() > targetHour || (now.getHours() === targetHour && now.getMinutes() >= targetMinute);

  if (!pastWindow) return;
  if (nightlyAbsMaintenanceLastRunDate === dateKey) return;

  nightlyAbsMaintenanceInFlight = true;
  console.log(`[SCHEDULER] Nightly ABS maintenance starting for ${dateKey} at ${now.toISOString()}`);

  execFile('node', ['/app/scripts/abs-maintenance.js'], { timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => {
    if (stdout) {
      console.log(stdout.trim());
    }
    if (stderr) {
      console.error(stderr.trim());
    }
    if (error) {
      console.error('[SCHEDULER] Nightly ABS maintenance failed:', error.message);
    } else {
      nightlyAbsMaintenanceLastRunDate = dateKey;
      console.log('[SCHEDULER] Nightly ABS maintenance completed');
    }
    nightlyAbsMaintenanceInFlight = false;
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
      await libraryScanner.scanLibrary(true);
      const stats = await libraryScanner.getLibraryStats();
      console.log(`[INIT] Library scan complete: ${stats.total || 0} items`);
    } catch (error) {
      console.log(`[INIT] Library scan failed: ${error.message}`);
    }

    try {
      console.log('[INIT] Building ownership index...');
      const ownership = await ownershipIndex.refresh(true);
      console.log(`[INIT] Ownership index ready: ${ownership.stats?.totalRecords || 0} records (${ownership.source})`);
    } catch (error) {
      console.log(`[INIT] Ownership index build failed: ${error.message}`);
    }

    try {
      console.log('[INIT] Building dashboard snapshot...');
      const snapshot = await dashboardSnapshotService.getSnapshot({ forceRebuild: true });
      const rowCount = Object.keys(snapshot.rows || {}).length;
      console.log(`[INIT] Dashboard snapshot ready: ${rowCount} genre rows`);
    } catch (error) {
      console.log(`[INIT] Dashboard snapshot build failed: ${error.message}`);
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

  // Poll qBittorrent periodically to surface live progress in admin UI.
  setInterval(async () => {
    try {
      const torrents = await qbittorrentService.getTorrents();
      downloadJobStore.updateFromQbitTorrents(torrents);
    } catch (error) {
      // Best-effort only; do not spam logs.
    }
  }, 5000);

  // Incremental cache growth scheduler (one genre per tick, rotating).
  const schedulerEnabled = String(process.env.INCREMENTAL_REFRESH_ENABLED || 'true').toLowerCase() !== 'false';
  const schedulerEveryMinutes = Math.max(60, parseInt(process.env.INCREMENTAL_REFRESH_EVERY_MINUTES || '360', 10) || 360);
  const schedulerInitialDelayMinutes = Math.max(5, parseInt(process.env.INCREMENTAL_REFRESH_INITIAL_DELAY_MINUTES || '30', 10) || 30);

  if (schedulerEnabled) {
    console.log(
      `[SCHEDULER] Incremental refresh enabled: every ${schedulerEveryMinutes}m, initial delay ${schedulerInitialDelayMinutes}m`
    );

    setTimeout(() => {
      runIncrementalCacheTick().catch((error) => {
        console.error('[SCHEDULER] Initial incremental refresh failed:', error.message);
      });
    }, schedulerInitialDelayMinutes * 60 * 1000);

    setInterval(() => {
      runIncrementalCacheTick().catch((error) => {
        console.error('[SCHEDULER] Incremental refresh tick failed:', error.message);
      });
    }, schedulerEveryMinutes * 60 * 1000);
  } else {
    console.log('[SCHEDULER] Incremental refresh disabled via INCREMENTAL_REFRESH_ENABLED');
  }

  const nightlyEnabled = String(process.env.NIGHTLY_ABS_MAINTENANCE_ENABLED || 'true').toLowerCase() !== 'false';
  const nightlyHour = Math.max(0, Math.min(23, parseInt(process.env.NIGHTLY_ABS_MAINTENANCE_HOUR || '3', 10) || 3));
  const nightlyMinute = Math.max(0, Math.min(59, parseInt(process.env.NIGHTLY_ABS_MAINTENANCE_MINUTE || '30', 10) || 30));
  if (nightlyEnabled) {
    console.log(`[SCHEDULER] Nightly ABS maintenance enabled at ${String(nightlyHour).padStart(2, '0')}:${String(nightlyMinute).padStart(2, '0')} (server local time)`);
    maybeRunNightlyAbsMaintenance();
    setInterval(() => {
      maybeRunNightlyAbsMaintenance();
    }, 5 * 60 * 1000);
  } else {
    console.log('[SCHEDULER] Nightly ABS maintenance disabled via NIGHTLY_ABS_MAINTENANCE_ENABLED');
  }
});
