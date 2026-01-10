const fs = require('fs').promises;
const path = require('path');
const googleBooksApi = require('./googleBooksApi');
const coverResolver = require('./coverResolver');

class DiscoveryCache {
  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.cacheFile = path.join(this.dataDir, 'discovery_cache.json');
    this.cache = null;
    this.lastGenerated = null;
    this.genreMappings = this.getGenreMappings();
    this.awardsIsbns = this.getAwardsIsbns();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getGenreMappings() {
    return {
      new_releases: {
        query: 'fiction',
        orderBy: 'newest',
        filter: (book) => this.isRecentBook(book, 3)
      },
      hidden_gems: {
        query: 'subject:fiction',
        orderBy: 'relevance',
        filter: (book) => this.isHiddenGem(book)
      },
      popular: {
        query: 'fiction',
        orderBy: 'newest',
        filter: null
      },
      fantasy: {
        query: 'subject:fantasy',
        orderBy: 'relevance',
        filter: null
      },
      scifi: {
        query: 'subject:science+fiction',
        orderBy: 'relevance',
        filter: null
      },
      romantasy: {
        query: 'subject:fantasy+romance',
        orderBy: 'relevance',
        filter: null
      },
      cozy: {
        query: 'subject:cozy+mystery',
        orderBy: 'relevance',
        filter: null
      },
      awards: {
        query: null,
        orderBy: null,
        filter: null,
        isbns: this.awardsIsbns
      },
      series_starters: {
        query: 'subject:fiction',
        orderBy: 'relevance',
        filter: (book) => this.isSeriesStarter(book)
      }
    };
  }

