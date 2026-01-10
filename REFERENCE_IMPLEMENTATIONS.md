# REFERENCE IMPLEMENTATIONS FOR CLAUDE CODE

## Complete File: server/genre_discovery.js

Save this as the COMPLETE replacement for server/genre_discovery.js:

```javascript
const MetadataAggregator = require('./metadata_aggregator');
const TimeoutHandler = require('./utils/timeout');

class GenreDiscovery {
  constructor() {
    this.metadataAggregator = new MetadataAggregator();
    this.isInitializing = false;
    this.cache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
  }

  getCachedOrFetch(key, fetchFunction) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      console.log(`[CACHE] Using cached data for ${key}`);
      return Promise.resolve(cached.data);
    }

    console.log(`[CACHE] Cache miss for ${key}, fetching fresh data`);
    return fetchFunction().then(data => {
      this.cache.set(key, { data, timestamp: Date.now() });
      return data;
    });
  }

  async fetchHardcoverBooks(searchTerm, limit = 20) {
    try {
      console.log(`[HARDCOVER] Fetching books for: "${searchTerm}"`);
      
      const query = `
        query SearchBooks($search: String!, $limit: Int!) {
          books(
            where: {
              title: {
                _ilike: $search
              }
            }
            limit: $limit
          ) {
            id
            title
            subtitle
            description
            pages
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

      TimeoutHandler.logAuthHeader('Hardcover', process.env.HARDCOVER_TOKEN?.trim(), `(search: ${searchTerm})`);

      const apiUrl = 'https://api.hardcover.app/v1/graphql';
      const response = await TimeoutHandler.fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN?.trim() || ''}`,
        },
        body: JSON.stringify({
          query,
          variables: { 
            search: `%${searchTerm}%`,
            limit 
          }
        })
      }, 10000);

      if (!response.ok) {
        console.error(`[HARDCOVER] HTTP ${response.status}: ${apiUrl}`);
        throw new Error(`Hardcover API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[HARDCOVER] Returned HTML instead of JSON`);
        throw new Error('Hardcover returned HTML - invalid endpoint or auth failure');
      }

      const data = await response.json();

      if (data.errors) {
        console.error('[HARDCOVER] GraphQL Errors:', JSON.stringify(data.errors, null, 2));
        throw new Error(`GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
      }

      if (data.data?.books) {
        console.log(`[HARDCOVER] ✅ Found ${data.data.books.length} books for "${searchTerm}"`);
        return data.data.books.map(book => ({
          id: book.id,
          title: book.title,
          subtitle: book.subtitle,
          author: book.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(book.image.url)}` : null,
          synopsis: book.description,
          rating: null,
          pages: book.pages,
          publishDate: null,
          series: null,
          seriesPosition: null,
          genres: null,
          reviewsCount: null,
          source: 'hardcover'
        }));
      }

      console.log(`[HARDCOVER] ⚠️ No books found for "${searchTerm}"`);
      return [];
    } catch (error) {
      TimeoutHandler.handleError('Hardcover', error, `Search for "${searchTerm}"`);
      return [];
    }
  }

  async fetchHardcoverTrendingBooks(limit = 50) {
    try {
      console.log(`[HARDCOVER] Fetching trending books...`);
      
      const query = `
        query GetPopularBooks($limit: Int!) {
          books(
            order_by: {
              ratings_count: desc
            }
            limit: $limit
          ) {
            id
            title
            subtitle
            description
            pages
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

      TimeoutHandler.logAuthHeader('Hardcover', process.env.HARDCOVER_TOKEN?.trim(), '(trending)');

      const apiUrl = 'https://api.hardcover.app/v1/graphql';
      const response = await TimeoutHandler.fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN?.trim() || ''}`,
        },
        body: JSON.stringify({
          query,
          variables: { limit }
        })
      }, 10000);

      if (!response.ok) {
        throw new Error(`Hardcover API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        console.error('[HARDCOVER] GraphQL Errors:', data.errors);
        throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
      }

      if (data.data?.books) {
        console.log(`[HARDCOVER] ✅ Found ${data.data.books.length} trending books`);
        return data.data.books.map(book => ({
          id: book.id,
          title: book.title,
          subtitle: book.subtitle,
          author: book.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(book.image.url)}` : null,
          synopsis: book.description,
          rating: null,
          pages: book.pages,
          publishDate: null,
          series: null,
          seriesPosition: null,
          genres: null,
          reviewsCount: null,
          source: 'hardcover'
        }));
      }
      
      return [];
    } catch (error) {
      console.error('[HARDCOVER] Error fetching trending:', error.message);
      return [];
    }
  }

  async getRomantasyBooks() {
    return this.getCachedOrFetch('romantasy', async () => {
      console.log('[GENRE] Fetching Romantasy books...');
      const books = await this.fetchHardcoverBooks('romantasy', 50);
      if (books.length === 0) {
        const fallback1 = await this.fetchHardcoverBooks('fourth wing', 25);
        const fallback2 = await this.fetchHardcoverBooks('fae', 25);
        return this.deduplicateBooks([...fallback1, ...fallback2]);
      }
      return books;
    });
  }

  async getHighFantasyBooks() {
    return this.getCachedOrFetch('fantasy', async () => {
      console.log('[GENRE] Fetching Fantasy books...');
      const books = await this.fetchHardcoverBooks('fantasy', 50);
      if (books.length === 0) {
        const fallback1 = await this.fetchHardcoverBooks('sanderson', 25);
        const fallback2 = await this.fetchHardcoverBooks('tolkien', 25);
        return this.deduplicateBooks([...fallback1, ...fallback2]);
      }
      return books;
    });
  }

  async getSciFiBooks() {
    return this.getCachedOrFetch('dystopian', async () => {
      console.log('[GENRE] Fetching Dystopian books...');
      const books = await this.fetchHardcoverBooks('dystopian', 50);
      if (books.length === 0) {
        const fallback = await this.fetchHardcoverBooks('science fiction', 50);
        return fallback;
      }
      return books;
    });
  }

  async getCozyBooks() {
    return this.getCachedOrFetch('cozy', async () => {
      console.log('[GENRE] Fetching Cozy books...');
      const books = await this.fetchHardcoverBooks('cozy mystery', 50);
      if (books.length === 0) {
        const fallback = await this.fetchHardcoverBooks('comfort read', 50);
        return fallback;
      }
      return books;
    });
  }

  deduplicateBooks(books) {
    const seen = new Map();
    const uniqueBooks = [];

    for (const book of books) {
      const key = `${book.title.toLowerCase().trim()}:${book.author.toLowerCase().trim()}`;

      if (!seen.has(key)) {
        seen.set(key, true);
        uniqueBooks.push(book);
      }
    }

    return uniqueBooks;
  }

  async getAllGenreBooks() {
    if (this.isInitializing) {
      console.log('[GENRE] Already initializing, returning cached data...');
      return this.cache.get('allGenres')?.data || { 
        romantasy: [], 
        fantasy: [], 
        dystopian: [], 
        cozy: [], 
        totalBooks: 0, 
        generatedAt: new Date().toISOString() 
      };
    }

    this.isInitializing = true;
    console.log('[GENRE] Starting genre discovery...');

    try {
      const [romantasy, fantasy, dystopian, cozy] = await Promise.all([
        this.getRomantasyBooks(),
        this.getHighFantasyBooks(),
        this.getSciFiBooks(),
        this.getCozyBooks()
      ]);

      const result = {
        romantasy,
        fantasy,
        dystopian,
        cozy,
        highFantasy: fantasy,
        sciFi: dystopian,
        palateCleanser: cozy,
        totalBooks: romantasy.length + fantasy.length + dystopian.length + cozy.length,
        generatedAt: new Date().toISOString()
      };

      console.log(`[GENRE] ✅ Generated ${result.totalBooks} books across 4 genres`);
      this.cache.set('allGenres', { data: result, timestamp: Date.now() });
      this.isInitializing = false;
      return result;
    } catch (error) {
      console.error('[GENRE] Error in genre discovery:', error);
      this.isInitializing = false;
      return {
        romantasy: [],
        fantasy: [],
        dystopian: [],
        cozy: [],
        highFantasy: [],
        sciFi: [],
        palateCleanser: [],
        totalBooks: 0,
        error: error.message,
        generatedAt: new Date().toISOString()
      };
    }
  }

  async searchGenre(genre, query, limit = 20) {
    console.log(`[SEARCH] Searching ${genre} for: ${query}`);
    return this.fetchHardcoverBooks(`${genre} ${query}`, limit);
  }
}

module.exports = GenreDiscovery;
```

## Search Endpoint Replacement for server/index.js

Find the `app.get('/api/search', ...)` endpoint and replace it with this:

```javascript
app.get('/api/search', async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.json([]);
  }

  try {
    console.log(`[SEARCH] Query: "${q}"`);

    const hardcoverQuery = `
      query SearchBooks($search: String!, $limit: Int!) {
        books(
          where: {
            title: {
              _ilike: $search
            }
          }
          limit: $limit
        ) {
          id
          title
          subtitle
          description
          pages
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
          search: `%${q.trim()}%`,
          limit: 50
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

      if (hardcoverData.data?.books && Array.isArray(hardcoverData.data.books)) {
        console.log(`[SEARCH] ✅ Found ${hardcoverData.data.books.length} results for "${q}"`);
        
        results = hardcoverData.data.books.map(book => ({
          id: `hardcover-${book.id}`,
          title: book.title,
          subtitle: book.subtitle,
          author: book.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(book.image.url)}` : null,
          synopsis: book.description,
          rating: null,
          pages: book.pages,
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
```

---

Use these exact implementations when fixing the files.
