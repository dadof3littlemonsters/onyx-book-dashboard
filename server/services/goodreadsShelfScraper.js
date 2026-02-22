const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Genre sources configuration
 * Maps genre keys to their Goodreads sources (shelves or lists)
 */
const GENRE_SOURCES = {
  romantasy: { type: 'shelf', name: 'romantasy', initialCount: 150, refreshCount: 50 },
  fantasy: { type: 'shelf', name: 'fantasy', initialCount: 200, refreshCount: 50 },
  scifi: { type: 'shelf', name: 'science-fiction', initialCount: 200, refreshCount: 50 },
  dark_fantasy: { type: 'shelf', name: 'grimdark', initialCount: 150, refreshCount: 50 },
  cozy: { type: 'shelf', name: 'cozy-fantasy', initialCount: 150, refreshCount: 50 },
  action_adventure: { type: 'shelf', name: 'action-adventure', initialCount: 150, refreshCount: 50 },
  booktok_trending: { type: 'shelf', name: 'booktok', initialCount: 150, refreshCount: 50 },
  popular: { type: 'shelf', name: 'popular', initialCount: 150, refreshCount: 50 },
  new_releases: { type: 'shelf', name: 'new-releases', initialCount: 150, refreshCount: 50 },
  hidden_gems: { type: 'shelf', name: 'hidden-gems', initialCount: 150, refreshCount: 50 },
  enemies_to_lovers: { type: 'shelf', name: 'enemies-to-lovers', initialCount: 150, refreshCount: 50 },
  dragons: { type: 'list', id: '583.Dragons', initialCount: 150, refreshCount: 50 },
  fairy_tale_retellings: { type: 'shelf', name: 'fairy-tale-retellings', initialCount: 150, refreshCount: 50 },
  post_apocalyptic: { type: 'shelf', name: 'post-apocalyptic', initialCount: 150, refreshCount: 50 },
};