  getAwardsIsbns() {
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
      '9781250166901',  // The Obelisk Gate (Hugo nominee)
      '9780765328663',  // Caliban's War (Hugo nominee)
      '9781250303566',  // Harrow the Ninth (Hugo nominee)
      '9781250765921',  // A Desolation Called Peace (Hugo winner)
      '9780765377068',  // The Dark Forest (Hugo nominee)
      '9781250303566',  // Nona the Ninth (Hugo nominee)
      '9781250766607',  // Fugitive Telemetry (Hugo nominee)
      '9781250768359',  // The Spare Man (Hugo nominee)
      '9780765375866',  // The Fated Sky (Hugo nominee)
      '9780765397530',  // Binti: Home (Hugo nominee)
      '9780765397547',  // Binti: The Night Masquerade (Hugo nominee)
      '9781250166901',  // The Stone Sky (Hugo winner)
      '9780765375620',  // Artificial Condition (Hugo winner)
      '9780765375637',  // Rogue Protocol (Hugo nominee)
      '9780765375644',  // Exit Strategy (Hugo nominee)
      '9781250765921',  // A Memory Called Empire (Hugo winner)
      '9781250766607',  // Network Effect (Hugo winner)
      '9781250768359',  // A Desolation Called Peace (Hugo winner)
      '9780765382030',  // The Strange Case of the Alchemist's Daughter (Hugo nominee)
      '9780765382047',  // European Travel for the Monstrous Gentlewoman (Hugo nominee)
      '9780765382054',  // The Sinister Mystery of the Mesmerizing Girl (Hugo nominee)
      '9781250303566',  // Gideon the Ninth (Hugo nominee)
      '9781250765921',  // A Memory Called Empire (Hugo winner)
      '9781250766607',  // Network Effect (Hugo winner)
      '9781250768359',  // A Desolation Called Peace (Hugo winner)
      '9780765377068',  // The Three-Body Problem (Hugo winner)
      '9780765377075'   // The Dark Forest (Hugo nominee)
    ];
  }

  isRecentBook(book, months = 3) {
    if (!book.publishedDate) return false;

    const published = this.parseDate(book.publishedDate);
    if (!published) return false;

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);

    return published > cutoffDate;
  }

  isHiddenGem(book) {
    const rating = book.averageRating || 0;
    const ratingsCount = book.ratingsCount || 0;
    return rating >= 4.0 && ratingsCount < 1000;
  }

  isSeriesStarter(book) {
    if (!book.title) return false;

    const title = book.title.toLowerCase();
    const seriesIndicators = [
      'book 1',
      'volume 1',
      'part 1',
      '#1',
      'first book',
      'initial volume',
      'beginning',
      'origins'
    ];

    return seriesIndicators.some(indicator => title.includes(indicator));
  }

  parseDate(dateStr) {
    if (!dateStr) return null;

    const yearMatch = dateStr.match(/\d{4}/);
    if (!yearMatch) return null;

    const year = parseInt(yearMatch[0]);
    const monthMatch = dateStr.match(/\d{4}-(\d{1,2})/);
    const month = monthMatch ? parseInt(monthMatch[1]) - 1 : 0;
    const dayMatch = dateStr.match(/\d{4}-\d{1,2}-(\d{1,2})/);
    const day = dayMatch ? parseInt(dayMatch[1]) : 1;

    return new Date(year, month, day);
  }

  async generateDailyCache() {
    console.log('[DiscoveryCache] Starting daily cache generation...');
    const startTime = Date.now();

    try {
      await this.ensureDataDirectory();

      const cache = {
        generatedAt: new Date().toISOString(),
        genres: {}
      };

      for (const [genreKey, config] of Object.entries(this.genreMappings)) {
        console.log(`[DiscoveryCache] Generating cache for genre: ${genreKey}`);

        let books = [];

        if (genreKey === 'awards') {
          books = await this.fetchAwardsBooks(config.isbns);
        } else {
          const query = config.query;
          books = await googleBooksApi.fetchBooksBySubject(query, 40, config.orderBy || 'relevance');

          if (config.filter) {
            books = books.filter(config.filter);
          }
        }

        if (books.length > 0) {
          books = await this.enrichBooksWithCovers(books);
        }

        cache.genres[genreKey] = books.slice(0, 40);
        console.log(`[DiscoveryCache] Cached ${cache.genres[genreKey].length} books for ${genreKey}`);
        await this.sleep(1000);
      }

      await this.saveCacheToFile(cache);
      this.cache = cache;
      this.lastGenerated = new Date();

      const elapsed = Date.now() - startTime;
      console.log(`[DiscoveryCache] Daily cache generation completed in ${elapsed}ms`);

      return cache;
    } catch (error) {
      console.error('[DiscoveryCache] Error generating daily cache:', error);
      throw error;
    }
  }

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
          books.push(result[0]);
          console.log(`[DiscoveryCache] ✓ Found: ${result[0].title}`);
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

  async enrichBooksWithCovers(books) {
    const enrichedBooks = [];

    for (const book of books) {
      try {
        const coverUrl = await coverResolver.getCoverUrl(book.isbn13, book.thumbnail);
        enrichedBooks.push({
          ...book,
          coverUrl
        });
      } catch (error) {
        console.error(`[DiscoveryCache] Error enriching book ${book.isbn13}:`, error.message);
        enrichedBooks.push({
          ...book,
          coverUrl: book.thumbnail || coverResolver.getPlaceholderUrl()
        });
      }
    }

    return enrichedBooks;
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

  async getRandomizedBooks(genreKey, count = 50) {
    try {
      if (!this.cache) {
        await this.loadCacheFromFile();
      }

      if (!this.cache || this.isCacheStale()) {
        console.log('[DiscoveryCache] Cache is stale, generating new cache...');
        await this.generateDailyCache();
      }

      const genreBooks = this.cache.genres[genreKey];
      if (!genreBooks || !Array.isArray(genreBooks)) {
        console.error(`[DiscoveryCache] No books found for genre: ${genreKey}`);
        return [];
      }

      const shuffled = [...genreBooks].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count);
    } catch (error) {
      console.error(`[DiscoveryCache] Error getting randomized books for ${genreKey}:`, error);
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
}

module.exports = new DiscoveryCache();