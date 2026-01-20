#!/usr/bin/env node

// Test script for AI Book Curator service
require('dotenv').config();

const aiBookCurator = require('./server/services/aiBookCurator');

async function testAICurator() {
  console.log('🧪 Testing AI Book Curator service...\n');

  // Test 1: Generate book list with a small prompt
  console.log('📋 Test 1: generateBookList');
  const testPrompt = 'List 2 popular romantasy books from 2023-2025. Return ONLY valid JSON: [{"title":"...","author":"..."}]';

  try {
    const bookList = await aiBookCurator.generateBookList(testPrompt);
    console.log(`✅ Generated ${bookList.length} books:`);
    bookList.forEach((book, i) => {
      console.log(`   ${i + 1}. "${book.title}" by ${book.author}`);
    });
  } catch (error) {
    console.error('❌ generateBookList failed:', error.message);
    return;
  }

  // Test 2: Enrich with Google Books
  console.log('\n📚 Test 2: enrichWithGoogleBooks');
  const smallBookList = [
    { title: 'Fourth Wing', author: 'Rebecca Yarros' },
    { title: 'A Court of Silver Flames', author: 'Sarah J. Maas' }
  ];

  try {
    const enrichedBooks = await aiBookCurator.enrichWithGoogleBooks(smallBookList);
    console.log(`✅ Enriched ${enrichedBooks.length} books:`);
    enrichedBooks.forEach((book, i) => {
      console.log(`   ${i + 1}. "${book.title}" by ${book.authors?.join(', ')}`);
      console.log(`      ISBN: ${book.isbn13 || 'N/A'}, Cover: ${book.coverUrl ? 'Yes' : 'No'}`);
    });
  } catch (error) {
    console.error('❌ enrichWithGoogleBooks failed:', error.message);
    return;
  }

  // Test 3: Full pipeline with genre prompt
  console.log('\n🚀 Test 3: Full pipeline with romantasy genre prompt');
  try {
    const romantasyPrompt = aiBookCurator.GENRE_PROMPTS.romantasy;
    // Modify prompt to only ask for 2 books for testing
    const limitedPrompt = romantasyPrompt.replace('List 50', 'List 2');
    console.log('   Using limited prompt (2 books)...');

    const result = await aiBookCurator.generateAndEnrich(limitedPrompt);
    console.log(`✅ Full pipeline completed: ${result.length} books enriched`);
    console.log('   Sample book:', {
      title: result[0]?.title,
      author: result[0]?.authors?.[0],
      hasCover: !!result[0]?.coverUrl,
      hasISBN: !!result[0]?.isbn13
    });
  } catch (error) {
    console.error('❌ Full pipeline failed:', error.message);
    return;
  }

  console.log('\n🎉 All tests completed successfully!');
}

// Run test
testAICurator().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});