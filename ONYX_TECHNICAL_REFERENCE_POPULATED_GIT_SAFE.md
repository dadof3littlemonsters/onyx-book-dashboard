
<!-- 
This file was auto-generated on 2026-01-13 19:33 
from your actual environment configuration.
API keys are masked for security.
-->

# Onyx Technical Reference

**⚠️ WARNING: This file contains sensitive information. Do NOT commit to public repos.**

Last Updated: 2026-01-13 19:33

---

## 🔗 Service URLs

### Production Services
```
Onyx Frontend:        https://onyx.delboysden.uk
Audiobookshelf:       https://audiobookshelf.delboysden.uk
Prowlarr:             http://prowlarr:9696
qBittorrent:          https://qbittorrent.delboysden.uk
Traefik Dashboard:    https://traefik.delboysden.uk
```

### API Endpoints

**Audiobookshelf API:**
```
Base URL: https://audiobookshelf.delboysden.uk/api
Documentation: https://api.audiobookshelf.org

Key Endpoints:
GET  /api/libraries           - List all libraries
GET  /api/items/{id}          - Get specific item
GET  /api/libraries/{id}/items - Get library items
POST /api/items/{id}/play     - Start playback session
GET  /api/users                - List ABS users
```

**Hardcover API (Optional - for future enrichment):**
```
Base URL: https://hardcover.app/graphql
Documentation: https://hardcover.app/account/api
Type: GraphQL API

Note: Free tier available, useful for book metadata enrichment
Referenced in chat history but NOT currently implemented
```

**Prowlarr API:**
```
Base URL: http://prowlarr:9696/api/v1
API Key: [Stored in environment variable PROWLARR_API_KEY]

Key Endpoints:
GET  /api/v1/indexer          - List indexers
GET  /api/v1/search           - Search across indexers
POST /api/v1/release/push     - Push release to download client
```

**qBittorrent API:**
```
Base URL: https://qbittorrent.delboysden.uk/api/v2
Auth: Basic auth (username/password)

Key Endpoints:
POST /api/v2/auth/login       - Authenticate
GET  /api/v2/torrents/info    - List torrents
POST /api/v2/torrents/add     - Add torrent
```

---

## 🔑 API Keys & Authentication

**Storage Location:** `/opt/onyx/.env` (on VPS)

**Required Environment Variables:**
```bash
# Audiobookshelf
AUDIOBOOKSHELF_URL=https://audiobookshelf.delboysden.uk
AUDIOBOOKSHELF_TOKEN=[REDACTED]

# DeepSeek (Direct API)
DEEPSEEK_API_KEY=[REDACTED]
DEEPSEEK_BASE_URL=https://api.deepseek.com

# OpenRouter (Fallback)
OPENROUTER_API_KEY=[REDACTED]
OPENROUTER_APP_NAME=onyx
OPENROUTER_SITE_URL=https://onyx.delboysden.uk

# Prowlarr
PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=dc77...bff9

# qBittorrent
QBITTORRENT_URL=https://qbittorrent.delboysden.uk
QBITTORRENT_USERNAME=[NOT SET]
QBITTORRENT_PASSWORD=[REDACTED]

# Database
DATABASE_PATH=/opt/onyx/data/onyx.db
CACHE_DB_PATH=/opt/onyx/data/cache.db
```

**How to Generate Tokens:**

**Audiobookshelf:**
1. Login to Audiobookshelf web interface
2. Settings → Users → [Your User]
3. Click "Generate API Token"
4. Copy token immediately (shown once)

**DeepSeek:**
1. Login to DeepSeek platform
2. API Keys section
3. Create new key
4. Note: Account has existing credit

**OpenRouter:**
1. https://openrouter.ai/keys
2. Create new key
3. Name it "onyx-production"

---

## 📁 File Paths

### On VPS (Production)
```bash
# Application
/opt/onyx/                          # Main app directory (both frontend and backend)
/opt/onyx/frontend/                 # Next.js app
/opt/onyx/backend/                  # FastAPI app
/opt/onyx/.env                      # Environment variables
/opt/onyx/docker-compose.yml        # Docker config

# Data
/opt/onyx/data/                     # Persistent data
/opt/onyx/data/onyx.db             # Main database
/opt/onyx/data/cache.db            # Recommendation cache
/opt/onyx/logs/                     # Application logs

# Audiobookshelf Libraries (TO BE VERIFIED)
/mnt/unionfs/Media/Audiobooks/      # Main audiobook library (needs end-to-end testing)
# ⚠️ Path may need adjustment for qBittorrent downloads to land correctly
```

