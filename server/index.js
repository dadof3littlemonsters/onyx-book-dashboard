require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const prowlarrService = require('./services/prowlarr');
const qbittorrentService = require('./services/qbittorrent');
const dataStore = require('./services/dataStore');
const audiobookshelfService = require('./services/audiobookshelf');
const MetadataAggregator = require('./metadata_aggregator');
const LibraryScanner = require('./scanner');
const GenreDiscovery = require('./genre_discovery');
const TimeoutHandler = require('./utils/timeout');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const metadataAggregator = new MetadataAggregator();
const libraryScanner = new LibraryScanner();
const genreDiscovery = new GenreDiscovery();

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


// Mock book data for development
const mockBooks = {
  romantasy: [
    {
      id: 1,
      title: "Fourth Wing",
      author: "Rebecca Yarros",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Fourth+Wing",
      synopsis: "Twenty-year-old Violet Sorrengail was supposed to enter the Scribe Quadrant, living a quiet life among books and history. Now, the commanding general—also known as her tough-as-talons mother—has ordered Violet to join the hundreds of candidates striving to become the elite of Navarre: dragon riders.",
      rating: 4.5,
      pages: 512
    },
    {
      id: 2,
      title: "A Court of Thorns and Roses",
      author: "Sarah J. Maas",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=ACOTAR",
      synopsis: "When nineteen-year-old huntress Feyre kills a wolf in the woods, a terrifying creature arrives to demand retribution. Dragged to a treacherous magical land she knows about only from legends, Feyre discovers that her captor is not truly a beast, but one of the lethal, immortal faeries who once ruled her world.",
      rating: 4.3,
      pages: 432
    },
    {
      id: 3,
      title: "The Seven Husbands of Evelyn Hugo",
      author: "Taylor Jenkins Reid",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Seven+Husbands",
      synopsis: "Aging and reclusive Hollywood movie icon Evelyn Hugo is finally ready to tell the truth about her glamorous and scandalous life. But when she chooses unknown magazine reporter Monique Grant for the job, no one is more astounded than Monique herself.",
      rating: 4.7,
      pages: 400
    },
    {
      id: 4,
      title: "Book Lovers",
      author: "Emily Henry",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Book+Lovers",
      synopsis: "Nora Stephens' life is books—she's read them all—and she is not that type of heroine. Not the plucky one, not the laidback dream girl, and especially not the sweetheart. In fact, the only people Nora is a heroine for are her clients, for whom she lands enormous deals as a cutthroat literary agent.",
      rating: 4.4,
      pages: 368
    }
  ],
  highFantasy: [
    {
      id: 5,
      title: "The Name of the Wind",
      author: "Patrick Rothfuss",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Name+of+Wind",
      synopsis: "Told in Kvothe's own voice, this is the tale of the magically gifted young man who grows to be the most notorious wizard his world has ever seen. The intimate narrative of his childhood in a troupe of traveling players, his years spent as a near-feral orphan in a crime-ridden city, his daringly brazen yet successful bid to enter a legendary school of magic.",
      rating: 4.6,
      pages: 672
    },
    {
      id: 6,
      title: "The Way of Kings",
      author: "Brandon Sanderson",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Way+of+Kings",
      synopsis: "Roshar is a world of stone and storms. Uncanny tempests of incredible power sweep across the rocky terrain so frequently that they have shaped ecology and civilization alike. Animals hide in shells, trees pull in branches, and grass retracts into the soilless ground.",
      rating: 4.8,
      pages: 1007
    },
    {
      id: 7,
      title: "The Blade Itself",
      author: "Joe Abercrombie",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Blade+Itself",
      synopsis: "Logen Ninefingers, infamous barbarian, has finally run out of luck. Caught in one feud too many, he's on the verge of becoming a dead barbarian—leaving nothing behind him but bad songs, dead friends, and a lot of happy enemies.",
      rating: 4.2,
      pages: 515
    },
    {
      id: 8,
      title: "The Final Empire",
      author: "Brandon Sanderson",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Final+Empire",
      synopsis: "For a thousand years the ash fell and no flowers bloomed. For a thousand years the Skaa slaved in misery and lived in fear. For a thousand years the Lord Ruler, the 'Sliver of Infinity,' reigned with absolute power and ultimate terror, divinely invincible.",
      rating: 4.7,
      pages: 541
    }
  ],
  sciFi: [
    {
      id: 9,
      title: "Dune",
      author: "Frank Herbert",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Dune",
      synopsis: "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family tasked with ruling an inhospitable world where the only thing of value is the 'spice' melange, a drug capable of extending life and enhancing consciousness.",
      rating: 4.5,
      pages: 688
    },
    {
      id: 10,
      title: "The Expanse: Leviathan Wakes",
      author: "James S.A. Corey",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Leviathan+Wakes",
      synopsis: "Humanity has colonized the solar system—Mars, the Moon, the Asteroid Belt and beyond—but the stars are still out of our reach. Jim Holden is XO of an ice miner making runs from the rings of Saturn to the mining stations of the Belt.",
      rating: 4.4,
      pages: 561
    },
    {
      id: 11,
      title: "Neuromancer",
      author: "William Gibson",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Neuromancer",
      synopsis: "The Matrix is a world within the world, a global consensus-hallucination, the representation of every byte of data in cyberspace. Case had been the sharpest data-thief in the business, until vengeful former employers crippled his nervous system.",
      rating: 4.1,
      pages: 271
    },
    {
      id: 12,
      title: "Project Hail Mary",
      author: "Andy Weir",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Project+Hail+Mary",
      synopsis: "Ryland Grace is the sole survivor on a desperate, last-chance mission—and if he fails, humanity and the earth itself will perish. Except that right now, he doesn't know that. He can't even remember his own name, let alone the nature of his assignment.",
      rating: 4.6,
      pages: 496
    }
  ],
  palateCleanser: [
    {
      id: 13,
      title: "The Undead Day One",
      author: "RR Haywood",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Undead+Day+One",
      synopsis: "The first day of the zombie apocalypse. Follow the survivors as they struggle through the first twenty-four hours of hell on earth. Post-apocalyptic horror at its finest.",
      rating: 4.3,
      pages: 312
    },
    {
      id: 14,
      title: "Zombie Fallout",
      author: "Mark Tufo",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Zombie+Fallout",
      synopsis: "It was a flu season like no other. The H1N1 virus had been tampered with and the new and improved strain was airborne, fast acting and worse still, necrotizing. Military horror meets zombie apocalypse.",
      rating: 4.2,
      pages: 298
    },
    {
      id: 15,
      title: "Extraction Point",
      author: "RR Haywood",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Extraction+Point",
      synopsis: "A covert military operation goes wrong in the heart of zombie-infested London. Military horror and post-apocalyptic survival combine in this intense thriller.",
      rating: 4.4,
      pages: 356
    },
    {
      id: 16,
      title: "Indian Hill",
      author: "Mark Tufo",
      cover: "https://via.placeholder.com/200x300/1a1a1a/ffffff?text=Indian+Hill",
      synopsis: "The zombie apocalypse continues as Mike Talbot fights to keep his family alive in a world gone mad. Military tactics meet horror survival.",
      rating: 4.1,
      pages: 324
    }
  ]
};

