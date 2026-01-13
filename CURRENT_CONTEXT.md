# Project Context: Onyx - AI Book Discovery & Library Management

**Last Updated:** 2026-01-13  
**Status:** Active Development  
**Primary Developer:** Craig (delboysden.uk)

---

## 🎯 Current Goal

Add AI-curated book recommendations to Onyx homepage so family members can discover books from the library without browsing 200+ titles manually.

**Target completion:** 2-3 weeks  
**Budget:** <$0.50/month for AI API calls

---

## ✅ What's Already Done

### Core Infrastructure
- ✅ Onyx frontend (Next.js) deployed and working
- ✅ Onyx backend (FastAPI) with API routing
- ✅ Audiobookshelf integration for library management
- ✅ Prowlarr + qBittorrent automation pipeline complete (not fully tested end-to-end)
- ✅ Traefik reverse proxy (Saltbox standard)
- ✅ Docker containerization for all services
- ✅ LibreChat installation with OpenRouter API integration

### Recent Work
- ✅ OpenRouter API setup and cost analysis completed
- ✅ DeepSeek API direct access configured with account credit
- ✅ Claude Code configuration with OpenRouter proxy working
- ✅ Model comparison analysis (DeepSeek, Grok, Claude pricing)
- ✅ Identified Aider as cost driver ($3+ in 3 days) - discontinued
- ✅ Context management system designed (manual + potential MCP)
- ✅ Project planning templates created

---

## 🚧 What's In Progress

### AI Recommendations Feature
- 🔨 Designing `/api/recommendations` endpoint architecture
- 🔨 Deciding on caching strategy (leaning toward SQLite)
- 🔨 Planning genre structure (12 genres including Romantasy, Fantasy, BookTok, Action & Adventure)
- 🔨 Will use DeepSeek API directly for generating recommendations

### Infrastructure Validation
- 🔨 Need to test Prowlarr → qBittorrent → Audiobookshelf library path flow end-to-end
- 🔨 Verify files end up in correct library directories

### Development Environment
- 🔨 Fine-tuning Claude Code with OpenRouter + direct DeepSeek API
- 🔨 Setting up context management workflow across ChatGPT/Gemini/Claude

---

## ❌ What's Explicitly NOT Being Done

- ❌ NOT building user accounts or authentication system
- ❌ NOT replacing Audiobookshelf's existing playback UI
- ❌ NOT adding social features or book sharing
- ❌ NOT building native Android/iOS apps (no app stores, no React Native)
- ✅ BUT: Web app will be fully responsive and mobile-friendly (works in mobile browsers)
- ❌ NOT integrating with Goodreads or external rating systems (out of scope for v1)
- ❌ NOT adding user feedback/rating features yet
- ❌ NOT building recommendation personalization (same suggestions for whole family)

---

## 🏗️ Technical Stack

### Primary Services
```
┌─────────────────────────────────────────────────────────────┐
│                    SALTBOX VPS (delboysden.uk)              │
│                                                               │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │ Audiobookshelf│◄────────┤    Onyx      │                  │
│  │   (Library)  │         │  Frontend    │                  │
│  │              │         │  (Next.js)   │                  │
│  └──────┬───────┘         └──────┬───────┘                  │
│         │                        │                           │
│         │                        ▼                           │
│         │                 ┌──────────────┐                  │
│         │                 │ Onyx Backend │                  │
│         └─────────────────┤   (FastAPI)  │                  │
│                           └──────┬───────┘                  │
│                                  │                           │
│                    ┌─────────────┼─────────────┐            │
│                    ▼             ▼             ▼            │
│            ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│            │ Discord  │  │ Prowlarr │  │qBittorrent        │
│            │   Bot    │  │          │  │          │        │
│            └──────────┘  └──────────┘  └──────────┘        │
│                                                               │
└───────────────────────────────────────────────────────────┘
                           │
                           │ External APIs
                           ▼
                    ┌──────────────┐
                    │  OpenRouter  │
                    │  (AI Models) │
                    └──────────────┘
```

