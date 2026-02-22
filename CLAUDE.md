# CLAUDE.md

## Repository Audit Overview (Onyx)

This document is a comprehensive audit summary of `/opt/onyx` based on a full working-tree review (excluding `.git` internals only), including source code, scripts, Docker/runtime configuration, hidden project metadata directories, docs, and runtime data/cache files.

Scope of this audit intentionally includes:
- Backend (`/opt/onyx/server`)
- Frontend (`/opt/onyx/client/src`)
- Ops/runtime scripts (`/opt/onyx/scripts`, `/opt/onyx/*.sh`, systemd units)
- Configuration (`/opt/onyx/.env*`, Docker, Compose, package manifests)
- Runtime data/cache state (`/opt/onyx/data/*.json`)
- Hidden project metadata (`/opt/onyx/.claude*`, `/opt/onyx/.agent`)
- Docs and planning artifacts
- Generated build artifacts and backups present in the working tree

No secret values are reproduced in this file.

---

## 1) What Onyx Is (Current Functional Model)

Onyx is a self-hosted audiobook/ebook request and acquisition system with:
- A React frontend for browsing curated/discovered books and submitting requests
- An Express backend serving APIs and the built frontend
- JSON-file persistence for requests/history/cache/import logs
- Integration with qBittorrent + Prowlarr for torrent-based acquisition
- Integration with Telegram/Z-Library bot for direct download workflows
- Integration with Audiobookshelf for library status/ownership and scan triggers
- Multi-source metadata/cover enrichment (Google Books, Hardcover, Open Library, etc.)
- Goodreads shelf/list scraping and cache generation for discovery rows

At a high level, this is a "request + discovery + fulfillment + import + library sync" pipeline.

---

## 2) Tech Stack and Runtime

### Backend
- Node.js + Express (`/opt/onyx/server/index.js`)
- Axios for external APIs
- Cheerio for scraping (Goodreads)
- Telegram client library for Z-Library bot automation
- JSON file persistence via service layer (`/opt/onyx/server/services/dataStore.js`)

### Frontend
- React 18 (`/opt/onyx/client/package.json`)
- CRA / `react-scripts` 5 (`/opt/onyx/client/package.json`)
- `react-router-dom` and toast notifications
- Component-driven UI in `/opt/onyx/client/src/components`

### Deployment / Ops
- Docker image builds client + runs backend (`/opt/onyx/Dockerfile`)
- Docker Compose with Traefik labels (`/opt/onyx/docker-compose.yml`)
- Host mounts for data, downloads, and library paths
- Optional systemd timer/service for cache refresh (`/opt/onyx/systemd/onyx-cache-refresh.*`)

### Persistence / State
- Flat JSON files in `/opt/onyx/data`
  - `requests.json`
  - `history.json`
  - `import_log.json`
  - `book_metadata.json`
  - `discovery_cache.json`
  - `master_book_cache.json`

---

## 3) Architecture (End-to-End)

### 3.1 Frontend browsing flow
1. Frontend loads home page (`/opt/onyx/client/src/components/HomePage.js`)
2. It requests discovery rows from backend category endpoints (`/api/books/:category` in `/opt/onyx/server/index.js`)
3. Backend maps UI category -> discovery genre and returns randomized books from discovery cache
4. Backend overlays ownership information from local scanner / Audiobookshelf-related state (`/opt/onyx/server/scanner.js`)
5. Frontend renders rows (`/opt/onyx/client/src/components/BookRow.js`) and detail drawer (`/opt/onyx/client/src/components/BookDrawer.js`)
6. User can submit request (queue) from the UI

### 3.2 Discovery cache generation / enrichment flow
1. Goodreads scraper (`/opt/onyx/server/services/goodreadsShelfScraper.js`) scrapes shelves/lists for target genres
2. Google Books API (`/opt/onyx/server/services/googleBooksApi.js`) enriches metadata
3. Additional metadata and ratings may be resolved from Hardcover (`/opt/onyx/server/services/hardcoverService.js`)
4. Cover URLs are resolved through fallback chain (`/opt/onyx/server/services/coverResolver.js`)
5. Discovery cache and/or master cache services persist results:
   - `/opt/onyx/server/services/discoveryCache.js`
   - `/opt/onyx/server/services/masterBookCache.js`

