const axios = require('axios');
const TimeoutHandler = require('../utils/timeout');

class AudiobookshelfService {
  constructor() {
    this.baseUrl = process.env.ABS_URL || 'http://audiobookshelf:80';
    this.apiKey = process.env.ABS_API_KEY;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async makeRequest(endpoint, options = {}) {
    if (!this.apiKey) {
      throw new Error('ABS_API_KEY not configured');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Log auth header for debugging
    TimeoutHandler.logAuthHeader('ABS', this.apiKey, `(${endpoint})`);

    try {
      const response = await axios({
        url,
        method: options.method || 'GET',
        headers,
        timeout: 5000,  // Reduced from 10s to 5s
        ...options
      });

      return response.data;
    } catch (error) {
      console.error(`[ABS ERROR] ${endpoint}: ${error.message}`);
      throw new Error(`Audiobookshelf API error: ${error.message}`);
    }
  }

  async getUsers() {
    const cacheKey = 'users';
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const data = await this.makeRequest('/api/users');

      // Robust array handling - ABS may return wrapped object or direct array
      const userList = Array.isArray(data) ? data : (data.users || []);
      console.log(`[DEBUG] ABS users response type: ${Array.isArray(data) ? 'direct array' : 'wrapped object'}, count: ${userList.length}`);

      const processedUsers = userList.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        type: user.type,
        isActive: user.isActive,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt
      }));

      this.cache.set(cacheKey, {
        data: processedUsers,
        timestamp: Date.now()
      });

      console.log(`Successfully synced ${processedUsers.length} ABS users`);
      return processedUsers;
    } catch (error) {
      const fallback = TimeoutHandler.handleError('ABS', error, 'Local guest mode');
      console.log(`[ABS ERROR] Fallback to local guest mode`);
      return [];
    }
  }

  async getUserById(userId) {
    try {
      const user = await this.makeRequest(`/api/users/${userId}`);
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        type: user.type,
        isActive: user.isActive,
        settings: user.settings,
        lastSeen: user.lastSeen
      };
    } catch (error) {
      TimeoutHandler.handleError('ABS', error, `User ${userId} not available`);
      return null;
    }
  }

  async getLibraries() {
    const cacheKey = 'libraries';
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const libraries = await this.makeRequest('/api/libraries');

      const processedLibraries = libraries.map(library => ({
        id: library.id,
        name: library.name,
        folders: library.folders,
        displayOrder: library.displayOrder,
        icon: library.icon,
        mediaType: library.mediaType,
        settings: library.settings
      }));

      this.cache.set(cacheKey, {
        data: processedLibraries,
        timestamp: Date.now()
      });

      return processedLibraries;
    } catch (error) {
      TimeoutHandler.handleError('ABS', error, 'Libraries not available');
      return [];
    }
  }

  async testConnection() {
    try {
      await this.makeRequest('/ping');
      return { success: true, message: 'Connected to Audiobookshelf' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error.message}`,
        configured: !!this.apiKey
      };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AudiobookshelfService();