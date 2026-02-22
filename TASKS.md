# TASKS.md

Prioritized remediation and cleanup tasks for `/opt/onyx`, derived from the repository audit.

Each task includes what/why/where/context to support handoff.

---

## Critical (Fix Immediately)

### 1) Remove tracked secrets and sensitive runtime artifacts from the repository/worktree
- **What**: Stop storing secret-bearing and sensitive runtime files in the tracked/project working tree; rotate affected credentials and sessions.
- **Why**: `.env`, Telegram session files, logs, and backup archives can expose credentials, tokens, and user/library data. This is the highest-impact security risk observed.
- **Where**:
  - `/opt/onyx/.env`
  - `/opt/onyx/data/telegram_session.txt`
  - `/opt/onyx/backups/*.tar.gz`
  - `/opt/onyx/server.log`
  - `/opt/onyx/backups/backup.log`
  - `/opt/onyx/.gitignore`
- **Context**: Even if some files are currently ignored, they are present in the working tree and may be accidentally copied/backed up/shared. If ever committed historically, credentials should be rotated.

### 2) Remove insecure default admin PIN fallback in backend auth
- **What**: Eliminate fallback to `'1905'` and fail fast if `ADMIN_PIN` (or a stronger auth config) is not set.
- **Why**: Current behavior silently enables a known weak secret, which is dangerous with Traefik/external routing.
- **Where**:
  - `/opt/onyx/server/index.js`
- **Context**: The code currently derives admin secret from `process.env.ADMIN_PIN || '1905'`. This is acceptable only for disposable local development, not deployment.

### 3) Harden admin authentication for internet-exposed deployments
- **What**: Add stronger auth controls (at minimum: strong credential requirement, lockout/rate-limits on login route, optional username+password, and deployment guidance for reverse-proxy auth).
- **Why**: PIN-only auth is not sufficient for internet exposure and raises takeover risk for admin actions (downloads, cache management, Telegram, etc.).
- **Where**:
  - `/opt/onyx/server/index.js`
  - `/opt/onyx/client/src/components/AdminDashboard.js`
  - `/opt/onyx/docker-compose.yml`
  - `/opt/onyx/README.md`
- **Context**: Existing cookie signing is better than nothing, but authentication strength is still too weak if exposed publicly.

### 4) Validate and unify environment variable names for Hardcover integration
- **What**: Standardize token naming (`HARDCOVER_TOKEN` vs `HARDCOVER_API_TOKEN`) across code and docs.
- **Why**: Mismatched env names can silently disable ratings/metadata enrichment and produce confusing discovery output.
- **Where**:
  - `/opt/onyx/server/services/hardcoverService.js`
  - `/opt/onyx/.env.example`
  - `/opt/onyx/README.md`
  - `/opt/onyx/docker-compose.yml`
- **Context**: Audit found naming inconsistency risk between env examples/runtime env and service expectations.

---

## High (Fix Soon)

### 5) Consolidate and document the canonical discovery pipeline (discoveryCache vs masterBookCache)
- **What**: Clarify responsibilities of `discovery_cache.json`, `master_book_cache.json`, and `book_metadata.json`; document which one drives UI and when each is refreshed.
- **Why**: Overlapping caches create drift, confusion, and bugs during debugging/regeneration.
- **Where**:
  - `/opt/onyx/server/services/discoveryCache.js`
  - `/opt/onyx/server/services/masterBookCache.js`
  - `/opt/onyx/server/services/bookMetadataCache.js`
  - `/opt/onyx/client/src/components/CacheManagement.js`
  - `/opt/onyx/README.md`
- **Context**: The system works, but maintainers need a clear mental model to avoid accidental corruption or stale data.

### 6) Add automated cache integrity checks and alerts for empty/low-quality genres
- **What**: Build validation checks for empty genres, suspicious titles, missing ISBNs/covers, and test data leakage; surface results in cache management UI and refresh scripts.
- **Why**: Audit showed `dragons` empty and low-quality discovery entries; manual discovery inspection does not scale.
- **Where**:
  - `/opt/onyx/server/services/discoveryCache.js`
  - `/opt/onyx/server/services/masterBookCache.js`
  - `/opt/onyx/server/utils/cacheCleaner.js`
  - `/opt/onyx/server/utils/bookValidator.js`
  - `/opt/onyx/scripts/auto-populate-cache.js`
  - `/opt/onyx/refresh-cache.sh`
  - `/opt/onyx/client/src/components/CacheManagement.js`
- **Context**: This directly improves browse quality and lowers maintenance burden.

### 7) Remove or quarantine test/placeholder data from production caches
- **What**: Purge `test` genre/book entries from `master_book_cache.json` and add guards to prevent test data from entering production caches.
- **Why**: Pollutes user-facing discovery and undermines trust in cache stats.
- **Where**:
  - `/opt/onyx/data/master_book_cache.json`
  - `/opt/onyx/server/services/masterBookCache.js`
  - `/opt/onyx/server/utils/cacheCleaner.js`