### Technology Details

**Frontend:**
- Next.js 14 (App Router)
- React with TypeScript
- Tailwind CSS for styling
- Deployed via Docker

**Backend:**
- FastAPI (Python 3.11+)
- SQLite for caching (to be implemented)
- Pydantic models for validation
- Async/await patterns

**Infrastructure:**
- Saltbox VPS (Ubuntu 24.04)
- Docker + Docker Compose
- Traefik reverse proxy (Saltbox standard)
- systemd for service management

**Integrations:**
- Audiobookshelf API (authenticated)
- OpenRouter API (multi-model access)
- DeepSeek API (direct access with account credit)
- Prowlarr API
- qBittorrent API

**Development Tools:**
- Claude Code (with OpenRouter proxy + direct DeepSeek API)
- ChatGPT Pro subscription ($20/month)
- Gemini Pro (student annual)
- Git for version control

---

## 🔑 Key Technical Decisions

### Decision: Use OpenRouter instead of direct Anthropic API
**Reasoning:** Access to cheaper models (DeepSeek $0.003/req vs Claude Sonnet $0.044/req = 15x cost savings)  
**Made on:** 2026-01-13  
**Impact:** Enables budget-conscious development without sacrificing quality

### Decision: SQLite for recommendation caching
**Reasoning:** Simple, no extra infrastructure needed, fast enough for single-family use, already familiar  
**Made on:** 2026-01-13 (planned)  
**Alternative considered:** Redis (rejected as overkill for this scale)

### Decision: 24-hour cache TTL for recommendations
**Reasoning:** Balance between freshness and API costs. Daily refresh prevents repetition without excessive API calls  
**Target cost:** ~$0.15/month (50 API calls/day at $0.003 each)  
**Made on:** 2026-01-13 (planned)

### Decision: DeepSeek V3 as primary AI model for recommendations
**Reasoning:** 
- Direct API access with existing account credit
- Extremely cost-effective for production use
- Proven quality in actual usage (56 successful Aider requests)
- Can be used via OpenRouter OR direct API
- Will be used to generate AI book recommendations
**Made on:** 2026-01-13  
**Alternatives:** 
- Grok Code Fast 1 via OpenRouter: $0.003-0.005/request, optimized for coding
- Claude Haiku via OpenRouter: $0.002/request fallback when Claude quality needed  

### Decision: Manual context management system over MCP memory
**Reasoning:** 
- MCP memory servers only work with Claude models (defeats cost optimization)
- Manual CURRENT_CONTEXT.md works across all AI tools (ChatGPT, Gemini, Claude)
- Portable, zero infrastructure, 5 min maintenance/session acceptable
- Can be synced to any AI platform
**Made on:** 2026-01-13  

### Decision: Discontinue Aider, use Claude Code instead
**Reasoning:** Aider cost $3 in 3 days due to massive context windows (250k tokens/request). Claude Code with cheaper models more cost-effective  
**Made on:** 2026-01-13 after cost analysis

---

## 🐛 Known Issues/Blockers

### Critical Gaps

1. **No end-to-end testing of download-to-library pipeline**
   - **Issue:** Prowlarr + qBittorrent automation exists but not verified that files land in correct Audiobookshelf library paths
   - **Status:** UNTESTED - needs full workflow validation
   - **Risk:** May need path configuration or post-processing
   - **Priority:** HIGH - must verify before considering automation "complete"

### Active Issues

1. **OpenRouter usage analysis showed unexpectedly high costs**
   - **Root cause:** Aider sending 250k+ token contexts repeatedly
   - **Status:** RESOLVED - discontinued Aider
   - **Solution:** Using Claude Code with smaller, targeted requests

2. **Claude Code .bashrc configuration corruption**
   - **Issue:** Setup attempt broke existing bash configuration
   - **Status:** RESOLVED - reconfigured
   - **Learning:** Be careful with automated config modifications