### 3.3 Request/admin fulfillment flow
1. User request persisted via data store (`/opt/onyx/server/services/dataStore.js`)
2. Admin logs in with PIN (`/api/admin/login` in `/opt/onyx/server/index.js`)
3. Admin dashboard (`/opt/onyx/client/src/components/AdminDashboard.js`) can search providers
4. Backend searches Prowlarr (`/opt/onyx/server/services/prowlarr.js`) and/or Telegram/Z-Library (`/opt/onyx/server/services/telegram.js`)
5. Admin chooses a result; backend sends to qBittorrent or direct download path
6. Request status updates and history/import log are persisted

### 3.4 Download/import flow
1. qBittorrent completion or direct download produces a file in downloads path
2. Processor script `/opt/onyx/scripts/process-download.js` classifies media, parses filename, selects destination
3. It hardlinks (e.g., MAM tracker) or moves files depending on source/tracker
4. It triggers Audiobookshelf scan via `/opt/onyx/server/services/audiobookshelf.js`
5. Import result is appended to `/opt/onyx/data/import_log.json`

---

## 4) Major Components and Their Roles

### Backend entrypoint
- `/opt/onyx/server/index.js`
  - Express app setup, middleware, auth, API routing, service orchestration, cache/admin endpoints, static serving.
  - This is the operational center of the application.

### Core backend services
- `/opt/onyx/server/services/discoveryCache.js` — discovery row data generation and retrieval
- `/opt/onyx/server/services/masterBookCache.js` — consolidated book cache / dedupe / genre index
- `/opt/onyx/server/services/googleBooksApi.js` — Google Books search/enrichment
- `/opt/onyx/server/services/goodreadsShelfScraper.js` — Goodreads shelves/lists scrape source
- `/opt/onyx/server/services/hardcoverService.js` — Hardcover GraphQL metadata/ratings lookup
- `/opt/onyx/server/services/coverResolver.js` — cover fallback chain
- `/opt/onyx/server/services/bookMetadataCache.js` — local metadata cache file abstraction
- `/opt/onyx/server/services/dataStore.js` — requests/history persistence and dedupe
- `/opt/onyx/server/services/audiobookshelf.js` — ABS API wrapper and scan triggers
- `/opt/onyx/server/services/prowlarr.js` — search provider integration
- `/opt/onyx/server/services/qbittorrent.js` — qBittorrent auth/add torrent operations
- `/opt/onyx/server/services/telegram.js` — Telegram/Z-Library bot automation
- `/opt/onyx/server/services/directDownload.js` — HTTP download + import handoff
- `/opt/onyx/server/services/importLog.js` — import log read/filter helpers

### Backend utilities and support
- `/opt/onyx/server/scanner.js` — local library scan / ownership checks
- `/opt/onyx/server/metadata_aggregator.js` — data normalization and aggregation
- `/opt/onyx/server/utils/cacheCleaner.js` — cache cleanup / maintenance utilities
- `/opt/onyx/server/utils/bookValidator.js` — partial validator (currently minimal / TODO-level)
- `/opt/onyx/server/utils/timeout.js` — timeout helper wrappers
- `/opt/onyx/server/mockData.js` — mock book data still present in codebase

### Frontend components (primary paths)
- `/opt/onyx/client/src/App.js` — route wiring / page composition
- `/opt/onyx/client/src/components/HomePage.js` — browse/discovery page
- `/opt/onyx/client/src/components/BookRow.js` — row/card rendering
- `/opt/onyx/client/src/components/BookDrawer.js` — detail + request action UI
- `/opt/onyx/client/src/components/AdminDashboard.js` — active admin workflow UI (PIN, search, download, Telegram)
- `/opt/onyx/client/src/components/CacheManagement.js` — cache admin tooling UI (newer addition)
- `/opt/onyx/client/src/components/ImportLog.js` — import log viewer
- `/opt/onyx/client/src/components/AdminPanel.js` — older/overlapping admin UI path (dead/duplicate risk)
- `/opt/onyx/client/src/components/UserSelector.js` — user context selection UX

