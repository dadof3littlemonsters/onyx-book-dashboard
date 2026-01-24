const axios = require('axios');

class CoverResolver {
  constructor() {
    this.cache = new Map();
    this.cacheTtl = 60 * 60 * 1000;
    this.requestTimeout = 5000;
    this.hardcoverToken = process.env.HARDCOVER_TOKEN;
  }

  async getCoverUrl(isbn13, fallbackUrl = null, title = null, author = null) {
    if (!isbn13) {
      return fallbackUrl || this.getPlaceholderUrl();
    }

    const cacheKey = `cover:${isbn13}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.url;
    }

    try {
      const coverUrl = await this.tryMultipleSources(isbn13, title, author);

      if (coverUrl) {
        this.cache.set(cacheKey, {
          url: coverUrl,
          timestamp: Date.now()
        });
        return coverUrl;
      }
    } catch (error) {
      console.error(`[CoverResolver] Error resolving cover for ISBN ${isbn13}:`, error.message);
    }

    // Always return a valid URL (placeholder or real cover)
    return fallbackUrl || this.getPlaceholderUrl();
  }

  async tryMultipleSources(isbn13, title = null, author = null) {
    const sources = [
      () => this.tryHardcoverApi(isbn13),
      () => this.tryOpenLibrary(isbn13),
      () => this.tryGoogleBooks(isbn13),
      () => this.tryAmazon(isbn13)
    ];

    for (const source of sources) {
      try {
        const url = await source();
        if (url && url !== this.getPlaceholderUrl()) {
          console.log(`[CoverResolver] Found cover for ${isbn13} via ${source.name}`);
          return url;
        }
      } catch (error) {
        // Silently continue to next source
      }
    }

    // Fallback to title/author search if ISBN lookup fails
    if (title && author) {
      try {
        console.log(`[CoverResolver] ISBN lookup failed for ${isbn13}, trying title/author search`);
        const titleUrl = await this.tryTitleSearch(title, author);
        if (titleUrl) {
          console.log(`[CoverResolver] Found cover for ${isbn13} via title/author search`);
          return titleUrl;
        }
      } catch (error) {
        console.log(`[CoverResolver] Title search also failed for ${isbn13}`);
      }
    }

    return null;
  }

  async tryHardcoverApi(isbn13) {
    if (!this.hardcoverToken) {
      return null;
    }

    try {
      const query = `
        query SearchBooks($query: String!) {
          search(query: $query) {
            results {
              hits {
                document {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      `;

      const response = await axios({
        url: 'https://api.hardcover.app/v1/graphql',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hardcoverToken}`,
          'Accept': 'application/json'
        },
        data: {
          query,
          variables: {
            query: `isbn:${isbn13}`
          }
        },
        timeout: this.requestTimeout
      });

      const hits = response.data?.data?.search?.results?.hits;
      if (hits && hits.length > 0) {
        const coverUrl = hits[0]?.document?.image?.url;
        if (coverUrl) {
          return `/api/proxy-image?url=${encodeURIComponent(coverUrl)}`;
        }
      }
    } catch (error) {
      // Hardcover API may fail - that's ok
    }

    return null;
  }

  async tryOpenLibrary(isbn13) {
    try {
      const url = `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`;

      // Use GET with responseType to actually validate the image exists
      const response = await axios.get(url, {
        timeout: this.requestTimeout,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 // Only accept 200
      });

      // Check if we got actual image data (not an error page)
      // Relaxed validation: accept any image content type, not just JPEG
      // Reduced size threshold from 1000 to 500 bytes to accept more covers
      const contentType = response.headers['content-type'];
      if (contentType && (contentType.includes('image/') || contentType.includes('jpeg') || contentType.includes('png')) && response.data.length > 500) {
        // Valid image found
        return url;
      }
    } catch (error) {
      // Open Library may not have the cover or returned an error
      // This is expected - silently continue to next source
    }

    return null;
  }

  async tryGoogleBooks(isbn13) {
    try {
      const googleBooksApi = require('./googleBooksApi');

      // Use the queued API instead of direct axios call
      const results = await googleBooksApi.searchBooks(`isbn:${isbn13}`, 1);

      if (results && results.length > 0) {
        const thumbnail = results[0].thumbnail;
        if (thumbnail) {
          return thumbnail.replace('http://', 'https://');
        }
      }
    } catch (error) {
      // Google Books may fail
    }

    return null;
  }

  async tryAmazon(isbn13) {
    try {
      const url = `https://images-na.ssl-images-amazon.com/images/P/${isbn13}.01.L.jpg`;

      const response = await axios.head(url, {
        timeout: this.requestTimeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.status === 200) {
        return url;
      }
    } catch (error) {
      // Amazon may block or not have the cover
    }

    return null;
  }

  getPlaceholderUrl() {
    // Return a proper placeholder URL instead of null
    // Using via.placeholder for reliable fallback when all sources fail
    return 'https://via.placeholder.com/200x300/1a1a1a/888888?text=No+Cover';
  }

  // Search by title/author when ISBN lookup fails
  async tryTitleSearch(title, author) {
    if (!title) return null;

    try {
      const googleBooksApi = require('./googleBooksApi');
      const query = author ? `intitle:"${title}"+inauthor:"${author}"` : `intitle:"${title}"`;

      const results = await googleBooksApi.searchBooks(query, 3);

      if (results && results.length > 0) {
        // Find the best match
        for (const result of results) {
          if (result.thumbnail) {
            return result.thumbnail.replace('http://', 'https://');
          }
        }
      }
    } catch (error) {
      // Title search may fail
    }

    return null;
  }

  // Get cover with optional title fallback
  async getCoverWithTitleFallback(isbn13, title, author, fallbackUrl = null) {
    // First try ISBN-based lookup
    const isbnCover = await this.getCoverUrl(isbn13, null);
    if (isbnCover) {
      return isbnCover;
    }

    // ISBN failed, try title search
    const titleCover = await this.tryTitleSearch(title, author);
    if (titleCover) {
      return titleCover;
    }

    // All failed, return fallback or null (frontend will show initials)
    return fallbackUrl || null;
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key: key.replace('cover:', ''),
        age: Date.now() - value.timestamp,
        url: value.url
      }))
    };
  }
}

module.exports = new CoverResolver();