3. **MCP memory servers incompatible with non-Anthropic models**
   - **Issue:** Want persistent memory but using DeepSeek/Grok for cost
   - **Status:** ACKNOWLEDGED - using manual context system instead
   - **Future:** May revisit when using Claude models more frequently

### Historical Issues (Resolved)
- ✅ Audiobookshelf API fetching issues (pagination)
- ✅ Cover image proxy 404 errors (now working)
- ✅ Discord bot command routing
- ✅ LibreChat OpenRouter integration

---

## 📁 Project Structure

```
onyx/
├── frontend/              # Next.js application
│   ├── app/
│   │   ├── page.tsx      # Homepage (recommendations go here)
│   │   └── api/          # API routes
│   └── components/
│       └── RecommendationCard.tsx  # To be created
│
├── backend/               # FastAPI application
│   ├── main.py           # Main app entry
│   ├── routes/
│   │   └── recommendations.py  # NEW: AI recommendations endpoint
│   ├── services/
│   │   ├── audiobookshelf.py   # ABS API client
│   │   └── openrouter.py       # NEW: AI integration
│   └── cache/
│       └── sqlite_cache.py     # NEW: Caching layer
│
├── discord_bot/           # Separate Discord bot service
│   └── bot.py
│
└── .claude/
    └── context.md        # Project context for Claude Code
```

---

## 💰 Cost Analysis

### Current Monthly Costs
| Service | Cost | Purpose |
|---------|------|---------|
| VPS Hosting | ~$? | Runs all services |
| ChatGPT Pro | $20 | Planning/debugging |
| Gemini Pro | ~$0 | Student annual sub |
| Claude Pro | $20 | Trial (discontinuing) |
| OpenRouter API | $5-10 (target) | AI recommendations + dev |
| **Total** | **~$45-50** | |

### Cost Optimization Achieved
- **Before:** $4 in 3 days using Aider (~$40/month)
- **After:** $0.21/day using Claude Code with DeepSeek (~$6/month)
- **Savings:** ~$34/month (85% reduction)

### AI Recommendations Budget
- Target: $0.50/month (or use existing DeepSeek account credit)
- Calculation: 50 recommendations/day × 30 days × $0.003 = $4.50
- With caching: 3-5 API calls/day × 30 days × $0.003 = $0.27-0.45 ✅
- **Note:** Using direct DeepSeek API (account has existing credit)

---

## 💡 Ideas Parking Lot (Future Enhancements)

### Mentioned/Discussed But Not Implemented
- Email-to-Kindle feature for ebook delivery
- Discord bot for book requests (old version abandoned, may revisit)

### Other Future Ideas

- Add "thumbs up/down" feedback on recommendations
- Email weekly digest of new recommendations
- Integration with Goodreads ratings
- Seasonal recommendations (Christmas books in December)
- User profiles with individual preferences
- "Continue reading" section based on progress
- Book series detection and suggestions
- Author deep-dive features
- Reading statistics and insights

---

## 📝 Recent Session Notes

### 2026-01-13 - Cost Analysis & Planning Session (Claude)
**Discussed:** 
- OpenRouter usage analysis revealed Aider as cost driver
- Model comparison: DeepSeek, Grok, Qwen, Claude pricing
- MCP memory servers vs manual context management
- Architecture planning for AI recommendations

**Decided:** 
- Discontinue Aider, use Claude Code with DeepSeek/Grok
- Manual CURRENT_CONTEXT.md system for cross-platform context
- SQLite caching with 24h TTL for recommendations
- Budget target: <$0.50/month for recommendations feature

**Completed:**
- Context extraction system designed and implemented
- Planning templates created
- Cost optimization strategy defined

**Next:** 
- Implement `/api/recommendations` endpoint
- Set up SQLite cache
- Test with real Audiobookshelf data

---

## 🎯 Implementation Plan (Next Steps)

