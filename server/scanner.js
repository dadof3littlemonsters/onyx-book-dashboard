const fs = require('fs').promises;
const path = require('path');
const fuzzball = require('fuzzball');

class LibraryScanner {
  constructor() {
    this.libraryFile = path.join(__dirname, '../data/local_library.json');
    this.audiobookPath = '/app/media/audiobooks';
    this.ebookPath = '/app/media/ebooks';
    this.library = new Map();
    this.loadLibrary();
  }

  async loadLibrary() {
    try {
      const libraryData = await fs.readFile(this.libraryFile, 'utf8');
      const parsedLibrary = JSON.parse(libraryData);
      Object.entries(parsedLibrary).forEach(([key, value]) => {
        this.library.set(key, value);
      });
      console.log(`Loaded ${this.library.size} items from local library`);
    } catch (error) {
      console.log('No existing library cache found, starting fresh');
      await this.ensureDataDirectory();
    }
  }

  async saveLibrary() {
    try {
      await this.ensureDataDirectory();
      const libraryObject = Object.fromEntries(this.library);
      await fs.writeFile(this.libraryFile, JSON.stringify(libraryObject, null, 2));
      console.log(`Saved ${this.library.size} items to local library`);
    } catch (error) {
      console.error('Error saving library cache:', error);
    }
  }

  async ensureDataDirectory() {
    const dataDir = path.join(__dirname, '../data');
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('Error creating data directory:', error);
      }
    }
  }

  generateLibraryKey(title, author, type = 'book') {
    return `${type}:${title.toLowerCase().trim()}:${author.toLowerCase().trim()}`;
  }

  cleanTitle(title) {
    return title
      .replace(/\.(mp3|m4a|m4b|epub|pdf|mobi|azw3)$/i, '')
      .replace(/^\d+\s*[-.]?\s*/, '') // Remove leading numbers
      .replace(/\s*[-]\s*.*$/, '') // Remove subtitle after dash
      .replace(/\s*:\s*.*$/, '') // Remove subtitle after colon
      .replace(/\s*\(.*\)$/, '') // Remove parenthetical content
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractAuthorFromPath(filePath) {
    const pathParts = filePath.split(path.sep);

    // Common patterns: /Author Name/Book Title/ or /Author Name - Book Title/
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const part = pathParts[i];

      // Skip file names and common directory names
      if (part.includes('.') ||
          ['audiobooks', 'ebooks', 'media', 'app'].includes(part.toLowerCase())) {
        continue;
      }

      // Look for author name patterns
      if (part.includes(',') || part.split(' ').length >= 2) {
        return part.replace(/,?\s*(Jr|Sr|III|IV)\.?/i, '').trim();
      }
    }

    return 'Unknown Author';
  }

  async scanDirectory(dirPath, type = 'book') {
    const items = [];

    try {
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!exists) {
        console.log(`Directory not found: ${dirPath}`);
        return items;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subItems = await this.scanDirectory(fullPath, type);
          items.push(...subItems);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();

          // Audio file extensions
          const audioExts = ['.mp3', '.m4a', '.m4b', '.aac', '.flac'];
          // Ebook file extensions
          const ebookExts = ['.epub', '.pdf', '.mobi', '.azw3', '.azw', '.cbr', '.cbz'];

          if ((type === 'audiobook' && audioExts.includes(ext)) ||
              (type === 'ebook' && ebookExts.includes(ext))) {

            const title = this.cleanTitle(entry.name);
            const author = this.extractAuthorFromPath(fullPath);

            if (title && title !== 'Unknown Title') {
              items.push({
                title,
                author,
                filePath: fullPath,
                fileName: entry.name,
                type,
                scannedAt: new Date().toISOString()
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }

    return items;
  }

  async scanLibrary(forceRescan = false) {
    console.log('Starting library scan...');

    if (!forceRescan && this.library.size > 0) {
      console.log('Using existing library cache. Use forceRescan=true to refresh.');
      return Array.from(this.library.values());
    }

    this.library.clear();

    // Scan audiobooks
    console.log('Scanning audiobooks...');
    const audiobooks = await this.scanDirectory(this.audiobookPath, 'audiobook');

    // Scan ebooks
    console.log('Scanning ebooks...');
    const ebooks = await this.scanDirectory(this.ebookPath, 'ebook');

    // Combine and store results
    const allItems = [...audiobooks, ...ebooks];

    for (const item of allItems) {
      const key = this.generateLibraryKey(item.title, item.author, item.type);
      this.library.set(key, item);
    }

    await this.saveLibrary();

    console.log(`Library scan complete: ${audiobooks.length} audiobooks, ${ebooks.length} ebooks`);
    return allItems;
  }

  checkOwnership(title, author, type = 'book') {
    const searchKey = this.generateLibraryKey(title, author, type);

    if (this.library.has(searchKey)) {
      return {
        owned: true,
        exactMatch: true,
        item: this.library.get(searchKey)
      };
    }

    // Fuzzy matching fallback
    const threshold = 80; // Minimum similarity percentage
    const libraryItems = Array.from(this.library.values());

    for (const item of libraryItems) {
      if (item.type !== type && type !== 'book') continue;

      const titleScore = fuzzball.ratio(title.toLowerCase(), item.title.toLowerCase());
      const authorScore = fuzzball.ratio(author.toLowerCase(), item.author.toLowerCase());

      // Require both title and author to meet threshold
      if (titleScore >= threshold && authorScore >= threshold) {
        return {
          owned: true,
          exactMatch: false,
          fuzzyMatch: true,
          titleScore,
          authorScore,
          item
        };
      }
    }

    return {
      owned: false,
      exactMatch: false,
      fuzzyMatch: false
    };
  }

  async getLibraryStats() {
    const items = Array.from(this.library.values());

    const stats = {
      total: items.length,
      audiobooks: items.filter(item => item.type === 'audiobook').length,
      ebooks: items.filter(item => item.type === 'ebook').length,
      authors: new Set(items.map(item => item.author)).size,
      lastScan: items.length > 0 ? Math.max(...items.map(item => new Date(item.scannedAt).getTime())) : null
    };

    if (stats.lastScan) {
      stats.lastScanFormatted = new Date(stats.lastScan).toISOString();
    }

    return stats;
  }

  async searchLibrary(query, type = null) {
    const results = [];
    const queryLower = query.toLowerCase();
    const libraryItems = Array.from(this.library.values());

    for (const item of libraryItems) {
      if (type && item.type !== type) continue;

      const titleMatch = item.title.toLowerCase().includes(queryLower);
      const authorMatch = item.author.toLowerCase().includes(queryLower);

      if (titleMatch || authorMatch) {
        results.push({
          ...item,
          titleMatch,
          authorMatch
        });
      }
    }

    // Sort by relevance (title matches first, then by title alphabetically)
    return results.sort((a, b) => {
      if (a.titleMatch && !b.titleMatch) return -1;
      if (!a.titleMatch && b.titleMatch) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  async removeFromLibrary(title, author, type = 'book') {
    const key = this.generateLibraryKey(title, author, type);
    const removed = this.library.delete(key);

    if (removed) {
      await this.saveLibrary();
      console.log(`Removed ${title} by ${author} from library`);
    }

    return removed;
  }

  async clearLibrary() {
    this.library.clear();
    try {
      await fs.unlink(this.libraryFile);
      console.log('Library cache cleared');
    } catch (error) {
      console.log('Library file not found or already cleared');
    }
  }
}

module.exports = LibraryScanner;