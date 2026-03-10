const axios = require('axios');

class QBittorrentService {
  constructor() {
    this.baseURL = process.env.QBIT_URL || 'http://qbittorrent:8080';
    this.username = (process.env.QBIT_USER || '').trim() || null;
    this.password = (process.env.QBIT_PASS || '').trim() || null;
    this.cookie = null;
  }

  tokenizeForMatch(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 3);
  }

  scoreTitleMatch(query, candidate) {
    const queryTokens = this.tokenizeForMatch(query);
    const candidateTokens = this.tokenizeForMatch(candidate);
    if (queryTokens.length === 0 || candidateTokens.length === 0) {
      return { score: 0, matched: 0, total: queryTokens.length };
    }

    const candidateSet = new Set(candidateTokens);
    let matched = 0;
    for (const token of queryTokens) {
      if (candidateSet.has(token)) matched += 1;
    }

    return {
      score: matched / queryTokens.length,
      matched,
      total: queryTokens.length
    };
  }

  async authenticate() {
    if (!this.username || !this.password) {
      console.error('qBittorrent credentials missing (QBIT_USER/QBIT_PASS)');
      return false;
    }
    try {
      const response = await axios.post(
        `${this.baseURL}/api/v2/auth/login`,
        new URLSearchParams({
          username: this.username,
          password: this.password
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      if (response.status === 200 && response.headers['set-cookie']) {
        this.cookie = response.headers['set-cookie'][0];
        console.log('qBittorrent authentication successful');
        return true;
      } else {
        console.error('qBittorrent authentication failed');
        return false;
      }
    } catch (error) {
      console.error('qBittorrent authentication error:', error.message);
      return false;
    }
  }

  async ensureAuthenticated() {
    if (!this.cookie) {
      const success = await this.authenticate();
      if (!success) {
        throw new Error('Failed to authenticate with qBittorrent');
      }
    }
    return true;
  }

  async addTorrent(magnetLink, savePath = '/downloads/books') {
    try {
      await this.ensureAuthenticated();
      const parsedHash = this.extractMagnetHash(magnetLink);

      const response = await axios.post(
        `${this.baseURL}/api/v2/torrents/add`,
        new URLSearchParams({
          urls: magnetLink,
          savepath: savePath,
          category: 'books'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': this.cookie
          },
          timeout: 15000
        }
      );

      if (response.status === 200) {
        console.log('Torrent added successfully to qBittorrent');
        return { success: true, message: 'Torrent added successfully', hash: parsedHash };
      } else {
        console.error('Failed to add torrent to qBittorrent');
        return { success: false, message: 'Failed to add torrent' };
      }
    } catch (error) {
      console.error('qBittorrent add torrent error:', error.message);

      // Try to re-authenticate if cookie expired
      if (error.response && error.response.status === 403) {
        this.cookie = null;
        return this.addTorrent(magnetLink, savePath);
      }

      return { success: false, message: 'Error adding torrent: ' + error.message };
    }
  }

  extractMagnetHash(magnetLink) {
    if (!magnetLink || typeof magnetLink !== 'string') return null;
    const match = magnetLink.match(/(?:\\?|&)xt=urn:btih:([A-Za-z0-9]+)/i);
    if (!match || !match[1]) return null;
    const hash = String(match[1]).trim();
    // qBittorrent torrent hash is normally 40-char hex. Keep only that format for reliable matching.
    if (/^[a-f0-9]{40}$/i.test(hash)) {
      return hash.toLowerCase();
    }
    return null;
  }

  async getTorrents() {
    try {
      await this.ensureAuthenticated();

      const response = await axios.get(
        `${this.baseURL}/api/v2/torrents/info?category=books`,
        {
          headers: {
            'Cookie': this.cookie
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching torrents from qBittorrent:', error.message);
      return [];
    }
  }

  async testConnection() {
    try {
      const success = await this.ensureAuthenticated();
      return {
        success: Boolean(success),
        message: success ? 'Connected to qBittorrent' : 'Authentication failed'
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  async resolveTorrentHashByName(query, options = {}) {
    const {
      retries = 5,
      delayMs = 1500
    } = options;

    const titleQuery = String(query || '').trim();
    if (!titleQuery) return null;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      const torrents = await this.getTorrents();
      let best = null;
      let bestMatch = null;

      for (const torrent of torrents) {
        if (!torrent?.hash || !torrent?.name) continue;
        const match = this.scoreTitleMatch(titleQuery, torrent.name);
        const acceptable = match.matched >= 2 && match.score >= 0.34;
        if (!acceptable) continue;

        if (!bestMatch || match.score > bestMatch.score || (match.score === bestMatch.score && match.matched > bestMatch.matched)) {
          best = torrent;
          bestMatch = match;
        }
      }

      if (best?.hash) {
        return String(best.hash).toLowerCase();
      }

      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }
}

module.exports = new QBittorrentService();
