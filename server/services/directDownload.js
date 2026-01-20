const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PROCESS_SCRIPT = '/app/scripts/process-download.js';

class DirectDownloadService {
    /**
     * Process a downloaded file using the existing process-download.js script.
     * This mimics what qBittorrent does when a torrent completes.
     * 
     * @param {string} filePath - Full path to the downloaded file
     * @param {string} fileName - Name of the file
     * @param {string} source - Source identifier (e.g., 'telegram', 'direct')
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async processDownload(filePath, fileName, source = 'telegram') {
        return new Promise((resolve) => {
            if (!fs.existsSync(filePath)) {
                resolve({ success: false, message: `File not found: ${filePath}` });
                return;
            }

            // Generate a fake "info hash" for logging purposes
            const infoHash = crypto.randomBytes(20).toString('hex');

            // The tracker field determines hardlink vs move behavior
            // Using 'Direct-Source' ensures move (not hardlink) since it's not MAM
            const tracker = `Direct-${source}`;

            // Category for qBittorrent-style organization
            const category = 'books';

            const args = [
                infoHash,           // %I - Info hash
                fileName,           // %N - Torrent name
                filePath,           // %F - Content path
                tracker,            // %T - Tracker URL
                category,           // %L - Category
            ];

            console.log(`[DirectDownload] Processing: ${fileName}`);
            console.log(`[DirectDownload] Args: ${JSON.stringify(args)}`);

            execFile('node', [PROCESS_SCRIPT, ...args], {
                timeout: 60000, // 60 second timeout
                env: {
                    ...process.env,
                    NODE_ENV: process.env.NODE_ENV,
                },
            }, (error, stdout, stderr) => {
                if (error) {
                    console.error('[DirectDownload] Process error:', error.message);
                    console.error('[DirectDownload] Stderr:', stderr);
                    resolve({
                        success: false,
                        message: `Processing failed: ${error.message}`,
                        stdout,
                        stderr,
                    });
                    return;
                }

                console.log('[DirectDownload] Process output:', stdout);

                resolve({
                    success: true,
                    message: 'File processed successfully',
                    stdout,
                });
            });
        });
    }

    /**
     * Download a file from a URL and then process it.
     * Used for HTTP direct downloads (Anna's Archive, etc.)
     * 
     * @param {string} url - URL to download from
     * @param {string} fileName - Desired filename
     * @param {string} downloadDir - Directory to save to
     * @returns {Promise<{success: boolean, message: string, filePath?: string}>}
     */
    async downloadAndProcess(url, fileName, downloadDir = '/downloads/books') {
        const axios = require('axios');
        const filePath = path.join(downloadDir, fileName);

        try {
            // Ensure directory exists
            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir, { recursive: true });
            }

            console.log(`[DirectDownload] Downloading from: ${url}`);

            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: 300000, // 5 minute timeout for large files
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            fs.writeFileSync(filePath, response.data);
            console.log(`[DirectDownload] Saved to: ${filePath}`);

            // Now process the downloaded file
            const processResult = await this.processDownload(filePath, fileName, 'http');

            return {
                success: processResult.success,
                message: processResult.message,
                filePath: filePath,
            };
        } catch (error) {
            console.error('[DirectDownload] Download error:', error.message);
            return {
                success: false,
                message: `Download failed: ${error.message}`,
            };
        }
    }
}

module.exports = new DirectDownloadService();
