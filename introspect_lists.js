#!/usr/bin/env node
require('dotenv').config();

async function introspectSchema() {
  // GraphQL introspection query to see the actual schema
  const query = `
    query IntrospectionQuery {
      __type(name: "list") {
        name
        fields {
          name
          type {
            name
            kind
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
    console.log(JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

introspectSchema();
