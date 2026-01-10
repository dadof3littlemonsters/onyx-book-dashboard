#!/usr/bin/env node
require('dotenv').config();

async function discoverAllLists() {
  // Query to get ALL public lists
  const query = `
    query GetAllLists {
      lists(limit: 100, order_by: { list_books_aggregate: { count: desc } }) {
        id
        name
        slug
        description
        list_books_aggregate {
          aggregate {
            count
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
        'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    
    if (data.errors) {
      console.error('❌ GraphQL Errors:', JSON.stringify(data.errors, null, 2));
      return;
    }
    
    if (!data.data?.lists) {
      console.log('⚠️  No lists found');
      console.log('Response:', JSON.stringify(data, null, 2));
      return;
    }

    const lists = data.data.lists;
    
    console.log(`\n🎉 Found ${lists.length} lists on Hardcover!\n`);
    console.log('='.repeat(80));
    
    // Group by potential genre keywords
    const genres = {
      romantasy: [],
      fantasy: [],
      scifi: [],
      dystopian: [],
      cozy: [],
      romance: [],
      other: []
    };
    
    lists.forEach(list => {
      const bookCount = list.list_books_aggregate?.aggregate?.count || 0;
      if (bookCount === 0) return; // Skip empty lists
      
      const lowerName = list.name.toLowerCase();
      const lowerSlug = list.slug.toLowerCase();
      const lowerDesc = (list.description || '').toLowerCase();
      const combined = `${lowerName} ${lowerSlug} ${lowerDesc}`;
      
      const listInfo = {
        name: list.name,
        slug: list.slug,
        books: bookCount,
        desc: list.description?.substring(0, 60) || ''
      };
      
      if (combined.includes('romantasy') || combined.includes('fae') || combined.includes('fairy')) {
        genres.romantasy.push(listInfo);
      } else if (combined.includes('fantasy') && !combined.includes('sci')) {
        genres.fantasy.push(listInfo);
      } else if (combined.includes('sci-fi') || combined.includes('science fiction') || combined.includes('dystopian')) {
        genres.scifi.push(listInfo);
      } else if (combined.includes('cozy') || combined.includes('comfort')) {
        genres.cozy.push(listInfo);
      } else if (combined.includes('romance') && !combined.includes('fantasy')) {
        genres.romance.push(listInfo);
      } else if (bookCount > 10) {
        genres.other.push(listInfo);
      }
    });
    
    // Print results grouped by genre
    for (const [genre, genreLists] of Object.entries(genres)) {
      if (genreLists.length === 0) continue;
      
      console.log(`\n📚 ${genre.toUpperCase()} (${genreLists.length} lists found):`);
      console.log('─'.repeat(80));
      
      genreLists.forEach(list => {
        console.log(`  ✅ "${list.slug}"`);
        console.log(`     Name: ${list.name}`);
        console.log(`     Books: ${list.books}`);
        if (list.desc) console.log(`     Desc: ${list.desc}...`);
        console.log('');
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('💡 TIP: Use these slugs in your GENRE_CONFIG');
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

discoverAllLists();
