const fs = require('fs').promises;
const path = require('path');

class BookMetadataCache {
    constructor() {
        this.dataDir = path.join(__dirname, '../../data');
        this.cacheFile = path.join(this.dataDir, 'book_metadata.json');
        this.cache = null;
        this.saveTimeout = null;
        this.TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    async ensureLoaded() {
        if (this.cache) return;

        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const data = await fs.readFile(this.cacheFile, 'utf8');
            this.cache = JSON.parse(data);
            console.log(`[MetadataCache] Loaded ${Object.keys(this.cache).length} books from disk`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[MetadataCache] Error loading cache:', error.message);
            }
            this.cache = {};
        }
    }

    getCacheKey(title, author, type = 'book') {
        if (!title) return null;
        const t = title.toLowerCase().trim();
        const a = (author || '').toLowerCase().trim();
        return `${type}:${t}:${a}`;
    }

    async get(title, author, type = 'book') {
        await this.ensureLoaded();
        const key = this.getCacheKey(title, author, type);
        if (!key) return null;

        const record = this.cache[key];
        if (!record) return null;

        if (this.isStale(record)) {
            console.log(`[MetadataCache] Stale record for "${title}"`);
            return null;
        }

        // Touch accessedAt for LRU potential later (not implemented yet)
        // record.accessedAt = Date.now(); 
        return record.data;
    }

    async set(title, author, data, type = 'book') {
        await this.ensureLoaded();
        const key = this.getCacheKey(title, author, type);
        if (!key) return;

        this.cache[key] = {
            updatedAt: Date.now(),
            data: data
        };

        this.scheduleSave();
    }

    isStale(record) {
        if (!record.updatedAt) return true;
        const age = Date.now() - record.updatedAt;
        return age > this.TTL_MS;
    }

    async clear() {
        await this.ensureLoaded();
        this.cache = {};
        try {
            await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
            console.log('[MetadataCache] Cache cleared and persisted');
        } catch (error) {
            console.error('[MetadataCache] Error clearing cache:', error.message);
        }
    }

    scheduleSave() {
        if (this.saveTimeout) return;
        // Debounce saves to disk
        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            try {
                await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
                console.log('[MetadataCache] Saved to disk');
            } catch (error) {
                console.error('[MetadataCache] Error persisting cache:', error.message);
            }
        }, 5000); // Wait 5 seconds of inactivity before writing
    }
}

module.exports = new BookMetadataCache();
