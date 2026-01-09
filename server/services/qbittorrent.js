const axios = require('axios');

class QBittorrentService {
  constructor() {
    this.baseURL = process.env.QBIT_URL || 'http://qbittorrent:8080';
    this.username = (process.env.QBIT_USER || '').trim() || null;
    this.password = (process.env.QBIT_PASS || '').trim() || null;
    this.cookie = null;
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
        return { success: true, message: 'Torrent added successfully' };
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
}

module.exports = new QBittorrentService();