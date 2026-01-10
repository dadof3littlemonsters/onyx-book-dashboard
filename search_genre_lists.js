#!/usr/bin/env node
require('dotenv').config();

async function searchLists(searchTerm) {
  const query = `
    query SearchLists {
      lists(
        where: { 
          _or: [
            { name: { _ilike: "%${searchTerm}%" } }
            { slug: { _ilike: "%${searchTerm}%" } }
          ]
        }
        limit: 20
      ) {
        id
        name
        slug
        list_books_aggregate {
          aggregate {
            count
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
    },
    body: JSON.stringify({ query })
  });

  return await response.json();
}

async function findGenreLists() {
  const genres = ['fantasy', 'romantasy', 'sci-fi', 'science fiction', 'cozy', 'romance', 'dystopian'];
  
  console.log('\n🔍 SEARCHING FOR GENRE LISTS\n');
  console.log('='.repeat(80));
  
  for (const genre of genres) {
    console.log(`\n📚 Searching: "${genre}"`);
    const data = await searchLists(genre);
    
    if (data.data?.lists && data.data.lists.length > 0) {
      data.data.lists.forEach(list => {
        const count = list.list_books_aggregate?.aggregate?.count || 0;
        console.log(`  ✅ "${list.slug}" - ${list.name} (${count} books)`);
      });
    } else {
      console.log(`  ❌ No lists found`);
    }
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

findGenreLists().catch(console.error);