### Operational scripts
- `/opt/onyx/scripts/process-download.js` — critical import pipeline script
- `/opt/onyx/scripts/track-download.sh` — debugging/observability workflow for imports
- `/opt/onyx/scripts/auto-populate-cache.js` — cache population automation
- `/opt/onyx/refresh-cache.sh` — refresh orchestration script
- `/opt/onyx/backup.sh` — backup helper
- `/opt/onyx/scripts/qbit-webhook.sh` — qBit webhook hook script

---

## 5) What Appears Stable vs What Appears Fragile / Incomplete

### Stable / mostly coherent (based on code + data state)
1. **Basic frontend/backend app structure**
   - React frontend + Express backend integration is coherent.
   - Dockerized deployment path is present and appears intentionally used.

2. **JSON persistence model for requests/history/import log**
   - `/opt/onyx/server/services/dataStore.js` and `/opt/onyx/server/services/importLog.js` suggest a workable file-store approach for low-scale self-hosted usage.
   - Existing `data/*.json` files indicate this is actively used.

3. **Download import pipeline concept**
   - `/opt/onyx/scripts/process-download.js` is detailed and operationally central.
   - Import log examples in `/opt/onyx/data/import_log.json` show successful records with move/hardlink + scanTriggered flags.

4. **Discovery cache as primary browse source**
   - `/opt/onyx/server/services/discoveryCache.js` + `/opt/onyx/data/discovery_cache.json` indicate real usage and non-trivial data volumes.

5. **Admin dashboard workflow intent**
   - `/opt/onyx/client/src/components/AdminDashboard.js` includes integrated search/download/Telegram status flows and appears to be the main admin UX.

### Fragile / inconsistent / incomplete
1. **Security model (admin auth) is weak by default**
   - `ADMIN_PIN` fallback to `'1905'` in `/opt/onyx/server/index.js` is a critical weakness if env is absent/misconfigured.
   - PIN-only auth with cookie signature may be acceptable for a trusted LAN hobby service, but not exposed internet-facing deployment.

2. **Discovery source quality and cache consistency issues**
   - `/opt/onyx/data/discovery_cache.json` contains poor-quality/irrelevant entries (e.g., stationery/product-like result for a known book title).
   - `dragons` genre shows zero count despite configured source in scraper.
   - `awards` appears in discovery cache summary but not in master cache stats/genre index snapshot (consistency gap between caches).

3. **Multiple overlapping cache layers increase complexity and drift risk**
   - `book_metadata.json`, `discovery_cache.json`, and `master_book_cache.json` overlap in responsibility.
   - Maintenance utilities exist (`cacheCleaner`, cache management UI), which suggests the system needs active intervention.

4. **Dead/abandoned and partially removed features remain referenced**
   - `/opt/onyx/server/services/aiBookCurator.js` is deleted, but references/tests/comments remain (e.g., disabled import/comment in `/opt/onyx/server/index.js`, `test-ai-curator.js`).
   - `/opt/onyx/server/utils/bookValidator.js` is minimal and explicitly incomplete.

5. **Admin/frontend duplication likely causing maintenance drift**
   - `/opt/onyx/client/src/components/AdminDashboard.js` and `/opt/onyx/client/src/components/AdminPanel.js` overlap conceptually.
   - CSS and component sprawl implies iteration without cleanup.

6. **Docs and working-tree artifacts are stale/mixed with production code**
   - Multiple technical reference variants and old Claude backup context files are present.
   - Generated frontend build output, backups, logs, and large runtime data are in the working tree.

---

## 6) Frontend: Intended Behavior vs Current Reality

