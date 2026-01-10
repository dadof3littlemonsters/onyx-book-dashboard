#!/usr/bin/env node
// Hardcover API Diagnostic Script
// Run this on your server to diagnose the exact problem

require('dotenv').config();
const https = require('https');

const HARDCOVER_TOKEN = process.env.HARDCOVER_TOKEN;

if (!HARDCOVER_TOKEN) {
  console.error('❌ HARDCOVER_TOKEN not set in environment!');
  process.exit(1);
}

console.log('🔍 Hardcover API Diagnostic');
console.log('===========================\n');
console.log('Token (first 10 chars):', HARDCOVER_TOKEN.substring(0, 10) + '...');
console.log('Token length:', HARDCOVER_TOKEN.length);
console.log('\n');

// Test 1: Simple introspection query
async function test1_Introspection() {
  console.log('📋 Test 1: Introspection (Check API access)');
  console.log('─────────────────────────────────────────────');
  
  const query = `
    query {
      __schema {
        queryType {
          name
        }
      }
    }
  `;

  return makeRequest(query, {});
}

// Test 2: Simple books query (no filters)
async function test2_SimpleBooks() {
  console.log('\n📚 Test 2: Simple Books Query (Top 5)');
  console.log('──────────────────────────────────────');
  
  const query = `
    query {
      books(limit: 5) {
        id
        title
        contributions {
          author {
            name
          }
        }
      }
    }
  `;

  return makeRequest(query, {});
}

// Test 3: Search with ILIKE (your current approach)
async function test3_SearchILike() {
  console.log('\n🔎 Test 3: Search with _ilike (SQL-style)');
  console.log('──────────────────────────────────────────────');
  
  const query = `
    query SearchBooks($search: String!) {
      books(
        where: {
          title: {
            _ilike: $search
          }
        }
        limit: 5
      ) {
        id
        title
        contributions {
          author {
            name
          }
        }
      }
    }
  `;

  return makeRequest(query, { search: '%fantasy%' });
}

// Test 4: Alternative search approach
async function test4_SearchContains() {
  console.log('\n🔎 Test 4: Search with contains (if _ilike fails)');
  console.log('────────────────────────────────────────────────');
  
  const query = `
    query SearchBooks($search: String!) {
      books(
        where: {
          title: {
            contains: $search
          }
        }
        limit: 5
      ) {
        id
        title
        contributions {
          author {
            name
          }
        }
      }
    }
  `;

  return makeRequest(query, { search: 'fantasy' });
}

// Test 5: Me query (authentication check)
async function test5_Authentication() {
  console.log('\n🔐 Test 5: Authentication Check (me query)');
  console.log('───────────────────────────────────────────');
  
  const query = `
    query {
      me {
        id
        username
        email
      }
    }
  `;

  return makeRequest(query, {});
}

function makeRequest(query, variables) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    
    const options = {
      hostname: 'api.hardcover.app',
      port: 443,
      path: '/v1/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HARDCOVER_TOKEN}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        
        if (res.statusCode !== 200) {
          console.log('❌ HTTP Error:', res.statusCode);
          console.log('Response:', data);
          resolve({ success: false, statusCode: res.statusCode, body: data });
          return;
        }

        try {
          const parsed = JSON.parse(data);
          
          if (parsed.errors) {
            console.log('❌ GraphQL Errors:');
            parsed.errors.forEach((err, i) => {
              console.log(`   ${i + 1}. ${err.message}`);
              if (err.extensions) {
                console.log('      Extensions:', JSON.stringify(err.extensions, null, 2));
              }
            });
            resolve({ success: false, errors: parsed.errors });
          } else {
            console.log('✅ Success!');
            if (parsed.data) {
              const keys = Object.keys(parsed.data);
              console.log('Data keys:', keys.join(', '));
              
              // Show first result if it's a books array
              if (parsed.data.books && Array.isArray(parsed.data.books)) {
                console.log(`Found ${parsed.data.books.length} books`);
                if (parsed.data.books[0]) {
                  console.log('First book:', parsed.data.books[0].title);
                }
              }
              
              // Show me data if present
              if (parsed.data.me) {
                console.log('User:', parsed.data.me.username || parsed.data.me.id);
              }
            }
            resolve({ success: true, data: parsed.data });
          }
        } catch (e) {
          console.log('❌ Failed to parse response as JSON');
          console.log('Raw response:', data.substring(0, 500));
          resolve({ success: false, parseError: e.message, body: data });
        }
      });
    });

    req.on('error', (e) => {
      console.log('❌ Request Error:', e.message);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

async function runAllTests() {
  try {
    await test5_Authentication();
    await test1_Introspection();
    await test2_SimpleBooks();
    await test3_SearchILike();
    await test4_SearchContains();
    
    console.log('\n═══════════════════════════════════════════');
    console.log('✅ Diagnostic Complete');
    console.log('═══════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    process.exit(1);
  }
}

runAllTests();
