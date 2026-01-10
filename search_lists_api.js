#!/usr/bin/env node
require('dotenv').config();

async function searchListsAPI(term) {
  const url = `https://api.hardcover.app/v1/search?type=list&query=${encodeURIComponent(term)}&limit=50`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
    }
  });

  return await response.json();
}

async function findLists() {
  const searches = ['fantasy', 'romance', 'sci-fi', 'cozy', 'dystopian', 'romantasy'];
  
  console.log('\n🔍 SEARCHING HARDCOVER LISTS\n');
  console.log('='.repeat(80));
  
  for (const term of searches) {
    console.log(`\n📚 "${term}":`);
    const data = await searchListsAPI(term);
    
    if (data.results && data.results.length > 0) {
      data.results.slice(0, 10).forEach(list => {
        console.log(`  ✅ slug: "${list.slug}" | ${list.name} (${list.books_count || 0} books)`);
      });
    } else {
      console.log(`  ❌ No results`);
    }
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

findLists().catch(console.error);