### Phase 1: Basic Recommendation Endpoint (Week 1)
- [ ] Create `/api/recommendations` FastAPI endpoint
- [ ] Integrate Audiobookshelf API to fetch library
- [ ] Send book list to DeepSeek API (direct, not via OpenRouter)
- [ ] Return 5 recommendations as JSON
- [ ] Test manually with curl

**Definition of Done:** Can curl endpoint and get 5 book titles back

### Phase 2: Frontend Integration (Week 1-2)
- [ ] Create RecommendationCard component (mobile-responsive)
- [ ] Fetch from backend on homepage load
- [ ] Display with Audiobookshelf covers
- [ ] Add loading states and error handling
- [ ] Test on mobile browsers (primary use case)
- [ ] WAF test with wife (on her phone)

**Definition of Done:** Homepage shows recommendations on desktop AND mobile without breaking

### Phase 3: Caching & Multi-Genre (Week 2-3)
- [ ] Implement SQLite cache with 24h TTL
- [ ] Add genre parameter support (12 genres)
- [ ] Add randomization to prevent repetition
- [ ] Update frontend for multiple genre sections
- [ ] Cost monitoring

**Definition of Done:** All genres work, cache prevents duplicate API calls, cost <$0.50/month

### Phase 4: Production Polish (Week 3)
- [ ] Add comprehensive error handling
- [ ] Implement fallback behavior
- [ ] Add logging and monitoring
- [ ] Test with full library (200+ books)
- [ ] Deploy and monitor for 3 days

**Definition of Done:** Runs for 3 days without issues, family uses it successfully

---

## 🔗 Important Links

- **Production:** https://delboysden.uk
- **Audiobookshelf:** https://audiobookshelf.delboysden.uk
- **OpenRouter Dashboard:** https://openrouter.ai/activity
- **LibreChat:** [local deployment]

**Documentation:**
- Audiobookshelf API: https://api.audiobookshelf.org
- OpenRouter Models: https://openrouter.ai/models
- FastAPI Docs: https://fastapi.tiangolo.com
- Next.js Docs: https://nextjs.org/docs

---

## 👤 Personal Context & Preferences

**Craig's Working Style:**
- Learn by doing, not extensive reading
- Prefers practical, working code over "perfect" architecture
- Incremental progress over big rewrites
- Budget-conscious (favors $0.003/req models over $0.04/req)
- WAF (Wife Acceptance Factor) is critical - family usability matters

**Preferred Reading:**
- Epic fantasy (long series)
- Action & Adventure as palate cleanser
- Authors: RR Haywood, Mark Tufo, Jim Butcher, Ben Aaronovitch
- Style: Fast-paced, contemporary fantasy/sci-fi with humor

**Development Approach:**
- Uses multiple AI platforms (ChatGPT, Gemini, Claude)
- Claude Code + OpenRouter for implementation
- Maintains git version control
- Saltbox VPS for all infrastructure
- Docker for service isolation

---

## 🎯 For AI Assistants Reading This

**When helping Craig:**
1. ✅ Respect technical decisions already made (don't suggest changing stack)
2. ✅ Focus on current goal and what's in progress
3. ✅ Don't suggest anything in "NOT Being Done" list
4. ✅ Understand WAF is a real constraint, not a joke
5. ✅ Budget matters - always consider cost implications
6. ✅ Provide working code examples, not just theory
7. ✅ Break complex tasks into concrete, testable steps

**Craig's knowledge level:**
- ✅ Expert: Docker, systemd, Linux admin, networking, API integration
- ✅ Strong: Python, FastAPI, JavaScript, React basics
- 🟡 Developing: Next.js App Router, TypeScript, frontend state management
- 🔴 Learning: AI integration patterns, prompt engineering, cost optimization

---

**Last major update:** 2026-01-13 - Cost analysis and planning session  
**Next review:** After Phase 1 completion (recommendation endpoint working)
