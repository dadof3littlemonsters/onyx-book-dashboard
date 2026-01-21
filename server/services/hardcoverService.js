/**
 * Hardcover API Service
 * Fetches book ratings from Hardcover.app GraphQL API
 */

const axios = require('axios');

class HardcoverService {
    constructor() {
        this.token = process.env.HARDCOVER_API_TOKEN;
        this.apiUrl = 'https://api.hardcover.app/v1/graphql';
        this.cache = new Map();
        this.cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
        this.requestTimeout = 5000;
    }

    async getRating(isbn13, title = null, author = null) {
        if (!this.token) {
            return null;
        }

        // Check cache first
        const cacheKey = `rating:${isbn13 || title}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.rating;
        }

        try {
            let rating = null;

            // Try ISBN search first
            if (isbn13) {
                rating = await this.searchByIsbn(isbn13);
            }

            // Fall back to title search
            if (!rating && title) {
                rating = await this.searchByTitle(title, author);
            }

            // Cache the result (even if null to avoid repeated failed requests)
            this.cache.set(cacheKey, { rating, timestamp: Date.now() });
            return rating;

        } catch (error) {
            console.error(`[HardcoverService] Error fetching rating:`, error.message);
            return null;
        }
    }

    async searchByIsbn(isbn13) {
        const query = `
      query SearchBooks($query: String!) {
        search(query: $query) {
          results {
            hits {
              document {
                ... on Book {
                  rating
                  ratings_count
                }
              }
            }
          }
        }
      }
    `;

        const response = await axios({
            url: this.apiUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json'
            },
            data: {
                query,
                variables: { query: `isbn:${isbn13}` }
            },
            timeout: this.requestTimeout
        });

        const hits = response.data?.data?.search?.results?.hits;
        if (hits && hits.length > 0) {
            const book = hits[0].document;
            if (book?.rating && book?.ratings_count > 5) {
                // Only return rating if we have enough ratings for confidence
                return parseFloat(book.rating.toFixed(1));
            }
        }

        return null;
    }

    async searchByTitle(title, author = null) {
        const searchQuery = author ? `${title} ${author}` : title;

        const query = `
      query SearchBooks($query: String!) {
        search(query: $query) {
          results {
            hits {
              document {
                ... on Book {
                  title
                  rating
                  ratings_count
                  contributions {
                    author {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

        const response = await axios({
            url: this.apiUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json'
            },
            data: {
                query,
                variables: { query: searchQuery }
            },
            timeout: this.requestTimeout
        });

        const hits = response.data?.data?.search?.results?.hits;
        if (hits && hits.length > 0) {
            // Find the best match
            for (const hit of hits) {
                const book = hit.document;
                if (book?.rating && book?.ratings_count > 5) {
                    // Basic title match check
                    if (book.title && book.title.toLowerCase().includes(title.toLowerCase().slice(0, 20))) {
                        return parseFloat(book.rating.toFixed(1));
                    }
                }
            }
        }

        return null;
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = new HardcoverService();
