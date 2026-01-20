const axios = require('axios');

class ProwlarrService {
  constructor() {
    this.baseURL = process.env.PROWLARR_URL || 'http://prowlarr:9696';
    this.apiKey = (process.env.PROWLARR_API_KEY || '').trim() || null;
  }

  async search(query, categories = []) {
    if (!this.apiKey) {
      throw new Error('PROWLARR_API_KEY is not configured');
    }
    try {
      // Prowlarr requires repeated category parameters or array format, not comma-separated string
      // Axios default serialization (categories[]) works fine for Prowlarr

      const response = await axios.get(
        `${this.baseURL}/api/v1/search`,
        {
          params: {
            query: query,
            ...(categories.length > 0 && { categories: categories }),
            type: 'search'
          },
          headers: {
            'X-Api-Key': this.apiKey
          },
          timeout: 60000, // Increased from 30s to 60s for slow indexers
          paramsSerializer: params => {
            const searchParams = new URLSearchParams();
            Object.keys(params).forEach(key => {
              const value = params[key];
              if (Array.isArray(value)) {
                value.forEach(v => searchParams.append(key, v));
              } else {
                searchParams.append(key, value);
              }
            });
            const queryString = searchParams.toString();
            console.log('[Prowlarr] Query string:', queryString);
            return queryString;
          }
        }
      );

      console.log('[Prowlarr] Response status:', response.status);
      console.log('[Prowlarr] Response data length:', response.data?.length || 0);
      if (response.data?.length > 0) {
        console.log('[Prowlarr] First result:', JSON.stringify(response.data[0], null, 2));
      }

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