### Intended behavior (from code structure)
- Public/home users browse category rows of books (fantasy/scifi/etc.)
- Clicking opens detailed book drawer
- Users submit requests with selected identity/user context
- Admin authenticates via PIN and manages queue
- Admin searches for request fulfillment options and triggers downloads
- Admin can inspect import logs and manage caches

### What the current code/data suggest is actually happening
- Browsing likely works when discovery cache exists and backend is healthy
- Book quality is inconsistent because source and enrichment quality vary (Goodreads + Google Books mismatches)
- Ownership overlays depend on scanner/mounts/ABS alignment; likely environment-sensitive
- Admin workflow likely works in parts, but reliability depends heavily on external services (Telegram auth state, Prowlarr, qBittorrent, ABS)
- Cache management appears newly added and useful, but also indicates discovery data requires manual repair/regeneration
- There is evidence of UI iteration and enhancement, but also overlapping/legacy admin components that can confuse maintenance

### Frontend-specific risks observed
- Large CSS files and component complexity (notably admin) increase regression risk
- API coupling is direct (`fetch(...)` calls scattered in components), making error handling consistency harder
- Multiple admin UIs can create route/behavior divergence

---

## 7) Book Discovery & Display Logic (Current State)

### Source and transformation pipeline
- Genre definitions / sources live in `/opt/onyx/server/services/goodreadsShelfScraper.js`
- Scraped candidates are enriched through Google Books and possibly Hardcover
- Cover resolution uses fallback order via `/opt/onyx/server/services/coverResolver.js`
- Discovery rows are served from `/opt/onyx/server/services/discoveryCache.js`
- Master deduped/indexed cache is managed in `/opt/onyx/server/services/masterBookCache.js`

### Current observed data quality/state (from runtime JSON summaries)
- `/opt/onyx/data/discovery_cache.json`
  - Includes genres such as `romantasy`, `fantasy`, `scifi`, `dark_fantasy`, etc.
  - `dragons` count observed as `0`
  - `awards` present in discovery cache summary
  - Some clearly low-quality Google Books matches present (e.g., non-book/merch-like items for popular titles)
- `/opt/onyx/data/master_book_cache.json`
  - Large cache (~7,404 books in sampled summary)
  - Includes `test` genre/book data in production cache stats (cleanup gap)
  - Genre stats differ from discovery cache summary (expected partly, but notable inconsistencies exist)

### Implications
- Discovery browsing is functional but noisy
- Cache freshness/quality controls are a major operational concern
- Genre completeness is uneven and should be monitored automatically, not only manually

---

## 8) Contradictions / Inconsistencies Found

1. **Hardcover env naming mismatch risk**
   - Environment files show `HARDCOVER_TOKEN` usage, while service code convention may expect `HARDCOVER_API_TOKEN` (or vice versa depending on service implementation).
   - This can silently disable ratings/enrichment.
   - Files involved:
     - `/opt/onyx/.env`
     - `/opt/onyx/.env.example`
     - `/opt/onyx/server/services/hardcoverService.js`

2. **Default admin PIN fallback contradicts secure deployment assumptions**
   - `/opt/onyx/server/index.js` falls back to `'1905'` when `ADMIN_PIN` is absent.
   - Compose/Traefik deployment implies internet exposure is possible.

3. **AI curator removed but ecosystem not fully cleaned up**
   - Deleted file `/opt/onyx/server/services/aiBookCurator.js`
   - Residual tests/scripts/docs/comments still reference AI curation experiments
   - Increases confusion about intended discovery strategy

4. **Discovery cache vs master cache genre/state divergence**
   - `awards` appears in discovery cache summary but not in master cache sample genre index
   - `dragons` configured but empty in discovery cache snapshot
   - `test` genre present in master cache stats

5. **Admin UI duplication**
   - `/opt/onyx/client/src/components/AdminDashboard.js` and `/opt/onyx/client/src/components/AdminPanel.js` imply overlapping responsibilities
   - Hard to know canonical admin path without cleanup or clear deprecation notes

