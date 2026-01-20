const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = '/app/data/telegram_session.txt';
const DOWNLOAD_DIR = '/downloads/books';

class TelegramService {
    constructor() {
        this.apiId = parseInt(process.env.TELEGRAM_API_ID) || null;
        this.apiHash = process.env.TELEGRAM_API_HASH || null;
        this.botUsername = process.env.ZLIBRARY_BOT_USERNAME || null;

        this.client = null;
        this.session = null;
        this.isConnected = false;
        this.authState = 'unconfigured'; // unconfigured, needs_phone, needs_code, needs_password, ready
        this.pendingPhoneNumber = null;
        this.pendingPhoneCodeHash = null;
    }

    isConfigured() {
        return this.apiId && this.apiHash && this.botUsername;
    }

    loadSession() {
        try {
            if (fs.existsSync(SESSION_FILE)) {
                const sessionString = fs.readFileSync(SESSION_FILE, 'utf8').trim();
                return new StringSession(sessionString);
            }
        } catch (error) {
            console.error('[Telegram] Error loading session:', error.message);
        }
        return new StringSession('');
    }

    saveSession() {
        try {
            const sessionString = this.client.session.save();
            fs.writeFileSync(SESSION_FILE, sessionString);
            console.log('[Telegram] Session saved');
        } catch (error) {
            console.error('[Telegram] Error saving session:', error.message);
        }
    }

    async connect() {
        if (!this.isConfigured()) {
            console.log('[Telegram] Not configured. Set TELEGRAM_API_ID, TELEGRAM_API_HASH, ZLIBRARY_BOT_USERNAME');
            this.authState = 'unconfigured';
            return false;
        }

        try {
            this.session = this.loadSession();
            this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
                connectionRetries: 5,
            });

            await this.client.connect();

