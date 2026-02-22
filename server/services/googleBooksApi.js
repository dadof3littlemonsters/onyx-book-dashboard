require('dotenv').config();
const axios = require('axios');

class GoogleBooksApi {
  constructor() {
    // Debug: Show raw environment variables BEFORE filtering
    console.log('[GoogleBooks] DEBUG: Raw array before filter:');
    console.log('[GoogleBooks]   KEY_1:', process.env.GOOGLE_BOOKS_API_KEY);
    console.log('[GoogleBooks]   KEY_2:', process.env.GOOGLE_BOOKS_API_KEY_2);
    console.log('[GoogleBooks]   KEY_3:', process.env.GOOGLE_BOOKS_API_KEY_3);
    console.log('[GoogleBooks]   KEY_4:', process.env.GOOGLE_BOOKS_API_KEY_4);
    console.log('[GoogleBooks]   KEY_5:', process.env.GOOGLE_BOOKS_API_KEY_5);

    // Support multiple API keys with automatic failover
    this.apiKeys = [
      process.env.GOOGLE_BOOKS_API_KEY,
      process.env.GOOGLE_BOOKS_API_KEY_2,
      process.env.GOOGLE_BOOKS_API_KEY_3,
      process.env.GOOGLE_BOOKS_API_KEY_4,
      process.env.GOOGLE_BOOKS_API_KEY_5
    ].filter(Boolean); // Remove undefined keys

    this.currentKeyIndex = 0;
    this.apiKey = this.apiKeys[0];

    this.baseUrl = 'https://www.googleapis.com/books/v1';
    this.requestTimeout = 15000;

    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.minRequestDelay = 600;
    this.lastRequestCompleteTime = 0;
    this.pausedUntil = 0; // Timestamp when pause expires

    this.maxRetries = 3;
    this.initialRetryDelay = 1000;

    // Debug: Show which keys were loaded AFTER filtering
    console.log(`[GoogleBooks] Initialized with ${this.apiKeys.length} API key(s)`);
    this.apiKeys.forEach((key, index) => {
      const preview = key ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : 'undefined';
      console.log(`[GoogleBooks]   Key #${index + 1}: ${preview}`);
    });
  }

  // --- Queue Management ---

  async enqueueRequest(fn) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    if (this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const { fn, resolve, reject } = this.requestQueue[0]; // Peek

      // Enforce rate limit delay relative to LAST COMPLETE request
      const now = Date.now();
      const timeSinceLast = now - this.lastRequestCompleteTime;

      if (timeSinceLast < this.minRequestDelay) {
        const waitMs = this.minRequestDelay - timeSinceLast;
        await this.sleep(waitMs);
      }

      // Execute
      try {
        // Shift ONLY when we are about to execute (or after?) 
        // Better to shift now so if it crashes we don't loop forever on a bad task
        this.requestQueue.shift();

        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.lastRequestCompleteTime = Date.now();
      }
    }

