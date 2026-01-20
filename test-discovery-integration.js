#!/usr/bin/env node

// Test discovery cache integration with AI curator
require('dotenv').config();

const path = require('path');
const fs = require('fs').promises;

// Load the discovery cache singleton
const discoveryCache = require('./server/services/discoveryCache');
const aiBookCurator = require('./server/services/aiBookCurator');

async function testIntegration() {
  console.log('🧪 Testing discovery cache integration with AI curator...\n');

  // Backup original genre mappings
  const originalMappings = discoveryCache.genreMappings;
  const originalCacheFile = discoveryCache.cacheFile;

  try {
    // Create temporary cache file
    const tempCacheFile = path.join(__dirname, 'data', 'test_discovery_cache.json');
    discoveryCache.cacheFile = tempCacheFile;

    // Replace genre mappings with a single test genre (limited prompt)
    const testPrompt = aiBookCurator.GENRE_PROMPTS.romantasy.replace('List 50', 'List 2');
    discoveryCache.genreMappings = {
      romantasy: {
        aiPrompt: testPrompt
      }
    };

    console.log('📋 Test: generateDailyCache with AI curation');
    console.log('   Using limited prompt (2 books)...\n');

    // Generate cache
    const cache = await discoveryCache.generateDailyCache();

    console.log('✅ Cache generated successfully');
    console.log(`   Generated at: ${cache.generatedAt}`);
    console.log(`   Genres in cache: ${Object.keys(cache.genres).join(', ')}`);

    const romantasyBooks = cache.genres.romantasy || [];
    console.log(`   Books in romantasy genre: ${romantasyBooks.length}`);

    if (romantasyBooks.length > 0) {
      console.log('\n📚 Sample book:');
      const book = romantasyBooks[0];
      console.log(`   Title: ${book.title}`);
      console.log(`   Author: ${book.authors?.join(', ')}`);
      console.log(`   ISBN: ${book.isbn13 || 'N/A'}`);
      console.log(`   Cover URL: ${book.coverUrl ? 'Yes' : 'No'}`);
    }

    // Verify cache file was created
    try {
      const stats = await fs.stat(tempCacheFile);
      console.log(`\n📁 Cache file created: ${tempCacheFile} (${stats.size} bytes)`);
    } catch (error) {
      console.error('\n❌ Cache file not created:', error.message);
    }

    // Clean up: delete temporary cache file
    try {
      await fs.unlink(tempCacheFile);
      console.log('🧹 Temporary cache file deleted');
    } catch (error) {
      // Ignore if file doesn't exist
    }

    console.log('\n🎉 Discovery cache integration test passed!');

  } finally {
    // Restore original mappings and cache file
    discoveryCache.genreMappings = originalMappings;
    discoveryCache.cacheFile = originalCacheFile;
    discoveryCache.cache = null;
    discoveryCache.lastGenerated = null;
  }
}

// Run test
testIntegration().catch(error => {
  console.error('❌ Integration test failed:', error);
  process.exit(1);
});