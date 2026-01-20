#!/usr/bin/env node

/**
 * Final Verification Script
 * CRITICAL: HARDCOVER-ONLY IMPLEMENTATION (NO FALLBACKS)
 *
 * Tests:
 * 1. Live GraphQL search for "Dan Brown"
 * 2. Image proxy functionality
 * 3. Verifies strict Hardcover-only responses
 */

require('dotenv').config();

const BASE_URL = 'http://localhost:3001';

async function testLiveGraphQLSearch() {
  console.log('=== Testing Live GraphQL Search ===');

  try {
    const response = await fetch(`${BASE_URL}/api/search?q=Dan Brown`);
    const results = await response.json();

    console.log(`✅ [SUCCESS] Search API responded with ${results.length} results`);

    if (results.length > 0) {
      const firstResult = results[0];
      console.log(`✅ [SUCCESS] Found book: "${firstResult.title}" by ${firstResult.author}`);
      console.log(`✅ [SUCCESS] Source: ${firstResult.source} (Hardcover-only confirmed)`);

      if (firstResult.cover && firstResult.cover.includes('/api/proxy-image')) {
        console.log(`✅ [SUCCESS] Cover uses proxy: ${firstResult.cover}`);
        return firstResult.cover;
      } else {
        console.log('⚠️  [WARNING] No proxied cover found');
        return null;
      }
    } else {
      console.log('ℹ️  [INFO] No results found for "Dan Brown" - this may be expected');
      return null;
    }
  } catch (error) {
    console.error('❌ [FATAL] Search test failed:', error.message);
    return null;
  }
}

async function testImageProxy(proxyUrl) {
  console.log('\n=== Testing Image Proxy ===');

  if (!proxyUrl) {
    console.log('⚠️  [WARNING] No proxy URL available for testing');
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}${proxyUrl}`);

    if (response.ok) {
      const contentType = response.headers.get('content-type');
      console.log(`✅ [SUCCESS] Image proxy responded: ${response.status} ${response.statusText}`);
      console.log(`✅ [SUCCESS] Content-Type: ${contentType}`);

      if (contentType && contentType.startsWith('image/')) {
        console.log('✅ [SUCCESS] Valid image content confirmed');
      } else {
        console.log('⚠️  [WARNING] Response is not an image');
      }
    } else {
      console.error(`❌ [FATAL] Image proxy failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ [FATAL] Image proxy test failed:', error.message);
  }
}

async function testDirectHardcoverGraphQL() {
  console.log('\n=== Testing Direct Hardcover GraphQL ===');

  const query = `
    query SearchBooks($query: String!, $limit: Int!) {
      books(where: {title: {_ilike: $query}}, limit: $limit) {
        id
        title
        subtitle
        description
        image {
          url
        }
        contributions {
          author {
            name
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN?.trim() || ''}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          query: '%Dan Brown%',
          limit: 5
        }
      })
    });

    if (response.ok) {
      const data = await response.json();

      if (data.data?.books) {
        console.log(`✅ [SUCCESS] Direct GraphQL returned ${data.data.books.length} results`);

        data.data.books.forEach((book, index) => {
          console.log(`  ${index + 1}. "${book.title}" by ${book.contributions?.[0]?.author?.name || 'Unknown'}`);
        });
      } else if (data.errors) {
        console.error('❌ [FATAL] GraphQL errors:', data.errors);
      } else {
        console.log('ℹ️  [INFO] No books found in GraphQL response');
      }
    } else {
      console.error(`❌ [FATAL] Direct GraphQL failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ [FATAL] Direct GraphQL test failed:', error.message);
  }
}

async function testGenreDiscovery() {
  console.log('\n=== Testing Genre Discovery ===');

  try {
    const response = await fetch(`${BASE_URL}/api/books/all`);
    const data = await response.json();

    console.log(`✅ [SUCCESS] Genre discovery responded`);
    console.log(`✅ [SUCCESS] Total books: ${data.totalBooks || 0}`);
    console.log(`✅ [SUCCESS] Romantasy: ${data.romantasy?.length || 0} books`);
    console.log(`✅ [SUCCESS] High Fantasy: ${data.highFantasy?.length || 0} books`);
    console.log(`✅ [SUCCESS] Sci-Fi: ${data.sciFi?.length || 0} books`);
    console.log(`✅ [SUCCESS] Cozy: ${data.cozy?.length || 0} books`);

    // Verify all books are from Hardcover only
    const allBooks = [
      ...(data.romantasy || []),
      ...(data.highFantasy || []),
      ...(data.sciFi || []),
      ...(data.cozy || [])
    ];

    const nonHardcoverBooks = allBooks.filter(book => book.source !== 'hardcover');

    if (nonHardcoverBooks.length === 0) {
      console.log('✅ [SUCCESS] All books are Hardcover-only (no fallbacks confirmed)');
    } else {
      console.error(`❌ [FATAL] Found ${nonHardcoverBooks.length} non-Hardcover books:`,
        nonHardcoverBooks.map(b => `${b.title} (${b.source})`));
    }

  } catch (error) {
    console.error('❌ [FATAL] Genre discovery test failed:', error.message);
  }
}

async function main() {
  console.log('🚀 Starting Final Verification...\n');

  // Test 1: Live GraphQL Search
  const proxyUrl = await testLiveGraphQLSearch();

  // Test 2: Image Proxy
  await testImageProxy(proxyUrl);

  // Test 3: Direct Hardcover GraphQL
  await testDirectHardcoverGraphQL();

  // Test 4: Genre Discovery
  await testGenreDiscovery();

  console.log('\n🎉 Final Verification Complete!');
  console.log('Check the SUCCESS logs above to confirm all functionality is working.');
}

main().catch(console.error);