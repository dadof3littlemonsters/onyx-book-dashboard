const fs = require('fs').promises;
const path = require('path');

const bookMetadataCache = require('./services/bookMetadataCache');

class MetadataAggregator {
  constructor() {
    this.cacheBackend = bookMetadataCache;
  }



  async fetchAudnexusMetadata(title, author) {
    try {
      const searchQuery = encodeURIComponent(`${title} ${author}`);
      const response = await fetch(`https://api.audnex.us/books?title=${searchQuery}`);

      if (!response.ok) {
        throw new Error(`Audnexus API error: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.length > 0) {
        const book = data[0];
        return {
          source: 'audnexus',
          title: book.title,
          author: book.authors?.[0]?.name || author,
          narrator: book.narrators?.[0]?.name,
          cover: book.image,
          series: book.seriesPrimary?.name,
          seriesPosition: book.seriesPrimary?.position,
          description: book.description,
          genres: book.genres,
          publishDate: book.publishedDate,
          duration: book.runtimeLengthMin,
          isbn: book.asin
        };
      }
    } catch (error) {
      console.error('Audnexus fetch error:', error.message);
    }
    return null;
  }

  async validateHardcoverToken() {
    try {
      const query = `
        query {
          me {
            id
            username
          }
        }
      `;

      const apiUrl = 'https://api.hardcover.app/v1/graphql';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        console.error(`[FATAL] 404 on URL: ${apiUrl}`);
        console.error(`[FATAL] Hardcover token validation failed: HTTP ${response.status}`);
        return false;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`[FATAL] Hardcover returned HTML instead of JSON. Check URL: ${response.url}`);
        return false;
      }

      const data = await response.json();

      if (data.errors) {
        console.error('[FATAL] Hardcover token validation failed:', data.errors);
        return false;
      }

      if (data.data?.me?.[0]) {
        const username = data.data.me[0].username || data.data.me[0].id || 'Unknown User';
        console.log(`[SUCCESS] Hardcover token validated for user: ${username}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[FATAL] Hardcover token validation error:', error.message);
      return false;
    }
  }

  async fetchHardcoverMetadata(title, author) {
    try {
      const query = `
        query SearchBooks($query: String!) {
          search(query: $query) {
            results
          }
        }
      `;

      const apiUrl = 'https://api.hardcover.app/v1/graphql';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
        },
        body: JSON.stringify({
          query,
          variables: { query: `${title} ${author}` }
        })
      });

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

      if (data.errors) {
        console.error('[FATAL] Hardcover search errors:', data.errors);
        return null;
      }

      if (data.data?.search?.results?.hits?.length > 0) {
        const hit = data.data.search.results.hits[0];
        const book = hit.document;
        return {
          source: 'hardcover',
          title: book.title,
          subtitle: book.subtitle,
          author: book.contributions?.[0]?.author?.name || author,
          cover: book.image?.url ? `/api/proxy-image?url=${encodeURIComponent(book.image.url)}` : null,
          series: null,
          seriesPosition: null,
          description: book.description,
          genres: null,
          publishDate: null,
          pages: book.pages,
          rating: null,
          reviewsCount: null,
          isbn10: null,
          isbn13: null
        };
      }
    } catch (error) {
      console.error('[CRITICAL] Hardcover Rejection:', error.response?.data || error.message);
      console.error('Hardcover fetch error:', error.message);
    }
    return null;
  }

  async fetchOpenLibraryMetadata(title, author) {
    try {
      const searchQuery = encodeURIComponent(`${title} ${author}`);
      const response = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1`);

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.docs && data.docs.length > 0) {
        const book = data.docs[0];
        return {
          source: 'openlibrary',
          title: book.title,
          author: book.author_name?.[0] || author,
          cover: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : null,
          description: book.first_sentence?.[0],
          publishDate: book.first_publish_year,
          pages: book.number_of_pages_median,
          isbn: book.isbn?.[0],
          subjects: book.subject?.slice(0, 5)
        };
      }
    } catch (error) {
      console.error('Open Library fetch error:', error.message);
    }
    return null;
  }

  async getMetadata(title, author, type = 'book', forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await this.cacheBackend.get(title, author, type);
      if (cached) {
        console.log(`[Aggregator] Using cached metadata for: ${title} by ${author}`);
        return cached;
      }
    }

    console.log(`[Aggregator] Fetching fresh metadata for: ${title} by ${author}`);

    let metadata = null;

    // Hardcover-only strict metadata discovery
    metadata = await this.fetchHardcoverMetadata(title, author);

    // Cache the result (even if null to prevent repeated failed requests)
    if (metadata) {
      await this.cacheBackend.set(title, author, metadata, type);
    }

    return metadata;
  }

  async getSeriesLatest(seriesName, authorName) {
    try {
      // Special handling for RR Haywood and Mark Tufo series
      if (authorName.toLowerCase().includes('haywood') && seriesName.toLowerCase().includes('undead')) {
        return await this.getUndeadLatest();
      } else if (authorName.toLowerCase().includes('tufo') && seriesName.toLowerCase().includes('zombie')) {
        return await this.getZombieFalloutLatest();
      }

      // Generic series search
      const metadata = await this.fetchAudnexusMetadata(seriesName, authorName);
      return metadata;
    } catch (error) {
      console.error('Error fetching series latest:', error);
      return null;
    }
  }

  async getUndeadLatest() {
    try {
      const response = await fetch('https://api.audnex.us/books?author=RR%20Haywood&series=The%20Undead');
      const data = await response.json();

      if (data && data.length > 0) {
        // Find the highest "Day" number
        const dayBooks = data.filter(book => book.title.includes('Day'));
        const latest = dayBooks.reduce((max, book) => {
          const dayMatch = book.title.match(/Day (\d+)/);
          const dayNum = dayMatch ? parseInt(dayMatch[1]) : 0;
          const maxMatch = max.title.match(/Day (\d+)/);
          const maxNum = maxMatch ? parseInt(maxMatch[1]) : 0;
          return dayNum > maxNum ? book : max;
        });

        return {
          source: 'audnexus',
          title: latest.title,
          author: 'RR Haywood',
          cover: latest.image,
          series: 'The Undead',
          seriesPosition: latest.title.match(/Day (\d+)/)?.[1]
        };
      }
    } catch (error) {
      console.error('Error fetching Undead latest:', error);
    }
    return null;
  }

  async getZombieFalloutLatest() {
    try {
      const response = await fetch('https://api.audnex.us/books?author=Mark%20Tufo&series=Zombie%20Fallout');
      const data = await response.json();

      if (data && data.length > 0) {
        // Sort by series position or title number
        const sortedBooks = data.sort((a, b) => {
          const aNum = a.seriesPrimary?.position || parseInt(a.title.match(/\d+/)?.[0]) || 0;
          const bNum = b.seriesPrimary?.position || parseInt(b.title.match(/\d+/)?.[0]) || 0;
          return bNum - aNum;
        });

        const latest = sortedBooks[0];
        return {
          source: 'audnexus',
          title: latest.title,
          author: 'Mark Tufo',
          cover: latest.image,
          series: 'Zombie Fallout',
          seriesPosition: latest.seriesPrimary?.position
        };
      }
    } catch (error) {
      console.error('Error fetching Zombie Fallout latest:', error);
    }
    return null;
  }

  async clearCache() {
    // Note: This clears the shared bookMetadataCache storage file.
    // This is generally safe as it will be repopulated as needed.
    await this.cacheBackend.clear();
    console.log('[Aggregator] Cache cleared via shared backend');
  }
}

module.exports = MetadataAggregator;