// API Routes
app.get('/api/books/:category', async (req, res) => {
  const { category } = req.params;
  const { search, useDynamic = 'true' } = req.query;

  try {
    let books = [];

    // Mock mode is allowed only in non-production for local dev.
    if (useDynamic !== 'true') {
      if (process.env.NODE_ENV === 'production') {
        return res.json([]);
      }
      books = mockBooks[category] || [];
    } else {
      console.log(`Fetching Hardcover books for category: ${category}`);

      switch (category) {
        case 'romantasy':
          books = await genreDiscovery.getRomantasyBooks();
          break;

        // Canonical fantasy row (keep backward compatibility with "highFantasy")
        case 'fantasy':
        case 'highFantasy':
          books = await genreDiscovery.getHighFantasyBooks();
          break;

        // Canonical dystopian row (keep backward compatibility with "sciFi")
        case 'dystopian':
        case 'sciFi':
          books = await genreDiscovery.getSciFiBooks();
          break;

        // Cozy row (keep backward compatibility with "palateCleanser")
        case 'cozy':
        case 'palateCleanser':
          books = await genreDiscovery.getCozyBooks();
          break;

        default:
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
    console.log(`Metadata Search Hit: ${q} via Hardcover (Live GraphQL)`);

    // Live GraphQL Search with title filtering
    const hardcoverQuery = `
      query SearchBooks($query: String!, $limit: Int!) {
        books(where: {title: {_ilike: $query}}, limit: $limit) {
          id
          title
          subtitle
          description
          image {
            url
          }
          contributions {
            author {
              name
            }
          }
        }
      }
    `;

    // Log auth header for debugging
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
          query: `%${q.trim()}%`, // Use SQL LIKE pattern
          limit: 50
        }
      })
    }, 5000);

    let results = [];

    if (hardcoverResponse.ok) {
      const contentType = hardcoverResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[FATAL] Hardcover returned HTML instead of JSON. Check URL: ${hardcoverResponse.url}`);
        throw new Error('Hardcover returned HTML instead of JSON - invalid endpoint');
      }

      const hardcoverData = await hardcoverResponse.json();

      if (hardcoverData.data?.books) {
        results = hardcoverData.data.books.map(book => ({
          id: `hardcover-${book.id}`,
          title: book.title,
          subtitle: book.subtitle,
          author: book.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(book.image.url)}` : null,
          synopsis: book.description,
          rating: null,
          pages: null,
          publishDate: null,
          series: null,
          seriesPosition: null,
          reviewsCount: null,
          source: 'hardcover',
          category: 'search'
        }));
      }
    } else {
      console.error(`[FATAL] 404 on URL: ${apiUrl} - Status: ${hardcoverResponse.status}`);
    }

    // Hardcover-only strict search - no fallbacks or mock data
    console.log(`[SEARCH] Found ${results.length} results for "${q}" from Hardcover`);
    res.json(results);
  } catch (error) {
    console.error('[CRITICAL] Hardcover search error:', error.message);
    TimeoutHandler.handleError('Search', error, 'Live search temporarily unavailable');

    // Hardcover-only - return empty results on error (no fallbacks)
    res.json([]);
  }
});

