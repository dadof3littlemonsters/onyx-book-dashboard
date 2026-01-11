const axios = require('axios');

class GoogleBooksApi {
  constructor() {
    // Support multiple API keys with automatic failover
    this.apiKeys = [
      process.env.GOOGLE_BOOKS_API_KEY,
      process.env.GOOGLE_BOOKS_API_KEY_2
    ].filter(Boolean); // Remove undefined keys
    
    this.currentKeyIndex = 0;
    this.apiKey = this.apiKeys[0];
    
    this.baseUrl = 'https://www.googleapis.com/books/v1';
    this.requestTimeout = 15000;
    this.minRequestDelay = 500;
    this.lastRequestTime = 0;
    this.maxRetries = 3;
    this.initialRetryDelay = 1000;
    
    console.log(`[GoogleBooks] Initialized with ${this.apiKeys.length} API key(s)`);
  }

  rotateApiKey() {
    if (this.apiKeys.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      this.apiKey = this.apiKeys[this.currentKeyIndex];
      console.log(`[GoogleBooks] Rotated to API key #${this.currentKeyIndex + 1}`);
      return true;
    }
    return false;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestDelay) {
      const waitTime = this.minRequestDelay - timeSinceLastRequest;
      console.log(`[GoogleBooks] Rate limit: waiting ${waitTime}ms...`);
      await this.sleep(waitTime);
    }
  }

  async makeRequest(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('GOOGLE_BOOKS_API_KEY not configured');
    }

    await this.waitForRateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    const queryParams = new URLSearchParams({
      key: this.apiKey,
      ...params
    });

    let lastError;
    for (let retry = 0; retry <= this.maxRetries; retry++) {
      try {
        const response = await axios({
          url: `${url}?${queryParams}`,
          method: 'GET',
          timeout: this.requestTimeout,
          headers: {
            'User-Agent': 'OnyxBookDiscovery/1.0'
          }
        });

        this.lastRequestTime = Date.now();
        return response.data;
      } catch (error) {
        lastError = error;
        this.lastRequestTime = Date.now();

        if (error.response && error.response.status === 429) {
          console.log(`[GoogleBooks] Rate limited (429) on key #${this.currentKeyIndex + 1}`);
          if (this.rotateApiKey()) {
            console.log(`[GoogleBooks] Retrying immediately with new key...`);
            retry--; // Don't count this as a retry
            continue;
          }
          const retryDelay = this.initialRetryDelay * Math.pow(2, retry);
          console.log(`[GoogleBooks] No more keys available, retry ${retry + 1}/${this.maxRetries} in ${retryDelay}ms...`);
          await this.sleep(retryDelay);
          continue;
        }

        if (retry === this.maxRetries) {
          break;
        }

        const retryDelay = 1000 * Math.pow(2, retry);
        console.log(`[GoogleBooks] Request failed (${error.message}), retry ${retry + 1}/${this.maxRetries} in ${retryDelay}ms...`);
        await this.sleep(retryDelay);
      }
    }

    console.error(`[Google Books API Error] ${endpoint}:`, lastError.message);
    if (lastError.response) {
      console.error(`Status: ${lastError.response.status}, Data:`, lastError.response.data);
    }
    throw new Error(`Google Books API error after ${this.maxRetries + 1} retries: ${lastError.message}`);
  }

  async fetchBooksBySubject(subject, maxResults = 40, orderBy = 'relevance') {
    const allBooks = [];
    let totalFetched = 0;
    let startIndex = 0;
    const pageSize = 40;

    try {
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
        const data = await this.makeRequest('/volumes', params);

        console.log(`[GoogleBooks] Received ${data.items?.length || 0} items`);

        if (!data.items || data.items.length === 0) {
          console.log(`[GoogleBooks] No items returned, breaking`);
          break;
        }

        const processedBooks = data.items
          .map(item => this.processVolume(item));

        console.log(`[GoogleBooks] Processed ${processedBooks.length} books`);

        const filteredBooks = processedBooks.filter(book => book.title);
        console.log(`[GoogleBooks] ${filteredBooks.length} books have title (filtered out ${processedBooks.length - filteredBooks.length} without title)`);

        allBooks.push(...filteredBooks);
        totalFetched += filteredBooks.length;
        startIndex += pageSize;

        if (!data.items || data.items.length < pageSize) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const deduplicated = this.deduplicateByIsbn13(allBooks);
      const result = deduplicated.slice(0, maxResults);
      console.log(`[GoogleBooks] fetchBooksBySubject "${subject}" returning ${result.length} books (requested ${maxResults})`);
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
        // Clean the ISBN (remove hyphens, spaces)
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

    if (!isbn13 && volumeInfo.title) {
      console.log(`[GoogleBooks] No ISBN found for "${volumeInfo.title}" - identifiers:`, industryIdentifiers.map(id => `${id.type}: ${id.identifier}`).join(', '));
    }

    const authors = Array.isArray(volumeInfo.authors) ? volumeInfo.authors : [];
    const publishedDate = volumeInfo.publishedDate || '';
    const averageRating = volumeInfo.averageRating || 0;
    const ratingsCount = volumeInfo.ratingsCount || 0;

    let thumbnail = null;
    if (volumeInfo.imageLinks) {
      thumbnail = volumeInfo.imageLinks.thumbnail ||
                 volumeInfo.imageLinks.smallThumbnail ||
                 volumeInfo.imageLinks.medium;

      // Convert HTTP to HTTPS for mixed content prevention
      if (thumbnail && thumbnail.startsWith('http://')) {
        thumbnail = thumbnail.replace('http://', 'https://');
      }
    }

    return {
      title: volumeInfo.title || '',
      authors,
      isbn13,
      thumbnail,
      publishedDate,
      averageRating,
      ratingsCount,
      pageCount: volumeInfo.pageCount || 0,
      publisher: volumeInfo.publisher || '',
      description: volumeInfo.description || '',
      googleBooksId: volume.id
    };
  }

  convertIsbn10To13(isbn10) {
    if (!isbn10) return null;
    // Remove hyphens and spaces
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
    const idMap = new Map(); // For books without ISBN
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
        const existingRating = existing.averageRating || 0;
        const newRating = book.averageRating || 0;
        const existingDate = this.parseDate(existing.publishedDate);
        const newDate = this.parseDate(book.publishedDate);

        if (newRating > existingRating) {
          isbnMap.set(book.isbn13, book);
        } else if (newRating === existingRating && newDate > existingDate) {
          isbnMap.set(book.isbn13, book);
        }
      } else {
        booksWithoutIsbn++;
        // Use Google Books ID for deduplication when no ISBN
        const id = book.googleBooksId || `${book.title}-${book.authors?.join(',')}`;
        if (id && !idMap.has(id)) {
          idMap.set(id, book);
        } else {
          duplicates++;
        }
      }
    });

    const result = Array.from(isbnMap.values()).concat(Array.from(idMap.values()));
    console.log(`[GoogleBooks] Deduplication: ${result.length} unique books (${isbnMap.size} with ISBN, ${idMap.size} without ISBN), ${duplicates} duplicates, ${booksWithoutIsbn} books without ISBN`);
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

      console.log(`[GoogleBooks] Searching for "${query}"`);
      const data = await this.makeRequest('/volumes', params);

      console.log(`[GoogleBooks] Search received ${data.items?.length || 0} items`);

      if (!data.items) {
        return [];
      }

      const books = data.items
        .map(item => this.processVolume(item));

      console.log(`[GoogleBooks] Search processed ${books.length} books`);

      const filteredBooks = books.filter(book => book.title);
      console.log(`[GoogleBooks] Search: ${filteredBooks.length} books have title (filtered out ${books.length - filteredBooks.length} without title)`);

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