class GoodreadsShelfScraper {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.delayMs = 2000; // Rate limiting between page requests
    this.requestTimeout = 15000;
    this.maxRetries = 3;
  }

  /**
   * Scrape books from a Goodreads shelf
   * @param {string} shelfName - The shelf name (e.g., 'romantasy', 'fantasy')
   * @param {number} count - Number of books to scrape
   * @returns {Promise<Array>} Array of book objects
   */
  async scrapeShelf(shelfName, count = 100) {
    const books = [];
    const booksPerPage = 50;
    const pagesNeeded = Math.ceil(count / booksPerPage);

    console.log(`[GoodreadsScraper] Starting shelf scrape: "${shelfName}" (${count} books, ${pagesNeeded} pages)`);

    for (let page = 1; page <= pagesNeeded; page++) {
      const url = `https://www.goodreads.com/shelf/show/${shelfName}?page=${page}`;
      console.log(`[GoodreadsScraper] Fetching shelf page ${page}/${pagesNeeded}: ${url}`);

      const pageBooks = await this._fetchAndParsePage(url, 'shelf');
      books.push(...pageBooks);

      if (pageBooks.length === 0) {
        console.log(`[GoodreadsScraper] No books found on page ${page}, stopping`);
        break;
      }

      // Rate limiting between pages
      if (page < pagesNeeded) {
        await this._delay(this.delayMs);
      }
    }

    console.log(`[GoodreadsScraper] Shelf scrape complete: "${shelfName}" - ${books.length} books`);
    return books.slice(0, count);
  }

  /**
   * Scrape books from a Goodreads list
   * @param {string} listId - The list ID (e.g., '583.Dragons')
   * @param {number} count - Number of books to scrape
   * @returns {Promise<Array>} Array of book objects
   */
  async scrapeList(listId, count = 100) {
    const books = [];
    const booksPerPage = 100;
    const pagesNeeded = Math.ceil(count / booksPerPage);

    console.log(`[GoodreadsScraper] Starting list scrape: "${listId}" (${count} books, ${pagesNeeded} pages)`);

    for (let page = 1; page <= pagesNeeded; page++) {
      const url = `https://www.goodreads.com/list/show/${listId}?page=${page}`;
      console.log(`[GoodreadsScraper] Fetching list page ${page}/${pagesNeeded}: ${url}`);

      const pageBooks = await this._fetchAndParsePage(url, 'list');
      books.push(...pageBooks);

      if (pageBooks.length === 0) {
        console.log(`[GoodreadsScraper] No books found on page ${page}, stopping`);
        break;
      }

      // Rate limiting between pages
      if (page < pagesNeeded) {
        await this._delay(this.delayMs);
      }
    }

    console.log(`[GoodreadsScraper] List scrape complete: "${listId}" - ${books.length} books`);
    return books.slice(0, count);
  }

  /**
   * Fetch and parse a Goodreads page
   * @param {string} url - URL to fetch
   * @param {string} type - 'shelf' or 'list'
   * @returns {Promise<Array>} Array of book objects
   */
  async _fetchAndParsePage(url, type) {
    let retryCount = 0;
    let lastError = null;

    while (retryCount < this.maxRetries) {
      try {
        const html = await this._fetchPage(url);
        return this._parsePage(html, type);
      } catch (error) {
        lastError = error;
        retryCount++;
        console.warn(`[GoodreadsScraper] Request failed (attempt ${retryCount}/${this.maxRetries}): ${error.message}`);

        if (retryCount < this.maxRetries) {
          const backoffDelay = this.delayMs * retryCount;
          console.log(`[GoodreadsScraper] Retrying in ${backoffDelay}ms...`);
          await this._delay(backoffDelay);
        }
      }
    }

    console.error(`[GoodreadsScraper] All retries exhausted for ${url}: ${lastError?.message}`);
    return [];
  }

  /**
   * Parse HTML page to extract book information
   * @param {string} html - HTML content
   * @param {string} type - 'shelf' or 'list'
   * @returns {Array} Array of book objects
   */
  _parsePage(html, type) {
    const $ = cheerio.load(html);
    const books = [];

    if (type === 'shelf') {
      // Shelf page parsing
      $('.elementList').each((i, elem) => {
        try {
          const $elem = $(elem);
          const $bookLink = $elem.find('.bookTitle').first();
          const $authorLink = $elem.find('.authorName').first();
          const $img = $elem.find('img').first();

          const title = $bookLink.text().trim();
          const author = $authorLink.text().trim();
          const goodreadsCoverUrl = $img.attr('src') || null;

          if (title && author) {
            books.push({
              title,
              author,
              goodreadsCoverUrl
            });
          }
        } catch (error) {
          console.warn('[GoodreadsScraper] Error parsing shelf item:', error.message);
        }
      });
    } else if (type === 'list') {
      // List page parsing
      $('tr[data-resource-type="Book"]').each((i, elem) => {
        try {
          const $elem = $(elem);
          const $bookLink = $elem.find('a.bookTitle').first();
          const $authorLink = $elem.find('a.authorName').first();
          const $img = $elem.find('img').first();

          const title = $bookLink.text().trim();
          const author = $authorLink.text().trim();
          const goodreadsCoverUrl = $img.attr('src') || null;

          if (title && author) {
            books.push({
              title,
              author,
              goodreadsCoverUrl
            });
          }
        } catch (error) {
          console.warn('[GoodreadsScraper] Error parsing list item:', error.message);
        }
      });
    }

    return books;
  }

  /**
   * Fetch a page from Goodreads
   * @param {string} url - URL to fetch
   * @returns {Promise<string>} HTML content
   */
  async _fetchPage(url) {
    const response = await axios({
      url,
      method: 'GET',
      timeout: this.requestTimeout,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    },
    maxRedirects: 5
    });

    return response.data;
  }

  /**
   * Delay helper for rate limiting
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the genre sources configuration
   * @returns {Object} GENRE_SOURCES configuration
   */
  getGenreSources() {
    return GENRE_SOURCES;
  }

  /**
   * Scrape books for a specific genre key
   * @param {string} genreKey - The genre key from GENRE_SOURCES
   * @param {number} count - Number of books to scrape
   * @returns {Promise<Array>} Array of book objects
   */
  async scrapeGenre(genreKey, count) {
    const source = GENRE_SOURCES[genreKey];
    if (!source) {
      throw new Error(`Unknown genre key: ${genreKey}`);
    }

    if (source.type === 'list') {
      return await this.scrapeList(source.id, count);
    } else {
      return await this.scrapeShelf(source.name, count);
    }
  }
}

module.exports = new GoodreadsShelfScraper();