- **Context**: Audit summary showed `test` genre in production cache stats.

### 8) Consolidate admin UI components and deprecate legacy admin path
- **What**: Decide canonical admin UI (`AdminDashboard` vs `AdminPanel`), migrate remaining functionality, remove dead component/routes/styles.
- **Why**: Duplicate admin surfaces increase maintenance cost and cause UX/API drift.
- **Where**:
  - `/opt/onyx/client/src/components/AdminDashboard.js`
  - `/opt/onyx/client/src/components/AdminPanel.js`
  - `/opt/onyx/client/src/components/AdminPanel.css`
  - `/opt/onyx/client/src/App.js`
- **Context**: Audit found overlapping responsibilities and UI evolution artifacts.

### 9) Replace scattered frontend `fetch` calls with shared API client + consistent error handling
- **What**: Introduce a small client API wrapper for auth, JSON parsing, error normalization, and retry/timeout behavior.
- **Why**: Current direct `fetch(...)` usage across components makes error handling inconsistent and increases duplication.
- **Where**:
  - `/opt/onyx/client/src/components/HomePage.js`
  - `/opt/onyx/client/src/components/AdminDashboard.js`
  - `/opt/onyx/client/src/components/CacheManagement.js`
  - `/opt/onyx/client/src/components/ImportLog.js`
  - `/opt/onyx/client/src/components/BookDrawer.js`
- **Context**: Improves maintainability and user-visible resilience.

### 10) Improve discovery result quality filtering before caching
- **What**: Add validation/rejection heuristics for non-book merchandise/stationery entries and low-confidence matches during enrichment.
- **Why**: Audit observed obviously bad entries in `discovery_cache.json` (e.g., stationery-like results for popular novels).
- **Where**:
  - `/opt/onyx/server/services/googleBooksApi.js`
  - `/opt/onyx/server/metadata_aggregator.js`
  - `/opt/onyx/server/utils/bookValidator.js`
  - `/opt/onyx/server/services/discoveryCache.js`
- **Context**: Discovery UX quality depends more on filtering than scraping volume.

---

## Medium (Next Sprint)

### 11) Clean up abandoned AI curator references and tests
- **What**: Remove stale references, comments, tests, and docs related to deleted `aiBookCurator` or archive them clearly.
- **Why**: Reduces confusion about supported discovery/enrichment paths.
- **Where**:
  - `/opt/onyx/server/index.js`
  - `/opt/onyx/test-ai-curator.js`
  - Any docs/planning notes referencing AI curation
- **Context**: `server/services/aiBookCurator.js` is deleted but residue remains.

### 12) Finish or remove incomplete `bookValidator` utility
- **What**: Either implement full validation rules and integrate them, or remove the file to avoid false confidence.
- **Why**: Half-finished utility suggests validation exists when it may not be effectively enforced.
- **Where**:
  - `/opt/onyx/server/utils/bookValidator.js`
  - Call sites in discovery/cache services
- **Context**: This is a leverage point for discovery quality.

### 13) Document and test category-to-genre mapping contracts
- **What**: Centralize the UI category ↔ backend discovery genre mapping and add tests for missing/misaligned categories.
- **Why**: Prevent silent empty rows and regressions when adding new genres/categories.
- **Where**:
  - `/opt/onyx/server/index.js`
  - `/opt/onyx/client/src/components/HomePage.js`
  - `/opt/onyx/server/services/goodreadsShelfScraper.js`
- **Context**: Audit saw genre mismatch symptoms (`dragons`, `awards`, differing cache views).

### 14) Add integration smoke tests for core external services
- **What**: Create non-destructive health checks for Prowlarr, qBittorrent, Audiobookshelf, Google Books, and Telegram session status.
- **Why**: Current reliability appears environment-dependent and failures likely surface late in UI workflows.
- **Where**:
  - `/opt/onyx/server/services/*.js`
  - `/opt/onyx/server/index.js` (health endpoints)
  - `/opt/onyx/scripts/track-download.sh`
- **Context**: Existing scripts are useful diagnostics but not a coherent smoke-test suite.

### 15) Split oversized backend entrypoint into route modules/services
- **What**: Refactor `/opt/onyx/server/index.js` into route modules (auth, books, admin, telegram, cache, imports, health).
- **Why**: Large monolithic server file slows changes, review, and testing.
- **Where**:
  - `/opt/onyx/server/index.js`
  - New `/opt/onyx/server/routes/*` modules (future)
- **Context**: This is a maintainability refactor, not urgent if functionality is stable.

### 16) Improve observability and log hygiene
- **What**: Standardize structured logs, redact sensitive fields, add request IDs/correlation for admin/download/import flows.
- **Why**: Current logs and scripts help, but debugging cross-service workflows is still manual.
- **Where**:
  - `/opt/onyx/server/index.js`
  - `/opt/onyx/server/services/*.js`
  - `/opt/onyx/scripts/process-download.js`
  - `/opt/onyx/scripts/track-download.sh`
- **Context**: Especially valuable for Telegram and import troubleshooting.

---

