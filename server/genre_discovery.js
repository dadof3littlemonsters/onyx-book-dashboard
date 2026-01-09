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

  generateErrorMockBook(genre, error) {
    return {
      id: `error-${Date.now()}`,
      title: "API Error",
      author: "System",
      cover: "https://via.placeholder.com/200x300/ff6b6b/ffffff?text=API+Error",
      synopsis: `Unable to fetch ${genre} books. ${error || 'Please try again later.'}`,
      rating: 0,
      pages: 0,
      source: 'error'
    };
  }

  async fetchHardcoverTrending(genre, limit = 10, useTag = false) {
    try {
      console.log(`Metadata Search Hit: ${genre} via Hardcover (${useTag ? 'tag' : 'genre'} discovery)`);
      let query;
      if (useTag) {
        query = `
          query GetBooksByTag($genre: String!, $limit: Int!) {
            books(where: { taggings: { tag: { slug: { _eq: $genre } } } }, limit: $limit) {
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
      } else {
        query = `
          query GetTrendingBooks($genre: String!, $limit: Int!) {
            books(where: { genres: { some: { name: { icontains: $genre } } } }, limit: $limit) {
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
      }

      // Log auth header for debugging
      TimeoutHandler.logAuthHeader('Hardcover', process.env.HARDCOVER_TOKEN?.trim(), `(genre: ${genre})`);

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
          variables: { genre, limit }
        })
      }, 5000);

      if (!response.ok) {
        console.error(`[FATAL] 404 on URL: ${apiUrl}`);
        throw new Error(`Hardcover API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[FATAL] Hardcover returned HTML instead of JSON. Check URL: ${response.url}`);
        throw new Error('Hardcover returned HTML instead of JSON - invalid endpoint');
      }

      const data = await response.json();

      if (data.data?.books) {
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
    } catch (error) {
      TimeoutHandler.handleError('Hardcover', error, `Hardcover trending for ${genre}`);
      return [];
    }
    return [];
  }

  async fetchHardcoverTrendingBooks(limit = 50) {
    try {
      console.log(`Metadata Search Hit: trending via Hardcover`);
      const query = `
        query GetTrendingBooks($limit: Int!) {
          trending_books(limit: $limit) {
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
      }, 5000);

      if (!response.ok) {
        console.error(`[FATAL] 404 on URL: ${apiUrl}`);
        throw new Error(`Hardcover API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[FATAL] Hardcover returned HTML instead of JSON. Check URL: ${response.url}`);
        throw new Error('Hardcover returned HTML instead of JSON - invalid endpoint');
      }

      const data = await response.json();
      if (data.data?.trending_books) {
        return data.data.trending_books.map(book => ({
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
    } catch (error) {
      console.error('Error fetching trending books:', error.message);
      return [];
    }
    return [];
  }

  async fetchHardcoverTikTokBooks(limit = 50) {
    try {
      console.log(`Metadata Search Hit: TikTok list via Hardcover`);
      const query = `
        query GetTikTokList {
          list(slug: "the-book-you-saw-on-tiktok") {
            list_books {
              book {
                title
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
          }
        }
      `;

      TimeoutHandler.logAuthHeader('Hardcover', process.env.HARDCOVER_TOKEN?.trim(), '(tiktok)');

      const apiUrl = 'https://api.hardcover.app/v1/graphql';
      const response = await TimeoutHandler.fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN?.trim() || ''}`,
        },
        body: JSON.stringify({ query })
      }, 5000);

      if (!response.ok) {
        console.error(`[FATAL] 404 on URL: ${apiUrl}`);
        throw new Error(`Hardcover API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[FATAL] Hardcover returned HTML instead of JSON. Check URL: ${response.url}`);
        throw new Error('Hardcover returned HTML instead of JSON - invalid endpoint');
      }

      const data = await response.json();
      if (data.data?.list?.list_books) {
        const books = data.data.list.list_books.slice(0, limit).map(item => ({
          id: `tiktok-${Date.now()}-${Math.random()}`,
          title: item.book.title,
          author: item.book.contributions?.[0]?.author?.name || 'Unknown Author',
          cover: item.book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(item.book.image.url)}` : null,
          synopsis: 'Popular on TikTok',
          rating: 4.0,
          pages: 0,
          source: 'hardcover-tiktok'
        }));
        return books;
      }
    } catch (error) {
      console.error('Error fetching TikTok books:', error.message);
      return [];
    }
    return [];
  }

  async fetchHardcoverForRow(tagSlugs, limit = 50) {
    const allBooks = [];
    for (const tagSlug of tagSlugs) {
      try {
        const books = await this.fetchHardcoverTrending(tagSlug, Math.ceil(limit / tagSlugs.length), true);
        allBooks.push(...books);
      } catch (error) {
        console.error('Error fetching tag ' + tagSlug + ':', error.message);
        continue;
      }
    }
    const uniqueBooks = this.deduplicateBooks(allBooks);
    return uniqueBooks.slice(0, limit);
  }

  async fetchAudnexusAuthors(searchTerms, limit = 10) {
    try {
      console.log(`Metadata Search Hit: ${searchTerms} via Audnexus (authors)`);
      const encodedTerms = encodeURIComponent(searchTerms);
      const response = await TimeoutHandler.fetchWithTimeout(`https://api.audnex.us/authors?name=${encodedTerms}`, {}, 5000);

      if (!response.ok) {
        throw new Error(`Audnexus API error: ${response.status}`);
      }

      const data = await response.json();

      if (data && Array.isArray(data) && data.length > 0) {
        // Get books for the first matching author
        const author = data[0];
        const authorResponse = await TimeoutHandler.fetchWithTimeout(`https://api.audnex.us/authors/${author.asin}`, {}, 5000);

        if (authorResponse.ok) {
          const authorData = await authorResponse.json();

          if (authorData.books && Array.isArray(authorData.books)) {
            return authorData.books.slice(0, limit).map(book => ({
              id: book.asin || book.id,
              title: book.title,
              author: authorData.name || 'Unknown Author',
              narrator: book.narrators?.[0]?.name,
              cover: book.image,
              synopsis: book.description,
              rating: book.averageRating,
              duration: book.runtimeLengthMin,
              publishDate: book.publishedDate,
              series: book.seriesPrimary?.name,
              seriesPosition: book.seriesPrimary?.position,
              genres: book.genres,
              source: 'audnexus'
            }));
          }
        }
      }
    } catch (error) {
      TimeoutHandler.handleError('Audnexus', error, `Authors for ${searchTerms}`);
    }
    return [];
  }

  async getRomantasyBooks() {
    return this.getCachedOrFetch('romantasy', async () => {
      console.log('[DEBUG] Requesting Hardcover row for: Romantasy');
      console.log('Fetching Romantasy books...');

      try {
        // Hardcover-only strict discovery
        const hardcoverResults = await this.fetchHardcoverForRow(['romantasy'], 50);
        return hardcoverResults; // Return empty array if no results
      } catch (error) {
        console.error('Error in getRomantasyBooks:', error.message);
        return []; // Return empty array instead of mock books
      }
    });
  }

  async getHighFantasyBooks() {
    return this.getCachedOrFetch('fantasy', async () => {
      console.log('[DEBUG] Requesting Hardcover row for: Fantasy');
      console.log('Fetching Fantasy books...');

      try {
        // Hardcover-only strict discovery
        const hardcoverResults = await this.fetchHardcoverForRow(['fantasy'], 50);
        return hardcoverResults; // Return empty array if no results
      } catch (error) {
        console.error('Error in getHighFantasyBooks:', error.message);
        return []; // Return empty array instead of mock books
      }
    });
  }

  async getSciFiBooks() {
    return this.getCachedOrFetch('dystopian', async () => {
      console.log('[DEBUG] Requesting Hardcover row for: Dystopian');
      console.log('Fetching Dystopian books...');

      try {
        // Hardcover-only strict discovery
        const hardcoverResults = await this.fetchHardcoverForRow(['dystopian'], 50);
        return hardcoverResults; // Return empty array if no results
      } catch (error) {
        console.error('Error in getSciFiBooks:', error.message);
        return []; // Return empty array instead of mock books
      }
    });
  }

  async getCozyBooks() {
    return this.getCachedOrFetch('cozy', async () => {
      console.log('[DEBUG] Requesting Hardcover row for: Cozy');
      console.log('Fetching Cozy books...');

      try {
        // Hardcover-only strict discovery
        const hardcoverResults = await this.fetchHardcoverForRow(['cozy'], 50);
        return hardcoverResults; // Return empty array if no results
      } catch (error) {
        console.error('Error in getCozyBooks:', error.message);
        return []; // Return empty array instead of mock books
      }
    });
  }

  // Keep backward compatibility
  async getPalateCleanserBooks() {
    return this.getCozyBooks();
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
      console.log('[DEBUG] Genre discovery already in progress, skipping...');
      return this.cache.get('allGenres')?.data || { romantasy: [], fantasy: [], dystopian: [], cozy: [], highFantasy: [], sciFi: [], palateCleanser: [], totalBooks: 0, generatedAt: new Date().toISOString() };
    }

    this.isInitializing = true;
    console.log('[DEBUG] Starting comprehensive genre discovery across all rows');
    console.log('Starting dynamic genre discovery...');

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
        // Backward compatibility fields
        highFantasy: fantasy,
        sciFi: dystopian,
        palateCleanser: cozy,
        totalBooks: romantasy.length + fantasy.length + dystopian.length + cozy.length,
        generatedAt: new Date().toISOString()
      };

      console.log(`Generated ${result.totalBooks} books across 4 genres`);
      this.cache.set('allGenres', { data: result, timestamp: Date.now() });
      this.isInitializing = false;
      return result;
    } catch (error) {
      console.error('Error in dynamic genre discovery:', error);

      // Fallback to empty arrays
      const result = {
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
      this.isInitializing = false;
      return result;
    }
  }

  async searchGenre(genre, query, limit = 20) {
    console.log(`Searching ${genre} for: ${query}`);

    try {
      // Hardcover-only search
      const hardcoverResults = await this.fetchHardcoverTrending(genre, limit);

      // Filter by query if provided
      if (query && query.trim()) {
        const queryLower = query.toLowerCase();
        return hardcoverResults.filter(book =>
          book.title.toLowerCase().includes(queryLower) ||
          book.author.toLowerCase().includes(queryLower) ||
          book.synopsis?.toLowerCase().includes(queryLower)
        ).slice(0, limit);
      }

      return hardcoverResults.slice(0, limit);
    } catch (error) {
      console.error(`Error searching ${genre}:`, error);
      return [];
    }
  }
}

module.exports = GenreDiscovery;