            if (await this.client.isUserAuthorized()) {
                this.isConnected = true;
                this.authState = 'ready';
                console.log('[Telegram] Connected and authorized');
                return true;
            } else {
                this.authState = 'needs_phone';
                console.log('[Telegram] Connected but not authorized. Waiting for phone number.');
                return false;
            }
        } catch (error) {
            console.error('[Telegram] Connection error:', error.message);
            this.authState = 'error';
            return false;
        }
    }

    async sendPhoneNumber(phoneNumber) {
        if (!this.client) {
            throw new Error('Client not connected');
        }

        try {
            const result = await this.client.invoke(
                new Api.auth.SendCode({
                    phoneNumber: phoneNumber,
                    apiId: this.apiId,
                    apiHash: this.apiHash,
                    settings: new Api.CodeSettings({
                        allowFlashcall: false,
                        currentNumber: false,
                        allowAppHash: false,
                    }),
                })
            );

            this.pendingPhoneNumber = phoneNumber;
            this.pendingPhoneCodeHash = result.phoneCodeHash;
            this.authState = 'needs_code';
            console.log('[Telegram] Code sent to phone');
            return { success: true, message: 'Code sent to your Telegram app' };
        } catch (error) {
            console.error('[Telegram] Send code error:', error.message);
            return { success: false, message: error.message };
        }
    }

    async sendCode(code) {
        if (!this.client || !this.pendingPhoneNumber || !this.pendingPhoneCodeHash) {
            throw new Error('No pending authentication');
        }

        try {
            const result = await this.client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: this.pendingPhoneNumber,
                    phoneCodeHash: this.pendingPhoneCodeHash,
                    phoneCode: code,
                })
            );

            this.isConnected = true;
            this.authState = 'ready';
            this.saveSession();
            console.log('[Telegram] Successfully signed in');
            return { success: true, message: 'Signed in successfully' };
        } catch (error) {
            if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
                this.authState = 'needs_password';
                return { success: false, message: 'Two-factor authentication required', needsPassword: true };
            }
            console.error('[Telegram] Sign in error:', error.message);
            return { success: false, message: error.message };
        }
    }

    async sendPassword(password) {
        if (!this.client) {
            throw new Error('Client not connected');
        }

        try {
            const passwordInfo = await this.client.invoke(new Api.account.GetPassword());
            const passwordCheck = await computeCheck(passwordInfo, password);
            const result = await this.client.invoke(
                new Api.auth.CheckPassword({
                    password: passwordCheck,
                })
            );

            this.isConnected = true;
            this.authState = 'ready';
            this.saveSession();
            console.log('[Telegram] Successfully signed in with 2FA');
            return { success: true, message: 'Signed in successfully' };
        } catch (error) {
            console.error('[Telegram] 2FA error:', error.message);
            return { success: false, message: error.message };
        }
    }

    getStatus() {
        return {
            configured: this.isConfigured(),
            connected: this.isConnected,
            authState: this.authState,
            botUsername: this.botUsername || null,
        };
    }

    async search(query) {
        if (!this.isConnected || this.authState !== 'ready') {
            console.log('[Telegram] Not ready for search');
            return [];
        }

        try {
            // Resolve the bot entity
            const bot = await this.client.getEntity(this.botUsername);

            // Send search message
            await this.client.sendMessage(bot, { message: query });

            // Wait for response (give the bot time to reply)
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Get recent messages from the bot
            const messages = await this.client.getMessages(bot, { limit: 5 });

            const results = [];

            for (const msg of messages) {
                if (!msg.message || msg.out) continue; // Skip our own messages

                // Parse the bot's response to extract book information
                const parsed = this.parseSearchResponse(msg);
                if (parsed.length > 0) {
                    results.push(...parsed);
                }
            }

            console.log(`[Telegram] Search returned ${results.length} results`);
            return results;
        } catch (error) {
            console.error('[Telegram] Search error:', error.message);
            return [];
        }
    }

    parseSearchResponse(message) {
        const results = [];
        const text = message.message || '';

        // Debug: log the raw message
        console.log('[Telegram] Parsing message:', JSON.stringify({
            id: message.id,
            text: text.substring(0, 200),
            hasMarkup: !!message.replyMarkup,
        }));

        // Skip messages that are clearly not book results
        const skipPatterns = [
            /^searching/i,
            /^please wait/i,
            /^no results/i,
            /^error/i,
        ];

        if (skipPatterns.some(p => p.test(text))) {
            return [];
        }

        // Navigation/UI button text to ignore
        const ignoreButtonTexts = [
            'next', 'prev', 'back', 'menu', 'search', 'cancel',
            'click to read', 'read full', 'description', '»', '«',
            '- 1 -', '- 2 -', '- 3 -', '(1)', '(2)', '(3)',
        ];

        // First, try to parse the text content for book information
        // Z-Library bot often sends book info in this format:
        // 📚 Title
        // Author Name
        // Format, Size
        const bookBlocks = text.split(/\n\n+/); // Split by empty lines

        for (const block of bookBlocks) {
            const lines = block.split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length === 0) continue;

            // Look for book markers in first line
            const firstLine = lines[0];

            // Skip navigation/pagination markers
            if (/^[\-\s\d\(\)«»]+$/.test(firstLine)) continue;
            if (/^(page|showing|results)/i.test(firstLine)) continue;

            // Check if this looks like a book entry
            const hasBookEmoji = /📖|📚|📕|📗|📘|📙/.test(firstLine);
            const hasNumberPrefix = /^\d+[\.\)]\s/.test(firstLine);
            const hasTitle = firstLine.length > 5 && !firstLine.startsWith('click') && !firstLine.startsWith('tap');

            if (hasBookEmoji || hasNumberPrefix || hasTitle) {
                let title = firstLine
                    .replace(/📖|📚|📕|📗|📘|📙/g, '')
                    .replace(/^\d+[\.\)]\s*/, '')
                    .trim();

                // Skip if title is too short or looks like navigation
                if (title.length < 3) continue;
                if (ignoreButtonTexts.some(t => title.toLowerCase().includes(t.toLowerCase()))) continue;

                const book = {
                    title: title,
                    source: 'telegram',
                    size: 'Unknown',
                    format: 'epub',
                    author: null,
                    messageId: message.id,
                };

                // Look for author, size, format in remaining lines
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i];

                    // Check for size
                    const sizeMatch = line.match(/(\d+\.?\d*)\s*(MB|KB|GB)/i);
                    if (sizeMatch) {
                        book.size = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
                    }

                    // Check for format
                    const formatMatch = line.match(/\b(epub|pdf|mobi|azw3|fb2|djvu)\b/i);
                    if (formatMatch) {
                        book.format = formatMatch[1].toLowerCase();
                    }

                    // Look for /book command (Z-Library specific)
                    const bookCmdMatch = line.match(/(\/book[a-zA-Z0-9_]+)/i);
                    if (bookCmdMatch) {
                        book.downloadCommand = bookCmdMatch[1];
                        // Also try to get size/format from the same line
                        const inlineSize = line.match(/(\d+\.?\d*)\s*(MB|KB|GB)/i);
                        if (inlineSize) {
                            book.size = `${inlineSize[1]} ${inlineSize[2].toUpperCase()}`;
                        }
                        const inlineFormat = line.match(/\b(epub|pdf|mobi|azw3|fb2|djvu)\b/i);
                        if (inlineFormat) {
                            book.format = inlineFormat[1].toLowerCase();
                        }
                    }

                    // Look for author (usually line 2, check if it looks like a name)
                    if (i === 1 && !sizeMatch && !formatMatch && !bookCmdMatch) {
                        const potentialAuthor = line.replace(/^by\s+/i, '').trim();
                        if (potentialAuthor.length > 2 && potentialAuthor.length < 100 && !potentialAuthor.startsWith('/')) {
                            book.author = potentialAuthor;
                            book.title = `${book.title} - ${potentialAuthor}`;
                        }
                    }
                }

                // Only add book if we have a download command
                if (book.downloadCommand) {
                    results.push(book);
                }
            }
        }

        // If we found results from text, add download buttons where available
        if (message.replyMarkup && message.replyMarkup.rows) {
            let downloadButtons = [];
            for (const row of message.replyMarkup.rows) {
                for (const button of row.buttons) {
                    if (button.data) {
                        const buttonText = (button.text || '').toLowerCase();
                        // Only keep download-related buttons
                        if (buttonText.includes('download') ||
                            buttonText.includes('get') ||
                            buttonText.includes('📥') ||
                            /^\d+$/.test(buttonText)) {
                            downloadButtons.push({
                                text: button.text,
                                data: button.data.toString('utf8'),
                            });
                        }
                    }
                }
            }

            // Try to match buttons to results
            if (downloadButtons.length > 0 && results.length > 0) {
                results.forEach((result, i) => {
                    if (downloadButtons[i]) {
                        result.downloadCommand = downloadButtons[i].data;
                    }
                });
            }
        }

        console.log(`[Telegram] Parsed ${results.length} book results from message`);
        return results;
    }

    extractFormat(text) {
        const match = text.match(/\.(epub|pdf|mobi|azw3|fb2)/i);
        return match ? match[1].toLowerCase() : 'epub';
    }

    async download(downloadInfo) {
        if (!this.isConnected || this.authState !== 'ready') {
            return { success: false, message: 'Telegram not connected' };
        }

        try {
            const bot = await this.client.getEntity(this.botUsername);

            // If we have a /book command (Z-Library style), send it as a message
            if (downloadInfo.downloadCommand && downloadInfo.downloadCommand.startsWith('/book')) {
                console.log(`[Telegram] Sending book command: ${downloadInfo.downloadCommand}`);
                await this.client.sendMessage(bot, { message: downloadInfo.downloadCommand });
            } else if (downloadInfo.downloadCommand) {
                // Try callback button approach
                try {
                    await this.client.invoke(
                        new Api.messages.GetBotCallbackAnswer({
                            peer: bot,
                            msgId: downloadInfo.messageId,
                            data: Buffer.from(downloadInfo.downloadCommand),
                        })
                    );
                } catch (e) {
                    console.log('[Telegram] Callback failed, trying as message:', e.message);
                    await this.client.sendMessage(bot, { message: downloadInfo.downloadCommand });
                }
            } else if (downloadInfo.title) {
                // Send the title as a download request
                await this.client.sendMessage(bot, { message: downloadInfo.title });
            }

            // Wait for the file to be sent
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Get recent messages and look for a file
            const messages = await this.client.getMessages(bot, { limit: 3 });

            for (const msg of messages) {
                if (msg.document || msg.media) {
                    // Download the file
                    const fileName = this.getFileName(msg);
                    const filePath = path.join(DOWNLOAD_DIR, fileName);

                    console.log(`[Telegram] Downloading file: ${fileName}`);

                    const buffer = await this.client.downloadMedia(msg, {
                        progressCallback: (downloaded, total) => {
                            const percent = Math.round((downloaded / total) * 100);
                            if (percent % 20 === 0) {
                                console.log(`[Telegram] Download progress: ${percent}%`);
                            }
                        },
                    });

                    // Ensure directory exists
                    if (!fs.existsSync(DOWNLOAD_DIR)) {
                        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
                    }

                    fs.writeFileSync(filePath, buffer);
                    console.log(`[Telegram] File saved: ${filePath}`);

                    return {
                        success: true,
                        filePath: filePath,
                        fileName: fileName,
                        message: 'File downloaded successfully',
                    };
                }
            }

            return { success: false, message: 'No file received from bot' };
        } catch (error) {
            console.error('[Telegram] Download error:', error.message);
            return { success: false, message: error.message };
        }
    }

    getFileName(message) {
        if (message.document) {
            for (const attr of message.document.attributes || []) {
                if (attr.fileName) {
                    return attr.fileName;
                }
            }
        }
        // Fallback name
        const timestamp = Date.now();
        return `telegram_download_${timestamp}.epub`;
    }
}

module.exports = new TelegramService();
