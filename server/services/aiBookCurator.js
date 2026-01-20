const googleBooksApi = require('./googleBooksApi');
const coverResolver = require('./coverResolver');
const bookMetadataCache = require('./bookMetadataCache');

require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error('[AIBookCurator] DEEPSEEK_API_KEY is not set in .env file');
  // Don't exit, just log - service may be used without DeepSeek if fallback needed
}

const GENRE_PROMPTS = {
  romantasy: "List 50 most popular romantasy books (2015-2025): include mega-hits like ACOTAR, Fourth Wing, Crescent City, plus newer releases. Mix of series starters and standalones. Must have 4.0+ average rating and 50,000+ ratings on Goodreads. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  fantasy: "List 50 epic/high fantasy books: mix of modern classics (Sanderson, Tolkien, Le Guin, Rothfuss) and acclaimed recent releases (2010-2025). Include series starters. 4.2+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  booktok_trending: "List 50 books currently viral on BookTok and Bookstagram (2024-2026). Include trending romantasy, thrillers, dark romance, and emotional reads with massive social media buzz. Books people can't stop talking about RIGHT NOW. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  popular: "List 50 bestselling fiction books from 2024-2025 across all genres. Books currently trending with high sales/buzz. 4.0+ stars, diverse genres (not all fantasy). Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  new_releases: "List 50 highly anticipated fiction releases from the last 6 months (focus on fantasy, sci-fi, romance, mystery). Include books with buzz even if ratings are still building. 3.8+ stars minimum. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  hidden_gems: "List 50 underrated fiction gems (2018-2025): 4.3+ stars, 5,000-50,000 ratings (not mega-famous but quality). Mix of fantasy, sci-fi, mystery. Traditional publishers preferred. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  action_adventure: "List 50 fast-paced action and adventure books (2015-2025): urban fantasy (Dresden Files, Rivers of London style), time-travel action (Extracted series), zombie/apocalyptic survival with humor (Undead series, Zombie Fallout), military sci-fi, conspiracy thrillers. Contemporary settings, witty protagonists, plot-driven fun. Perfect palate cleansers after heavy epic fantasy. Authors like RR Haywood, Mark Tufo, Jim Butcher, Ben Aaronovitch, Blake Crouch, Andy Weir, Peter Clines. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  scifi: "List 50 popular sci-fi books (2015-2025): mix of space opera, cyberpunk, first contact, time travel. Include Becky Chambers, Andy Weir style accessible sci-fi. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  dark_fantasy: "List 50 dark fantasy books (2015-2025): gothic atmosphere, morally grey characters, grimdark elements. Think Joe Abercrombie, Mark Lawrence vibes. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  enemies_to_lovers: "List 50 fantasy/romantasy books (2018-2025) with strong enemies-to-lovers romance. Tension-filled, slow burn preferred. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]",

  dragons: "List 50 fantasy books (2015-2025) prominently featuring dragons: dragon riders, dragon bonds, dragon wars. Mix of YA and adult. 4.0+ stars. Return ONLY valid JSON: [{\"title\":\"...\",\"author\":\"...\"}]"
};

