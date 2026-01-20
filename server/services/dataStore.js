const fs = require('fs').promises;
const path = require('path');

class DataStore {
  constructor() {
    this.dataDir = path.join(__dirname, '../../data');
    this.requestsFile = path.join(this.dataDir, 'requests.json');
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      // Initialize requests.json if it doesn't exist
      try {
        await fs.access(this.requestsFile);
      } catch (error) {
        await fs.writeFile(this.requestsFile, JSON.stringify([], null, 2));
      }

      // Initialize history.json if it doesn't exist
      try {
        await fs.access(this.historyFile);
      } catch (error) {
        await fs.writeFile(this.historyFile, JSON.stringify([], null, 2));
      }
    } catch (error) {
      console.error('Error initializing data store:', error);
    }
  }

  async writeJsonAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, filePath);
  }


  async getRequests() {
    try {
      const data = await fs.readFile(this.requestsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading requests:', error);
      return [];
    }
  }

  async getRequestById(requestId) {
    try {
      const requests = await this.getRequests();
      return requests.find(r => r.id === requestId);
    } catch (error) {
      console.error('Error getting request by ID:', error);
      return null;
    }
  }

  async addRequest(request) {
    try {
      const requests = await this.getRequests();

      const title = (request.title || '').trim();
      const author = (request.author || '').trim();
      const requestedBy = (request.requestedBy || '').trim();
      const rt = request.requestTypes || { audiobook: false, ebook: true };
      const dedupeKey = `${requestedBy}|${title.toLowerCase()}|${author.toLowerCase()}|${rt.audiobook ? 1 : 0}${rt.ebook ? 1 : 0}`;

      const existing = requests.find(r =>
        r.status === 'pending' &&
        (r._dedupeKey || '') === dedupeKey
      );
      if (existing) {
        return existing;
      }

      const newRequest = {
        id: Date.now().toString(),
        ...request,
        status: 'pending',
        createdAt: new Date().toISOString(),
        _dedupeKey: dedupeKey
      };

      requests.push(newRequest);
      await this.writeJsonAtomic(this.requestsFile, requests);
      return newRequest;
    } catch (error) {
      console.error('Error adding request:', error);
      throw error;
    }
  }


  async updateRequestStatus(requestId, status, downloadData = null) {
    try {
      const requests = await this.getRequests();
      const requestIndex = requests.findIndex(r => r.id === requestId);

      if (requestIndex === -1) {
        throw new Error('Request not found');
      }

      requests[requestIndex].status = status;
      requests[requestIndex].updatedAt = new Date().toISOString();

      if (downloadData) {
        requests[requestIndex].downloadData = downloadData;
      }

      await this.writeJsonAtomic(this.requestsFile, requests);

      // If approved, move to history
      if (status === 'approved' || status === 'downloaded') {
        await this.addToHistory(requests[requestIndex]);
      }

      return requests[requestIndex];
    } catch (error) {
      console.error('Error updating request status:', error);
      throw error;
    }
  }

  async getHistory() {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading history:', error);
      return [];
    }
  }

  async addToHistory(request) {
    try {
      const history = await this.getHistory();
      const historyEntry = {
        ...request,
        completedAt: new Date().toISOString()
      };

      history.unshift(historyEntry); // Add to beginning

      // Keep only last 100 entries
      if (history.length > 100) {
        history.splice(100);
      }

      await this.writeJsonAtomic(this.historyFile, history);
      return historyEntry;
    } catch (error) {
      console.error('Error adding to history:', error);
      throw error;
    }
  }

  async getPendingRequests() {
    try {
      const requests = await this.getRequests();
      return requests.filter(r => r.status === 'pending');
    } catch (error) {
      console.error('Error getting pending requests:', error);
      return [];
    }
  }
}

module.exports = new DataStore();