6. **Docs duplication and staleness**
   - Multiple technical reference files (`ONYX_TECHNICAL_REFERENCE*.md`) plus `CURRENT_CONTEXT.md`, `planning.txt`, and hidden `.claude` context backups can conflict
   - No single guaranteed source of truth

7. **Environment example coverage mismatch**
   - `.env` contains variables not obviously reflected in `.env.example` (e.g., some AI/provider-related entries), while `.env.example` includes defaults that may not be safe (e.g., `ADMIN_PIN=1905`)

---

## 9) Dead Code / Half-Finished / Abandoned Approaches

### Clear dead/abandoned indicators
- `/opt/onyx/server/services/aiBookCurator.js` deleted but related test remains:
  - `/opt/onyx/test-ai-curator.js`
- Disabled/commented references in `/opt/onyx/server/index.js` remain in place
- Diagnostic scripts for discovery/Goodreads exploration remain at repo root:
  - `/opt/onyx/discover_lists.js`
  - `/opt/onyx/fetch_popular_lists.js`
  - `/opt/onyx/introspect_lists.js`
  - `/opt/onyx/search_genre_lists.js`
  - `/opt/onyx/search_lists_api.js`
  - `/opt/onyx/final_verify.js`
  - `/opt/onyx/check_all_lists.js`
- These are useful historically but create noise unless moved to `/tools`, `/experiments`, or archived.

### Half-finished implementation indicators
- `/opt/onyx/server/utils/bookValidator.js`
  - Minimal implementation / TODO-like state
- Admin panel component overlap suggests incomplete consolidation
- Cache cleaning/repair utilities imply ongoing manual mitigation rather than fully automated validation pipeline

---

## 10) External Integrations and Current Status (Based on Code + Config Presence)

### Prowlarr
- Code: `/opt/onyx/server/services/prowlarr.js`
- Config vars present in env files
- Appears actively integrated for admin search
- Status: likely functional if URL/API key are valid

### qBittorrent
- Code: `/opt/onyx/server/services/qbittorrent.js`
- Downstream import pipeline in `/opt/onyx/scripts/process-download.js`
- Import logs show real use of move/hardlink processing
- Status: likely active and central to torrent fulfillment flow

### Audiobookshelf (ABS)
- Code: `/opt/onyx/server/services/audiobookshelf.js`
- Scan trigger used by import pipeline; user/library endpoints used in app
- Status: likely functional but environment/mount dependent

### Telegram / Z-Library bot
- Code: `/opt/onyx/server/services/telegram.js`
- Related env vars present (`TELEGRAM_*`, bot username)
- Client-side admin UI contains Telegram auth/status controls
- `data/telegram_session.txt` exists, implying active or prior auth usage
- Status: likely partially/actively used; brittle to auth/session changes and bot behavior changes

### Google Books API
- Code: `/opt/onyx/server/services/googleBooksApi.js`
- Multiple API keys configured in env files
- Status: active for metadata enrichment; quality issues visible in cached data

### Hardcover
- Code: `/opt/onyx/server/services/hardcoverService.js`
- Token naming mismatch risk noted
- Status: integration exists; operational status depends on env naming alignment and API behavior

### Goodreads scraping
- Code: `/opt/onyx/server/services/goodreadsShelfScraper.js`
- Multiple genre source definitions and counts configured
- Status: active but fragile by nature (scraping); some genres underperform/empty (`dragons` observed)

---

## 11) Security, Privacy, and Operational Risks (Audit Highlights)

### Critical concerns
1. **Tracked secret-bearing files / sensitive runtime artifacts in working tree**
   - `/opt/onyx/.env` exists and contains production credentials/secrets (values redacted in audit)
   - `/opt/onyx/data/telegram_session.txt` exists and may contain sensitive session material
   - Backup archives in `/opt/onyx/backups/*.tar.gz` may contain sensitive data snapshots

2. **Weak default admin auth fallback**
   - `/opt/onyx/server/index.js` defaults admin secret to `'1905'` if env missing

3. **Internet-exposed deployment possibility + PIN-only auth**
   - Traefik labels in `/opt/onyx/docker-compose.yml` suggest external routing
   - PIN-only auth is insufficient for hostile exposure