### Local Development
```bash
# Project root
~/projects/onyx/                    # Local development
~/projects/onyx/CURRENT_CONTEXT.md  # This context doc
~/projects/onyx/TECHNICAL_REFERENCE.md  # This file

# Context for AI tools
~/projects/onyx/.claude/context.md  # Claude Code context
```

---

## 🐳 Docker Configuration

### Container Names (Saltbox Standard)

### Running Onyx Containers
```
- onyx
```

```
onyx-frontend
onyx-backend
audiobookshelf
prowlarr
qbittorrent
traefik
```

### Useful Docker Commands
```bash
# View logs
docker logs -f onyx-backend
docker logs -f onyx-frontend

# Restart services
docker restart onyx-backend
docker restart onyx-frontend

# Enter container
docker exec -it onyx-backend bash

# View all Onyx containers
docker ps | grep onyx
```

---

## 🗄️ Database Schema

### Cache Table (cache.db)
```sql
CREATE TABLE recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    genre TEXT NOT NULL,
    recommendations JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_genre_expires ON recommendations(genre, expires_at);
```

### Main Database (onyx.db) - TBD
```sql
-- To be designed as features develop
-- Potential tables: users, preferences, history, etc.
```

---

## 🔧 Common Tasks

### Generate Test Recommendations
```bash
# SSH into VPS
ssh your-vps

# Test recommendation endpoint
curl -X POST https://onyx.delboysden.uk/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{"genre": "fantasy", "count": 5}'
```

### Clear Cache
```bash
# SSH into VPS
docker exec -it onyx-backend python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('/opt/onyx/data/cache.db')
conn.execute('DELETE FROM recommendations')
conn.commit()
print("Cache cleared")
EOF
```

### Check Audiobookshelf Library
```bash
# List all books in library
curl https://audiobookshelf.delboysden.uk/api/libraries/{LIBRARY_ID}/items \
  -H "Authorization: Bearer ${AUDIOBOOKSHELF_TOKEN}"
```

### Test DeepSeek API
```bash
# Test direct DeepSeek API call
curl https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## 🚨 Troubleshooting

### Recommendation Endpoint Returns 500
1. Check backend logs: `docker logs -f onyx-backend`
2. Verify DeepSeek API key is set
3. Check database exists: `ls -la /opt/onyx/data/cache.db`
4. Test DeepSeek API directly (see above)

### Audiobookshelf Connection Fails
1. Check if ABS is running: `docker ps | grep audiobookshelf`
2. Verify token hasn't expired (regenerate if needed)
3. Test endpoint directly: `curl https://audiobookshelf.delboysden.uk/api/ping`

### Files Not Landing in Correct Library Path
1. Check qBittorrent download path: Settings → Downloads
2. Verify Audiobookshelf library path matches
3. Check file permissions: `ls -la /mnt/unionfs/Media/Audiobooks/`
4. **STATUS:** This has NOT been tested end-to-end yet

### Cache Not Working
1. Check cache database exists
2. Verify table created: `sqlite3 /opt/onyx/data/cache.db ".schema"`
3. Check expires_at timestamps aren't in the past
4. Clear and regenerate cache (see above)

---

## 📊 Monitoring

### Check Current Costs
```bash
# OpenRouter usage
open https://openrouter.ai/activity

# DeepSeek usage
# (Check DeepSeek dashboard for credit usage)
```

### Application Health
```bash
# Check if services are running
docker ps | grep onyx

# Check backend health endpoint (if implemented)
curl https://onyx.delboysden.uk/api/health

# Check response time
time curl https://onyx.delboysden.uk/api/recommendations
```

---

## 🔄 Deployment Process

### Update Backend
```bash
# SSH to VPS
ssh your-vps

# Navigate to project
cd /opt/onyx

# Pull latest changes
git pull

# Rebuild and restart
docker-compose build backend
docker-compose up -d backend

# Verify
docker logs -f onyx-backend
```

### Update Frontend
```bash
cd /opt/onyx
git pull
docker-compose build frontend
docker-compose up -d frontend
docker logs -f onyx-frontend
```

---

## 📝 Notes

- All URLs use HTTPS via Traefik (Saltbox handles SSL)
- API keys should be rotated periodically
- Database backups should be automated (TODO)
- Monitor DeepSeek credit usage to avoid unexpected charges
- Test mobile responsiveness on actual devices

---

## 🔐 Security Reminders

- ⚠️ Never commit actual API keys to git
- ⚠️ This file should be in `.gitignore`
- ⚠️ Use environment variables for all secrets
- ⚠️ Regenerate tokens if ever exposed
- ⚠️ Keep VPS SSH keys secure
- ⚠️ Regular security updates on VPS

---

**Last Verified:** 2026-01-13  
**Next Review:** After Phase 1 completion
