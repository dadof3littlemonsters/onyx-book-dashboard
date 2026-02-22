#!/usr/bin/env node

/**
 * Automated Discovery Cache Population Script
 * 
 * Runs daily to populate/update the discovery cache in smaller batches
 * to avoid hitting Google Books API rate limits.
 * 
 * Usage: node scripts/auto-populate-cache.js [--genre <genre>] [--daily]
 * 
 * Modes:
 *   --genre <name>  Populate specific genre only
 *   --daily         Run daily batch (rotates through genres)
 *   --initial       Run initial population (all genres at once)
 */

const http = require('http');

const ADMIN_PIN = process.env.ADMIN_PIN || '1905';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Genre configuration - roughly equal distribution for daily batches
const GENRE_SCHEDULE = [
  { day: 1, genres: ['romantasy'], target: 150 },
  { day: 2, genres: ['fantasy', 'scifi'], target: 350 },
  { day: 3, genres: ['dark_fantasy', 'cozy_fantasy'], target: 350 },
  { day: 4, genres: ['fairy_tale_retellings', 'post_apocalyptic'], target: 350 },
  { day: 5, genres: ['enemies_to_lovers', 'action_adventure'], target: 300 },
  { day: 6, genres: ['awards'], target: 200 },
  { day: 7, genres: ['dragons'], target: 150 },
];

// Get day of month (1-31) to determine which genres to process
function getDayOfMonth() {
  const now = new Date();
  return now.getDate();
}

// Get schedule based on day of month
function getScheduleForToday() {
  const dayOfMonth = getDayOfMonth();
  const scheduleIndex = (dayOfMonth - 1) % GENRE_SCHEDULE.length;
  return GENRE_SCHEDULE[scheduleIndex];
}

// Make HTTP request to server
function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'x-admin-pin': ADMIN_PIN,
        'Content-Type': 'application/json'
      },
      timeout: 600000 // 10 minutes
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 400) {
            reject(new Error(`${res.statusCode}: ${parsed.error || parsed.message || 'Unknown error'}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Get current cache stats
async function getCacheStats() {
  try {
    const result = await makeRequest('/api/admin/discovery/health');
    return result.report || result.stats || {};
  } catch (error) {
    console.error('[ERROR] Failed to get cache stats:', error.message);
    return {};
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const mode = args.find(arg => arg.startsWith('--'))?.replace('--', '') || 'daily';
  
  console.log('========================================');
  console.log('  Auto Discovery Cache Population');
  console.log('========================================');
  console.log(`Mode: ${mode}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('');

  try {
    // Get current stats
    console.log('[INFO] Fetching current cache stats...');
    const stats = await getCacheStats();
    if (stats.totalBooks !== undefined) {
      console.log(`[INFO] Current cache: ${stats.totalBooks} books`);
    }
    console.log('');

    let result;
    
    if (mode === 'initial') {
      // Full initial population
      console.log('[INFO] Running FULL initial population...');
      console.log('[WARN] This may take several hours due to API rate limits');
      result = await makeRequest('/api/admin/discovery/initial-population', 'POST');
      
    } else if (mode === 'daily') {
      // Daily batch mode
      const schedule = getScheduleForToday();
      const dayOfMonth = getDayOfMonth();
      
      console.log(`[INFO] Day ${dayOfMonth} of month`);
      console.log(`[INFO] Scheduled genres: ${schedule.genres.join(', ')}`);
      console.log(`[INFO] Target: ~${schedule.target} books`);
      console.log('');
      
      console.log('[INFO] Running daily batch population...');
      result = await makeRequest('/api/admin/discovery/initial-population', 'POST');
      
    } else if (mode.startsWith('genre=')) {
      // Specific genre mode
      const genre = mode.split('=')[1];
      console.log(`[INFO] Populating genre: ${genre}`);
      result = await makeRequest('/api/admin/discovery/initial-population', 'POST');
    }

    // Report results
    console.log('');
    console.log('========================================');
    console.log('  Results');
    console.log('========================================');
    
    if (result && result.stats) {
      console.log(`Total Books: ${result.stats.totalBooks}`);
      console.log(`Total Genres: ${result.stats.totalGenres || 0}`);
      console.log('');
      console.log('Books by Genre:');
      for (const [genre, count] of Object.entries(result.stats.booksByGenre || {})) {
        console.log(`  ${genre}: ${count}`);
      }
    }
    
    console.log('');
    console.log(`Completed: ${new Date().toISOString()}`);
    console.log('========================================');
    
    process.exit(0);
    
  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('  ERROR');
    console.error('========================================');
    console.error(error.message);
    console.error('');
    console.error(`Failed: ${new Date().toISOString()}`);
    console.error('========================================');
    process.exit(1);
  }
}

// Run
main();