// Admin routes
app.post('/api/admin/login', (req, res) => {
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
    const results = await prowlarrService.search(query);

    const formattedResults = results.map(result => ({
      ...result,
      formattedSize: prowlarrService.formatSize(result.size),
      categoryName: prowlarrService.getCategoryName(result.category)
    }));

    res.json({
      success: true,
      results: formattedResults,
      total: results.length
    });
  } catch (error) {
    console.error('Error searching Prowlarr:', error);
    res.status(500).json({
      success: false,
      message: 'Prowlarr search failed: ' + error.message
    });
  }
});

app.post('/api/admin/download/:requestId', requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  const { magnetUrl, title, tracker } = req.body;

  try {
    const downloadResult = await qbittorrentService.addTorrent(magnetUrl);

    if (downloadResult.success) {
      await dataStore.updateRequestStatus(requestId, 'approved', {
        magnetUrl,
        title,
        tracker,
        downloadedAt: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Download started successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        message: downloadResult.message
      });
    }
  } catch (error) {
    console.error('Error starting download:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start download: ' + error.message
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

// Image proxy route to fix 403 Forbidden Hardcover image issues
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  // Only allow hardcover.app and other trusted domains
  const allowedDomains = [
    'assets.hardcover.app',
    'via.placeholder.com', // For mock images
    'covers.openlibrary.org' // For Open Library covers
  ];

  try {
    const imageUrl = new URL(url);
    if (!allowedDomains.includes(imageUrl.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log(`[PROXY] Fetching image: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Onyx Book Dashboard/1.0',
        'Referer': 'https://hardcover.app'
      }
    });

    if (!response.ok) {
      console.error(`[PROXY] Image fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: `Image fetch failed: ${response.statusText}` });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      'Access-Control-Allow-Origin': '*'
    });

    // Pipe the image data
    response.body.pipe(res);

  } catch (error) {
    console.error(`[PROXY] Error proxying image:`, error.message);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// Image proxy route using axios (new implementation as specified)
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  // Only allow trusted domains for security
  const allowedDomains = [
    'assets.hardcover.app',
    'via.placeholder.com',
    'covers.openlibrary.org'
  ];

  try {
    const imageUrl = new URL(url);
    if (!allowedDomains.includes(imageUrl.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log(`[IMAGE-PROXY] Fetching image: ${url}`);

    // Use axios to fetch the image with proper browser-like headers
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream', // Important: stream the response
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://hardcover.app/',
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
      'Access-Control-Allow-Origin': '*',
      'Content-Length': response.headers['content-length']
    });

    // Pipe the image data directly to the client
    response.data.pipe(res);

    console.log(`[IMAGE-PROXY] Successfully proxied image: ${response.status} ${response.headers['content-type']}`);

  } catch (error) {
    console.error(`[IMAGE-PROXY] Error proxying image:`, error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: `Image fetch failed: ${error.response.status} ${error.response.statusText}`
      });
    }

    res.status(500).json({ error: 'Failed to proxy image' });
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
      libraryScanner.clearLibrary()
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

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));

  app.get('*', (req, res) => {
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

    // Force metadata discovery initialization
    try {
      console.log('[INIT] Starting metadata discovery initialization...');
      const genres = await genreDiscovery.getAllGenreBooks();
      console.log(`[INIT] Metadata discovery complete: ${genres.totalBooks} books across 4 genres`);
    } catch (error) {
      console.log(`[INIT] Metadata discovery failed: ${error.message}`);
    }

    console.log('[INIT] Background initialization complete');
  });
});