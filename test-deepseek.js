#!/usr/bin/env node

// Test script for DeepSeek API integration
// Based on planning.txt lines 1410-1426

require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY is not set in .env file');
  process.exit(1);
}

const prompt = 'List 10 popular romantasy books from 2023-2025. Return ONLY valid JSON: [{"title":"...","author":"..."}]';

async function testDeepSeekAPI() {
  console.log('🚀 Testing DeepSeek API connection...');
  console.log(`📝 Prompt: ${prompt.substring(0, 80)}...`);
  console.log(`🔑 API Key: ${DEEPSEEK_API_KEY.substring(0, 8)}...`);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ API Response received successfully');
    console.log(`📊 Model: ${data.model}`);
    console.log(`📝 Usage: ${JSON.stringify(data.usage)}`);

    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    console.log('📦 Raw response content:');
    console.log(content);

    // Parse JSON from response (strip markdown backticks if present)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.substring(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }

    const bookList = JSON.parse(jsonStr);
    console.log('✅ Successfully parsed JSON response');
    console.log(`📚 Found ${bookList.length} books:`);

    bookList.forEach((book, index) => {
      console.log(`  ${index + 1}. "${book.title}" by ${book.author}`);
    });

    console.log('\n🎉 DeepSeek API test completed successfully!');
    return bookList;

  } catch (error) {
    console.error('❌ DeepSeek API test failed:');
    console.error(error.message);
    if (error instanceof SyntaxError) {
      console.error('Failed to parse JSON response. Check the raw content above.');
    }
    process.exit(1);
  }
}

// Run the test
testDeepSeekAPI();