## Low (Technical Debt / Cleanup)

### 17) Consolidate documentation and mark stale docs as legacy
- **What**: Create one canonical architecture/ops document and archive or clearly label old technical references and context files.
- **Why**: Reduces source-of-truth confusion for maintainers.
- **Where**:
  - `/opt/onyx/README.md`
  - `/opt/onyx/CURRENT_CONTEXT.md`
  - `/opt/onyx/ONYX_TECHNICAL_REFERENCE*.md`
  - `/opt/onyx/REFERENCE_IMPLEMENTATIONS.md`
  - `/opt/onyx/planning.txt`
- **Context**: Audit found substantial duplication and likely staleness.

### 18) Move exploratory scripts into an `experiments/` or `tools/` directory
- **What**: Reorganize discovery/debug scripts from repo root, add readme labels for purpose and status.
- **Why**: Improves repo navigability and distinguishes production code from one-off diagnostics.
- **Where**:
  - `/opt/onyx/check_all_lists.js`
  - `/opt/onyx/discover_lists.js`
  - `/opt/onyx/fetch_popular_lists.js`
  - `/opt/onyx/final_verify.js`
  - `/opt/onyx/introspect_lists.js`
  - `/opt/onyx/search_genre_lists.js`
  - `/opt/onyx/search_lists_api.js`
  - `/opt/onyx/diagnose_hardcover.js`
  - `/opt/onyx/test-discovery-integration.js`
  - `/opt/onyx/test-deepseek.js`
- **Context**: Keeps operational code easier to audit.

### 19) Exclude generated frontend build artifacts from source-controlled working tree (if not intentionally committed)
- **What**: Decide whether `/client/build` is intentionally versioned; if not, ignore and remove from routine review scope.
- **Why**: Generated files add noise and slow audits/reviews.
- **Where**:
  - `/opt/onyx/client/build/*`
  - `/opt/onyx/.gitignore`
- **Context**: If versioned intentionally for deployment, document that policy explicitly.

### 20) Normalize `.env.example` and configuration documentation
- **What**: Ensure all required env vars are present, named correctly, and annotated (required/optional/default/sensitive).
- **Why**: Reduces setup errors and silent feature breakage.
- **Where**:
  - `/opt/onyx/.env.example`
  - `/opt/onyx/README.md`
  - `/opt/onyx/docker-compose.yml`
- **Context**: Multiple integrations make config drift easy.

---

## Suggested Execution Order (Pragmatic)

1. Critical #1-#4 (security + config correctness)
2. High #5-#7 (cache model + data quality + cleanup)
3. High #8-#10 (admin/frontend consolidation + discovery quality)
4. Medium #11-#16 (maintainability and observability)
5. Low #17-#20 (documentation and repo hygiene)
6. Resolve Decisions D1-D5 in parallel with Critical/High work

---

## Notes for Handoff

- The codebase is functional and actively used, but current risks are concentrated in security defaults, cache/data quality drift, and legacy/duplicate implementation residue.
- Fixing the top security/config issues first will significantly reduce exposure while preserving operational momentum.
- The next biggest ROI is clarifying and validating the discovery/cache pipeline, since it drives the main browsing UX.

---

## Decisions Needed

### D1) Is Onyx intended for LAN-only use or public internet exposure?
- **Why this matters**: Determines required auth hardening, reverse-proxy policy, and security priorities.
- **Impacted files**:
  - `/opt/onyx/server/index.js`
  - `/opt/onyx/docker-compose.yml`
  - `/opt/onyx/README.md`

### D2) What is the canonical discovery source of truth: `discoveryCache`, `masterBookCache`, or a future unified model?
- **Why this matters**: Affects refactor direction, cache tooling, and bug triage.
- **Impacted files**:
  - `/opt/onyx/server/services/discoveryCache.js`
  - `/opt/onyx/server/services/masterBookCache.js`
  - `/opt/onyx/client/src/components/CacheManagement.js`

### D3) Which admin UI is canonical (`AdminDashboard` vs `AdminPanel`)?
- **Why this matters**: Prevents duplicate maintenance and inconsistent features.
- **Impacted files**:
  - `/opt/onyx/client/src/components/AdminDashboard.js`
  - `/opt/onyx/client/src/components/AdminPanel.js`
  - `/opt/onyx/client/src/App.js`

### D4) Should generated caches and backups live inside the app repo directory?
- **Why this matters**: Security posture, backup policy, review noise, and accidental disclosure risk.
- **Impacted paths**:
  - `/opt/onyx/data/*`
  - `/opt/onyx/backups/*`
  - `/opt/onyx/.gitignore`
  - `/opt/onyx/docker-compose.yml`

### D5) Is Telegram/Z-Library integration considered core functionality or optional/experimental?
- **Why this matters**: Determines testing investment, UI prominence, and failure-handling expectations.
- **Impacted files**:
  - `/opt/onyx/server/services/telegram.js`
  - `/opt/onyx/client/src/components/AdminDashboard.js`
  - `/opt/onyx/README.md`
