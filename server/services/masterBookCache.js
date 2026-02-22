const fs = require('fs').promises;
const path = require('path');

class MasterBookCache {
  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.cachePath = path.join(this.dataDir, 'master_book_cache.json');
    this.saveDebounceMs = 5000;
    this.saveTimeout = null;
    this.cache = null;
  }

  /**
   * Initialize the cache by loading from disk or creating new structure
   */
  async init() {
    if (this.cache) {
      return this.cache;
    }

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const data = await fs.readFile(this.cachePath, 'utf8');
      this.cache = JSON.parse(data);
      console.log(`[MasterCache] Loaded cache with ${this.cache.stats.totalBooks} books across ${this.cache.stats.totalGenres} genres`);
      return this.cache;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[MasterCache] Error loading cache:', error.message);
      }
      // Create new cache structure
      this.cache = this._createEmptyCache();
      console.log('[MasterCache] Created new cache structure');
      return this.cache;
    }
  }

  /**
   * Create an empty cache structure
   */
  _createEmptyCache() {
    return {
      version: '3.0',
      lastUpdate: new Date().toISOString(),
      books: {},
      genreIndex: {},
      stats: {
        totalBooks: 0,
        totalGenres: 0,
        booksByGenre: {},
        lastScrape: {}
      }
    };
  }

  /**
   * Normalize a book key for deduplication
   * @param {string} title - Book title
   * @param {string} author - Book author
   * @returns {string} Normalized key
   */
  _normalizeBookKey(title, author) {
    if (!title) return null;
    const t = title.toLowerCase().trim().replace(/\s+/g, ' ');
    const a = (author || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return `${t}|${a}`;
  }

  /**
   * Check if a book exists in the cache
   * @param {string} title - Book title
   * @param {string} author - Book author
   * @returns {string|null} ISBN if exists, null otherwise
   */
  bookExists(title, author) {
    if (!this.cache) return null;

    const normalizedKey = this._normalizeBookKey(title, author);

    // Search by ISBN first (fastest)
    for (const [isbn, book] of Object.entries(this.cache.books)) {
      const bookKey = this._normalizeBookKey(book.title, book.authors?.[0] || book.author);
      if (bookKey === normalizedKey) {
        return isbn;
      }
    }

    return null;
  }

  /**
   * Add a book to the cache
   * @param {Object} book - Book object
   * @param {Array<string>} genres - Array of genre keys
   */
  addBook(book, genres = []) {
    if (!this.cache) {
      console.warn('[MasterCache] Cache not initialized, call init() first');
      return;
    }

    const isbn = book.isbn13 || book.isbn;
    const title = book.title;
    const author = Array.isArray(book.authors) ? book.authors[0] : book.author;

    if (!title) {
      console.warn('[MasterCache] Book missing title, skipping');
      return;
    }

    const now = new Date().toISOString();

    if (isbn && this.cache.books[isbn]) {
      // Book exists, merge genres and update metadata
      const existing = this.cache.books[isbn];

      // Add new genres
      for (const genre of genres) {
        if (!existing.genres.includes(genre)) {
          existing.genres.push(genre);
          // Update genre index
          if (!this.cache.genreIndex[genre]) {
            this.cache.genreIndex[genre] = [];
            this.cache.stats.totalGenres++;
          }
          if (!this.cache.genreIndex[genre].includes(isbn)) {
            this.cache.genreIndex[genre].push(isbn);
          }
        }
      }

      // Update verified time
      existing.lastVerified = now;

      console.log(`[MasterCache] Updated existing book: "${title}" (${isbn})`);
    } else {
      // New book
      const bookData = {
        title,
        authors: Array.isArray(book.authors) ? book.authors : [author],
        isbn13: isbn || null,
        coverUrl: book.coverUrl || null,
        goodreadsCoverUrl: book.goodreadsCoverUrl || null,
        description: book.description || '',
        averageRating: book.averageRating || 0,
        ratingsCount: book.ratingsCount || 0,
        publishedDate: book.publishedDate || '',
        pageCount: book.pageCount || 0,
        publisher: book.publisher || '',
        googleBooksId: book.googleBooksId || null,
        genres: genres,
        addedToCache: now,
        lastVerified: now
      };

      if (isbn) {
        this.cache.books[isbn] = bookData;
      } else {
        // For books without ISBN, use a generated key
        const tempKey = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        this.cache.books[tempKey] = bookData;
      }

      // Update genre index
      for (const genre of genres) {
        if (!this.cache.genreIndex[genre]) {
          this.cache.genreIndex[genre] = [];
          this.cache.stats.totalGenres++;
        }
        const key = isbn || this.cache.books[isbn || Object.keys(this.cache.books).pop()];
        if (!this.cache.genreIndex[genre].includes(key)) {
          this.cache.genreIndex[genre].push(key);
        }
        this.cache.stats.booksByGenre[genre] = (this.cache.stats.booksByGenre[genre] || 0) + 1;
      }

      this.cache.stats.totalBooks++;
      console.log(`[MasterCache] Added new book: "${title}" (${isbn || 'no ISBN'})`);
    }

    // Update cache timestamp
    this.cache.lastUpdate = now;

    // Schedule debounced save
    this.scheduleSave();
  }

  /**
   * Get random books from a specific genre
   * @param {string} genre - Genre key
   * @param {number} count - Number of books to return
   * @returns {Array} Array of book objects
   */
  getRandomBooks(genre, count = 50) {
    if (!this.cache) {
      console.warn('[MasterCache] Cache not initialized');
      return [];
    }

    const isbns = this.cache.genreIndex[genre];
    if (!isbns || isbns.length === 0) {
      console.warn(`[MasterCache] No books found for genre: ${genre}`);
      return [];
    }

    // Shuffle using Fisher-Yates
    const shuffled = [...isbns];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Get first N books
    const selectedIsbns = shuffled.slice(0, count);
    const books = [];

    for (const isbn of selectedIsbns) {
      if (this.cache.books[isbn]) {
        books.push(this.cache.books[isbn]);
      }
    }

    console.log(`[MasterCache] Returning ${books.length} random books for genre: ${genre}`);
    return books;
  }

  /**
   * Get a book by ISBN
   * @param {string} isbn - ISBN13
   * @returns {Object|null} Book object or null
   */
  getBookByIsbn(isbn) {
    if (!this.cache) return null;
    return this.cache.books[isbn] || null;
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    if (!this.cache) {
      return {
        hasCache: false,
        totalBooks: 0,
        totalGenres: 0
      };
    }

    return {
      hasCache: true,
      version: this.cache.version,
      lastUpdate: this.cache.lastUpdate,
      totalBooks: this.cache.stats.totalBooks,
      totalGenres: this.cache.stats.totalGenres,
      booksByGenre: this.cache.stats.booksByGenre,
      lastScrape: this.cache.stats.lastScrape
    };
  }

  /**
   * Update last scrape time for a genre
   * @param {string} genre - Genre key
   */
  updateScrapeTime(genre) {
    if (!this.cache) return;
    this.cache.stats.lastScrape[genre] = new Date().toISOString();
    this.scheduleSave();
  }

  /**
   * Schedule a debounced save to disk
   */
  scheduleSave() {
    if (this.saveTimeout) {
      return;
    }

    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      await this.save();
    }, this.saveDebounceMs);
  }

  /**
   * Save cache to disk with atomic write
   */
  async save() {
    if (!this.cache) {
      console.warn('[MasterCache] No cache to save');
      return;
    }

    try {
      const tempPath = this.cachePath + '.tmp';
      const jsonData = JSON.stringify(this.cache, null, 2);

      // Write to temp file
      await fs.writeFile(tempPath, jsonData, 'utf8');

      // Atomic rename
      await fs.rename(tempPath, this.cachePath);

      console.log(`[MasterCache] Saved ${this.cache.stats.totalBooks} books to ${this.cachePath}`);
    } catch (error) {
      console.error('[MasterCache] Error saving cache:', error.message);
      throw error;
    }
  }

  /**
   * Clear the entire cache
   */
  async clear() {
    this.cache = this._createEmptyCache();
    await this.save();
    console.log('[MasterCache] Cache cleared');
  }

  /**
   * Get all genres in the cache
   * @returns {Array<string>} Array of genre keys
   */
  getGenres() {
    if (!this.cache) return [];
    return Object.keys(this.cache.genreIndex);
  }

  /**
   * Get books count by genre
   * @returns {Object} Object with genre keys and counts
   */
  getBooksCountByGenre() {
    if (!this.cache) return {};

    const counts = {};
    for (const [genre, isbns] of Object.entries(this.cache.genreIndex)) {
      counts[genre] = isbns.length;
    }
    return counts;
  }
}

module.exports = new MasterBookCache();
