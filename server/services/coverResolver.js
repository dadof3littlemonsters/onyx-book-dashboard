const axios = require('axios');

class CoverResolver {
  constructor() {
    this.cache = new Map();
    this.cacheTtl = 60 * 60 * 1000;
    this.requestTimeout = 5000;
    this.hardcoverToken = process.env.HARDCOVER_TOKEN;
  }

  async getCoverUrl(isbn13, fallbackUrl = null) {
    if (!isbn13) {
      return fallbackUrl || this.getPlaceholderUrl();
    }

    const cacheKey = `cover:${isbn13}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.url;
    }

    try {
      const coverUrl = await this.tryMultipleSources(isbn13);

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

    return fallbackUrl || this.getPlaceholderUrl();
  }

  async tryMultipleSources(isbn13) {
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

      const response = await axios.head(url, { timeout: this.requestTimeout });

      if (response.status === 200) {
        return url;
      }
    } catch (error) {
      // Open Library may not have the cover
    }

    return null;
  }

  async tryGoogleBooks(isbn13) {
    try {
      const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
      if (!apiKey) {
        return null;
      }

      const response = await axios({
        url: `https://www.googleapis.com/books/v1/volumes`,
        params: {
          q: `isbn:${isbn13}`,
          key: apiKey,
          maxResults: 1
        },
        timeout: this.requestTimeout
      });

      const item = response.data?.items?.[0];
      if (item) {
        const thumbnail = item.volumeInfo?.imageLinks?.thumbnail ||
                         item.volumeInfo?.imageLinks?.smallThumbnail;

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
    const colors = ['1a1a1a', '2d3748', '4a5568', '718096'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return `https://via.placeholder.com/200x300/${color}/ffffff?text=No+Cover`;
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