class AIBookCurator {
  constructor() {
    this.deepSeekApiKey = DEEPSEEK_API_KEY;
    this.deepSeekEndpoint = 'https://api.deepseek.com/v1/chat/completions';
    this.model = 'deepseek-chat';
    this.temperature = 0.3;
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    this.requestTimeout = 30000; // 30 seconds
    this.GENRE_PROMPTS = GENRE_PROMPTS;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async makeDeepSeekRequest(prompt, retryCount = 0) {
    if (!this.deepSeekApiKey) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    try {
      const response = await fetch(this.deepSeekEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.deepSeekApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: prompt
          }],
          temperature: this.temperature
        }),
        signal: AbortSignal.timeout(this.requestTimeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AIBookCurator] DeepSeek API error: ${response.status} - ${errorText}`);

        // Handle rate limiting (429)
        if (response.status === 429 && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount);
          console.log(`[AIBookCurator] Rate limited, retry ${retryCount + 1}/${this.maxRetries} in ${delay}ms...`);
          await this.sleep(delay);
          return this.makeDeepSeekRequest(prompt, retryCount + 1);
        }

        throw new Error(`DeepSeek API request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || '';

    } catch (error) {
      console.error(`[AIBookCurator] DeepSeek request failed (attempt ${retryCount + 1}/${this.maxRetries + 1}):`, error.message);

      if (retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount);
        console.log(`[AIBookCurator] Retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.makeDeepSeekRequest(prompt, retryCount + 1);
      }

      throw error;
    }
  }

  parseJsonResponse(content) {
    let jsonStr = content.trim();

    // Strip markdown code blocks
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.substring(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }

    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('[AIBookCurator] Failed to parse JSON response:', error.message);
      console.error('[AIBookCurator] Raw content:', content);
      throw new Error('Invalid JSON response from AI');
    }
  }

  async generateBookList(genrePrompt) {
    console.log(`[AIBookCurator] Generating book list with AI...`);

    try {
      const content = await this.makeDeepSeekRequest(genrePrompt);
      const bookList = this.parseJsonResponse(content);

      if (!Array.isArray(bookList)) {
        throw new Error('AI response is not an array');
      }

      // Validate each item has title and author
      const validatedList = bookList.map((book, index) => {
        if (!book || typeof book !== 'object') {
          console.warn(`[AIBookCurator] Invalid book at index ${index}:`, book);
          return null;
        }

        const title = book.title || '';
        const author = book.author || '';

        if (!title || !author) {
          console.warn(`[AIBookCurator] Book missing title or author at index ${index}:`, book);
          return null;
        }

        return { title: title.trim(), author: author.trim() };
      }).filter(book => book !== null);

      console.log(`[AIBookCurator] Generated ${validatedList.length} valid books`);
      return validatedList;

    } catch (error) {
      console.error('[AIBookCurator] Error generating book list:', error.message);
      throw error;
    }
  }

  async enrichWithGoogleBooks(bookList) {
    console.log(`[AIBookCurator] Enriching ${bookList.length} books with Google Books metadata...`);

    const enrichedBooks = [];
    let foundCount = 0;
    let notFoundCount = 0;
    let cacheHits = 0;

    for (let i = 0; i < bookList.length; i++) {
      const book = bookList[i];
      const { title, author } = book;

      try {
        // 1. Check Metadata Cache first
        const cachedData = await bookMetadataCache.get(title, author);
        if (cachedData) {
          enrichedBooks.push({
            ...cachedData,
            coverUrl: await coverResolver.getCoverUrl(cachedData.isbn13, cachedData.thumbnail)
          });
          foundCount++;
          cacheHits++;
          // console.log(`[AIBookCurator] [Cache Hit] "${title}"`);
          continue;
        }

        console.log(`[AIBookCurator] Enriching ${i + 1}/${bookList.length}: "${title}" by ${author}`);

        // 2. Try multiple search queries (Queued by GoogleBooksApi)
        const queries = [
          `intitle:"${title}"+inauthor:"${author}"`,
          `"${title}"+${author}`,
          `${title}+${author}`
        ];

        let googleBook = null;

        for (const query of queries) {
          const results = await googleBooksApi.searchBooks(query, 5);
          if (results.length > 0) {
            // Find best match by comparing title and author similarity
            const bestMatch = results.find(b =>
              b.title && b.title.toLowerCase().includes(title.toLowerCase()) &&
              b.authors && b.authors.some(a => a.toLowerCase().includes(author.toLowerCase()))
            ) || results[0];

            googleBook = bestMatch;
            break;
          }
          // Note: No manual sleep needed here anymore, the request queue handles it!
        }

        if (googleBook) {
          // 3. Update Cache
          await bookMetadataCache.set(title, author, googleBook);

          // Get cover URL
          const coverUrl = await coverResolver.getCoverUrl(googleBook.isbn13, googleBook.thumbnail);

          enrichedBooks.push({
            ...googleBook,
            coverUrl
          });
          foundCount++;
          console.log(`[AIBookCurator] ✓ Found: "${googleBook.title}"`);
        } else {
          console.log(`[AIBookCurator] ✗ Not found: "${title}" by ${author}`);
          notFoundCount++;
          // Still add a minimal record
          enrichedBooks.push({
            title,
            authors: [author],
            isbn13: null,
            thumbnail: null,
            coverUrl: coverResolver.getPlaceholderUrl(),
            publishedDate: '',
            averageRating: 0,
            ratingsCount: 0,
            pageCount: 0,
            publisher: '',
            description: '',
            googleBooksId: null
          });
        }

      } catch (error) {
        console.error(`[AIBookCurator] Error enriching book "${title}":`, error.message);
        notFoundCount++;
        // Add minimal record
        enrichedBooks.push({
          title,
          authors: [author],
          isbn13: null,
          thumbnail: null,
          coverUrl: coverResolver.getPlaceholderUrl(),
          publishedDate: '',
          averageRating: 0,
          ratingsCount: 0,
          pageCount: 0,
          publisher: '',
          description: '',
          googleBooksId: null
        });
      }
    }

    console.log(`[AIBookCurator] Enrichment complete: ${foundCount} found (${cacheHits} form cache), ${notFoundCount} not found`);
    return enrichedBooks;
  }

  async generateAndEnrich(genrePrompt) {
    console.log(`[AIBookCurator] Starting AI curation pipeline...`);
    const startTime = Date.now();

    try {
      const bookList = await this.generateBookList(genrePrompt);
      const enrichedBooks = await this.enrichWithGoogleBooks(bookList);

      const elapsed = Date.now() - startTime;
      console.log(`[AIBookCurator] Pipeline completed in ${elapsed}ms`);

      return enrichedBooks;
    } catch (error) {
      console.error('[AIBookCurator] Pipeline failed:', error.message);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new AIBookCurator();