#!/usr/bin/env node
require('dotenv').config();

async function getAllListsWithCounts() {
  const query = `
    query { 
      lists(limit: 200) { 
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
  
  const data = await response.json();
  
  if (data.data?.lists) {
    const lists = data.data.lists
      .map(l => ({
        slug: l.slug,
        name: l.name,
        count: l.list_books_aggregate?.aggregate?.count || 0
      }))
      .filter(l => l.count > 0)
      .sort((a, b) => b.count - a.count);
    
    console.log(`\n📚 Found ${lists.length} lists with books\n`);
    console.log('='.repeat(80));
    
    lists.forEach(l => {
      console.log(`${l.count.toString().padStart(5)} books | "${l.slug}" - ${l.name}`);
    });
    
    console.log('\n' + '='.repeat(80));
  }
}

getAllListsWithCounts().catch(console.error);
