const axios = require('axios');

class ProwlarrService {
  constructor() {
    this.baseURL = process.env.PROWLARR_URL || 'http://prowlarr:9696';
    this.apiKey = (process.env.PROWLARR_API_KEY || '').trim() || null;
  }

  async search(query, categories = [8000, 3030]) {
    if (!this.apiKey) {
      throw new Error('PROWLARR_API_KEY is not configured');
    }
    try {
      const categoryParam = categories.join(',');

      const response = await axios.get(
        `${this.baseURL}/api/v1/search`,
        {
          params: {
            query: query,
            categories: categoryParam,
            type: 'search'
          },
          headers: {
            'X-Api-Key': this.apiKey
          },
          timeout: 30000
        }
      );

      if (response.data && Array.isArray(response.data)) {
        return response.data.map(result => ({
          title: result.title,
          size: result.size,
          seeders: result.seeders || 0,
          leechers: result.leechers || 0,
          tracker: result.tracker,
          indexer: result.indexer,
          magnetUrl: result.magnetUrl || result.downloadUrl,
          infoHash: result.infoHash,
          category: result.categories?.[0] || 'Unknown',
          publishDate: result.publishDate,
          guid: result.guid
        }));
      }

      return [];
    } catch (error) {
      console.error('Prowlarr search error:', error.message);
      if (error.response) {
        console.error('Prowlarr response error:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      throw new Error(`Prowlarr search failed: ${error.message}`);
    }
  }

  async getIndexers() {
    if (!this.apiKey) {
      return [];
    }
    try {
      const response = await axios.get(
        `${this.baseURL}/api/v1/indexer`,
        {
          headers: {
            'X-Api-Key': this.apiKey
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching Prowlarr indexers:', error.message);
      return [];
    }
  }

  formatSize(bytes) {
    if (!bytes) return 'Unknown';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    if (i === 0) return bytes + ' ' + sizes[i];
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
  }

  getCategoryName(category) {
    const categories = {
      8000: 'Ebook',
      3030: 'Audiobook',
      8010: 'Ebook/Comic',
      8020: 'Ebook/Magazine'
    };

    return categories[category] || 'Other';
  }
}

module.exports = new ProwlarrService();