### Moderate concerns
- Large runtime caches/logs/build artifacts checked into working tree complicate review and increase accidental leakage risk
- Multiple undocumented/legacy env vars can cause insecure misconfiguration
- Telegram automation flows require careful session handling and error logging hygiene

---

## 12) Documentation Inventory and Staleness Assessment

### Core docs (useful but need consolidation)
- `/opt/onyx/README.md` — baseline project docs
- `/opt/onyx/BACKUP_RESTORE.md` — backup/restore procedures
- `/opt/onyx/docs/QBITTORRENT_SETUP.md` — qBittorrent setup guidance

### Technical references / planning (high staleness/conflict risk)
- `/opt/onyx/CURRENT_CONTEXT.md`
- `/opt/onyx/ONYX_TECHNICAL_REFERENCE.md`
- `/opt/onyx/ONYX_TECHNICAL_REFERENCE_POPULATED.md`
- `/opt/onyx/ONYX_TECHNICAL_REFERENCE_POPULATED_GIT_SAFE.md`
- `/opt/onyx/REFERENCE_IMPLEMENTATIONS.md`
- `/opt/onyx/planning.txt`

### Hidden AI/agent metadata (not product docs)
- `/opt/onyx/.claude/settings.local.json`
- `/opt/onyx/.claude.old.backup/context.md`
- `/opt/onyx/.claude.old.backup/settings.local.json`
- `/opt/onyx/.claude/agents/*.md`
- `/opt/onyx/.agent/workflows/track-ebook.md`

### Recommendation on docs truth-source
- Promote one canonical operational architecture doc (this file can seed it)
- Archive/label historical docs as legacy
- Separate product docs from local AI/agent workflow files

---

## 13) Onboarding Notes for a New Maintainer

### Start here (practical)
1. Read `/opt/onyx/README.md`
2. Read `/opt/onyx/docker-compose.yml` and `/opt/onyx/Dockerfile`
3. Read `/opt/onyx/server/index.js` (API and orchestration)
4. Read core services:
   - `/opt/onyx/server/services/discoveryCache.js`
   - `/opt/onyx/server/services/masterBookCache.js`
   - `/opt/onyx/server/services/googleBooksApi.js`
   - `/opt/onyx/server/services/goodreadsShelfScraper.js`
   - `/opt/onyx/server/services/dataStore.js`
5. Read import pipeline:
   - `/opt/onyx/scripts/process-download.js`
   - `/opt/onyx/server/services/audiobookshelf.js`
6. Read frontend flow:
   - `/opt/onyx/client/src/App.js`
   - `/opt/onyx/client/src/components/HomePage.js`
   - `/opt/onyx/client/src/components/AdminDashboard.js`
   - `/opt/onyx/client/src/components/BookDrawer.js`

### Validate environment assumptions early
- Ensure all required env vars are documented and aligned with code names
- Verify mounted paths for downloads/media/library scanning
- Confirm ABS, qBittorrent, Prowlarr, and Telegram credentials/session are valid

### Expect operational maintenance work
- Discovery cache cleanup/regeneration is an active concern
- Metadata quality issues are normal and need filtering/validation
- Legacy scripts/docs/features are present and need triage before major refactors

---

## 14) Overall Health Assessment (Pragmatic)

Onyx is a real, actively-used self-hosted system with meaningful functionality across discovery, request handling, and fulfillment. The strongest parts are the practical integration work (qBittorrent/Audiobookshelf/Telegram), the end-to-end import pipeline, and the layered discovery system.

However, the codebase currently carries significant technical debt in four areas:
1. Security posture (tracked secrets, weak admin fallback, internet-exposure risk)
2. Discovery/cache complexity and data quality consistency
3. Legacy/abandoned feature residue and duplicate UI paths
4. Documentation sprawl and source-of-truth drift

This is maintainable with focused cleanup, but it is currently fragile in ways that will slow future changes unless the backlog in `/opt/onyx/TASKS.md` is addressed.
