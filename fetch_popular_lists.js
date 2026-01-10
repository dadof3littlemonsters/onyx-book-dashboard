#!/usr/bin/env node
require('dotenv').config();

async function getPopularLists() {
  // This worked before - simple query, no complex filtering
  const query = `{ lists(limit: 100) { id name slug } }`;

  const response = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.HARDCOVER_TOKEN}`,
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  
  if (!data.data?.lists) {
    console.log('Error:', data);
    return;
  }
  
  const lists = data.data.lists;
  
  console.log(`\n📚 Found ${lists.length} lists\n`);
  console.log('Genre-related lists:\n');
  
  // Filter by keywords
  const keywords = ['fantasy', 'romance', 'sci', 'science', 'cozy', 'dystopia', 'romantasy', 'fae', 'comfort', 'space', 'cyber'];
  
  lists.forEach(list => {
    const combined = `${list.name} ${list.slug}`.toLowerCase();
    const hasKeyword = keywords.some(k => combined.includes(k));
    
    if (hasKeyword) {
      console.log(`✅ slug: "${list.slug}"`);
      console.log(`   name: ${list.name}\n`);
    }
  });
}

getPopularLists().catch(console.error);