    this.isProcessingQueue = false;
  }

  // --- API Methods ---

  rotateApiKey(allowWrap = false) {
    console.log(`[GoogleBooks] rotateApiKey called: currentKeyIndex=${this.currentKeyIndex}, allowWrap=${allowWrap}, totalKeys=${this.apiKeys.length}`);

    if (this.apiKeys.length > 1) {
      const nextIndex = this.currentKeyIndex + 1;

      if (nextIndex >= this.apiKeys.length) {
        if (!allowWrap) {
          console.log(`[GoogleBooks] No more keys available (nextIndex ${nextIndex} >= ${this.apiKeys.length}, allowWrap=false)`);
          return false; // No more keys to try without wrapping
        }
        console.log(`[GoogleBooks] Wrapping to first key`);
        this.currentKeyIndex = 0;
      } else {
        this.currentKeyIndex = nextIndex;
      }
      this.apiKey = this.apiKeys[this.currentKeyIndex];
      const keyPreview = this.apiKey ? `${this.apiKey.substring(0, 8)}...${this.apiKey.substring(this.apiKey.length - 4)}` : 'undefined';
      console.log(`[GoogleBooks] Rotated to API key #${this.currentKeyIndex + 1}: ${keyPreview}`);
      return true;
    }
    console.log(`[GoogleBooks] Cannot rotate: only ${this.apiKeys.length} key(s) available`);
    return false;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // NOTE: Private usage mostly, but called by public methods
  async _executeRequest(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('GOOGLE_BOOKS_API_KEY not configured');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const baseParams = params;

    let lastError;
    for (let retry = 0; retry <= this.maxRetries; retry++) {
      try {
        const keyPreview = this.apiKey ? `${this.apiKey.substring(0, 8)}...${this.apiKey.substring(this.apiKey.length - 4)}` : 'undefined';
        console.log(`[GoogleBooks] Making request with key #${this.currentKeyIndex + 1} (${keyPreview}), retry=${retry}`);

        const queryParams = new URLSearchParams({
          key: this.apiKey,
          ...baseParams
        });

        const response = await axios({
          url: `${url}?${queryParams}`,
          method: 'GET',
          timeout: this.requestTimeout,
          headers: {
            'User-Agent': 'OnyxBookDiscovery/1.0'
          }
        });

        console.log(`[GoogleBooks] Request succeeded with key #${this.currentKeyIndex + 1}`);
        return response.data;

      } catch (error) {
        lastError = error;

        // Rate Limit Handling
        if (error.response && error.response.status === 429) {
          console.log(`[GoogleBooks] Rate limited (429) on key #${this.currentKeyIndex + 1}`);

          if (this.rotateApiKey(false)) {
            console.log(`[GoogleBooks] Successfully rotated, retrying immediately...`);
            retry--;
            continue;
          }

          // All keys exhausted
          console.log(`[GoogleBooks] All keys exhausted.`);
          const retryDelay = this.initialRetryDelay * Math.pow(2, retry);
          console.log(`[GoogleBooks] Waiting ${retryDelay}ms before retry...`);
          await this.sleep(retryDelay);

          // Wrap keys for next attempt
          this.rotateApiKey(true);
          continue;
        }

        if (retry === this.maxRetries) break;

        const retryDelay = 1000 * Math.pow(2, retry);
        console.log(`[GoogleBooks] Request failed (${error.message}), retry ${retry + 1}/${this.maxRetries} in ${retryDelay}ms...`);
        await this.sleep(retryDelay);
      }
    }

    throw new Error(`Google Books API error after ${this.maxRetries + 1} retries: ${lastError.message}`);
  }

  // Public wrapper that queues the request
  async makeRequest(endpoint, params = {}) {
    if (Date.now() < this.pausedUntil) {
      const remaining = Math.ceil((this.pausedUntil - Date.now()) / 1000 / 60);
      // Fail silently-ish (return empty/null) or throw? 
      // Throwing preserves the "we didn't get data" semantic.
      console.log(`[GoogleBooks] Request skipped (API Paused for ${remaining}m)`);
      return { items: [] }; // Return empty result to degrade gracefully
    }
    return this.enqueueRequest(() => this._executeRequest(endpoint, params));
  }

  async fetchBooksBySubject(subject, maxResults = 40, orderBy = 'relevance') {
    const allBooks = [];
    let totalFetched = 0;
    let startIndex = 0;
    const pageSize = 40;

    try {
      // NOTE: We do not queue the entire batch loop. We queue individual page fetches.
      // This allows other high-priority requests to potentially interleave if we wanted, 
      // but for now the FIFO queue effectively serializes this whole operation anyway.

      const totalPages = Math.ceil(maxResults / pageSize);
      while (totalFetched < maxResults) {
        const params = {
          q: subject,
          maxResults: Math.min(pageSize, maxResults - totalFetched),
          startIndex,
          orderBy: orderBy,
          printType: 'books',
          langRestrict: 'en'
        };

        const pageNum = Math.floor(startIndex / pageSize) + 1;
        console.log(`[GoogleBooks] Fetching ${subject}... (page ${pageNum}/${totalPages})`);

        // This call is now Queued!
        const data = await this.makeRequest('/volumes', params);

        console.log(`[GoogleBooks] Received ${data.items?.length || 0} items`);

        if (!data.items || data.items.length === 0) {
          console.log(`[GoogleBooks] No items returned, breaking`);
          break;
        }

        const processedBooks = data.items.map(item => this.processVolume(item));
        const filteredBooks = processedBooks.filter(book => book.title);

        allBooks.push(...filteredBooks);
        totalFetched += filteredBooks.length;
        startIndex += pageSize;

        if (!data.items || data.items.length < pageSize) break;
        // No explicit sleep needed here anymore, the Queue handles spacing
      }

      const deduplicated = this.deduplicateByIsbn13(allBooks);
      const result = deduplicated.slice(0, maxResults);
      console.log(`[GoogleBooks] fetchBooksBySubject "${subject}" returning ${result.length} books`);
      return result;

    } catch (error) {
      console.error(`Error fetching books for subject "${subject}":`, error.message);
      return [];
    }
  }

  processVolume(volume) {
    const volumeInfo = volume.volumeInfo || {};
    const industryIdentifiers = volumeInfo.industryIdentifiers || [];

    let isbn13 = null;
    for (const id of industryIdentifiers) {
      const type = (id.type || '').toUpperCase();
      if (type === 'ISBN_13' || type === 'ISBN13') {
        isbn13 = id.identifier.replace(/[-\s]/g, '');
        break;
      }
    }

    if (!isbn13) {
      for (const id of industryIdentifiers) {
        const type = (id.type || '').toUpperCase();
        if (type === 'ISBN_10' || type === 'ISBN10') {
          isbn13 = this.convertIsbn10To13(id.identifier);
          break;
        }
      }
    }

    const authors = Array.isArray(volumeInfo.authors) ? volumeInfo.authors : [];

    let thumbnail = null;
    if (volumeInfo.imageLinks) {
      thumbnail = volumeInfo.imageLinks.thumbnail ||
        volumeInfo.imageLinks.smallThumbnail ||
        volumeInfo.imageLinks.medium;
      if (thumbnail && thumbnail.startsWith('http://')) {
        thumbnail = thumbnail.replace('http://', 'https://');
      }
    }

    return {
      title: volumeInfo.title || '',
      authors,
      isbn13,
      thumbnail,
      publishedDate: volumeInfo.publishedDate || '',
      averageRating: volumeInfo.averageRating || 0,
      ratingsCount: volumeInfo.ratingsCount || 0,
      pageCount: volumeInfo.pageCount || 0,
      publisher: volumeInfo.publisher || '',
      description: volumeInfo.description || '',
      googleBooksId: volume.id
    };
  }

  convertIsbn10To13(isbn10) {
    if (!isbn10) return null;
    const cleanIsbn = isbn10.replace(/[-\s]/g, '');
    if (cleanIsbn.length !== 10) return null;
    const prefix = '978';
    const isbn12 = prefix + cleanIsbn.substring(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(isbn12.charAt(i));
      sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return isbn12 + checkDigit;
  }

  deduplicateByIsbn13(books) {
    console.log(`[GoogleBooks] Deduplicating ${books.length} books`);
    const isbnMap = new Map();
    const idMap = new Map();
    let duplicates = 0;
    let booksWithoutIsbn = 0;

    books.forEach(book => {
      if (book.isbn13) {
        const existing = isbnMap.get(book.isbn13);
        if (!existing) {
          isbnMap.set(book.isbn13, book);
          return;
        }
        duplicates++;
        // Keep better metadata
        const existingRating = existing.averageRating || 0;
        const newRating = book.averageRating || 0;
        if (newRating > existingRating) {
          isbnMap.set(book.isbn13, book);
        }
      } else {
        booksWithoutIsbn++;
        const id = book.googleBooksId || `${book.title}-${book.authors?.join(',')}`;
        if (id && !idMap.has(id)) {
          idMap.set(id, book);
        } else {
          duplicates++;
        }
      }
    });

    // Secondary dedup pass for books without an ISBN13:
    // Normalise title (lowercase, strip punctuation, strip subtitles) + first author,
    // then deduplicate on that composite key to prevent the same book appearing
    // multiple times under different editions or googleBooksIds.
    const normalMap = new Map();
    for (const book of idMap.values()) {
      const rawTitle = book.title || '';
      const normalTitle = rawTitle
        .toLowerCase()
        .replace(/\s*[:|-]\s*.*/u, '')   // strip subtitle after : | -
        .replace(/[^\w\s]/gu, '')         // strip punctuation
        .replace(/\s+/g, ' ')
        .trim();
      const firstAuthor = (Array.isArray(book.authors) ? book.authors[0] : '')
        .toLowerCase()
        .replace(/[^\w\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      const normalKey = `${normalTitle}|${firstAuthor}`;
      if (!normalMap.has(normalKey)) {
        normalMap.set(normalKey, book);
      } else {
        duplicates++;
      }
    }

    const result = Array.from(isbnMap.values()).concat(Array.from(normalMap.values()));
    console.log(`[GoogleBooks] Deduplication: ${books.length} → ${result.length} unique (${duplicates} duplicates removed, ${booksWithoutIsbn} had no ISBN13)`);
    return result;
  }

  parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    const yearMatch = dateStr.match(/\d{4}/);
    if (!yearMatch) return new Date(0);
    const year = parseInt(yearMatch[0]);
    const monthMatch = dateStr.match(/\d{4}-(\d{1,2})/);
    const month = monthMatch ? parseInt(monthMatch[1]) - 1 : 0;
    const dayMatch = dateStr.match(/\d{4}-\d{1,2}-(\d{1,2})/);
    const day = dayMatch ? parseInt(dayMatch[1]) : 1;
    return new Date(year, month, day);
  }

  async searchBooks(query, maxResults = 40) {
    try {
      const params = {
        q: query,
        maxResults,
        orderBy: 'relevance',
        printType: 'books',
        langRestrict: 'en'
      };

      console.log(`[GoogleBooks] Searching for "${query}" (Queued)`);
      // This is now Queued!
      const data = await this.makeRequest('/volumes', params);

      if (!data.items) return [];

      const books = data.items.map(item => this.processVolume(item));
      const filteredBooks = books.filter(book => book.title);
      const deduplicated = this.deduplicateByIsbn13(filteredBooks);
      const result = deduplicated.slice(0, maxResults);

      console.log(`[GoogleBooks] Search "${query}" returning ${result.length} books`);
      return result;
    } catch (error) {
      console.error(`Error searching books for "${query}":`, error.message);
      return [];
    }
  }
}

module.exports = new GoogleBooksApi();
