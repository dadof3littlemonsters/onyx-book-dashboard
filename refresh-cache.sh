#!/usr/bin/env bash

# Refresh script for Onyx Goodreads-based book curation cache
# Determines which genres to refresh based on schedule and calls admin API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables from .env if present
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Configuration
ADMIN_PIN="${ADMIN_PIN:-1905}"
API_BASE="${API_BASE:-http://localhost:3000}"
LOG_FILE="/var/log/onyx-cache-refresh.log"
MAX_RETRIES=3
RETRY_DELAY=10
DEBUG="${DEBUG:-false}"

# Genre schedules - updated for new Goodreads-based scraper
# Weekly: Fast-moving genres that benefit from fresh content
WEEKLY_GENRES=("romantasy" "cozy_fantasy" "fairy_tale_retellings" "enemies_to_lovers")

# Monthly: Slower-moving genres
MONTHLY_GENRES=()

# Quarterly: Large, stable genres that don't change often
QUARTERLY_GENRES=("fantasy" "scifi" "dark_fantasy" "dragons" "action_adventure" "post_apocalyptic")

# Logging function
log() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Error logging
log_error() {
    log "ERROR: $1"
}

# Make HTTP request to admin endpoint via docker exec
refresh_genre() {
    local genre="$1"
    local attempt=1

    log "Refreshing genre: $genre"

    while [ $attempt -le $MAX_RETRIES ]; do
        local response=$(docker exec onyx curl -s -w "%{http_code}" -X POST \
            -H "x-admin-pin: $ADMIN_PIN" \
            -H "Content-Type: application/json" \
            -d "{\"genre\": \"$genre\"}" \
            "http://localhost:3000/api/admin/discovery/generate-cache" \
            2>/dev/null)

        local status_code=${response: -3}
        local body=${response%???}

        if [ "$status_code" = "200" ]; then
            log "Successfully refreshed genre: $genre"
            return 0
        else
            log_error "Failed to refresh genre $genre (attempt $attempt/$MAX_RETRIES): HTTP $status_code"
            if [ $attempt -lt $MAX_RETRIES ]; then
                sleep $RETRY_DELAY
            fi
            attempt=$((attempt + 1))
        fi
    done

    log_error "All retries exhausted for genre: $genre"
    return 1
}

# Wait for container to be ready
wait_for_container() {
    local max_wait=60
    local elapsed=0

    log "Waiting for Onyx container to be ready..."

    while [ $elapsed -lt $max_wait ]; do
        # Check if container is running
        if ! docker ps | grep -q "onyx"; then
            log_error "Container is not running"
            return 1
        fi

        # Check if API is responding via localhost
        if curl -s -f -m 5 "http://localhost:3000/api/books/fantasy?useDynamic=true" > /dev/null 2>&1; then
            log "Container is ready and API is responding"
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    log_error "Container did not become ready within ${max_wait}s"
    return 1
}

# Refresh all genres (single API call)
refresh_all() {
    local attempt=1

    log "Refreshing all genres"

    while [ $attempt -le $MAX_RETRIES ]; do
        local response=$(curl -s -w "%{http_code}" -X POST \
            -H "x-admin-pin: $ADMIN_PIN" \
            -H "Content-Type: application/json" \
            -m 30 \
            "http://localhost:3000/api/admin/discovery/generate-cache" \
            2>/dev/null)

        local status_code=${response: -3}
        local body=${response%???}

        if [ "$status_code" = "200" ]; then
            log "Successfully refreshed all genres"
            return 0
        else
            log_error "Failed to refresh all genres (attempt $attempt/$MAX_RETRIES): HTTP $status_code - Response: $body"
            if [ $attempt -lt $MAX_RETRIES ]; then
                sleep $RETRY_DELAY
            fi
            attempt=$((attempt + 1))
        fi
    done

    log_error "All retries exhausted for refreshing all genres"
    return 1
}

# Determine which genres to refresh based on schedule
determine_genres_to_refresh() {
    local day_of_week=$(date '+%u')  # 1=Monday, 7=Sunday
    local day_of_month=$(date '+%d') # 01-31
    local month=$(date '+%m')        # 01-12

    # DEBUG mode: return all genres
    if [ "$DEBUG" = "true" ]; then
        log "DEBUG mode enabled - returning all genres"
        echo "${WEEKLY_GENRES[@]} ${MONTHLY_GENRES[@]} ${QUARTERLY_GENRES[@]}"
        return 0
    fi

    local genres_to_refresh=()

    # Weekly refresh: Sundays (day 7)
    if [ "$day_of_week" = "7" ]; then
        log "Weekly refresh scheduled (Sunday)"
        genres_to_refresh+=("${WEEKLY_GENRES[@]}")
    fi

    # Monthly refresh: 1st day of month
    if [ "$day_of_month" = "01" ]; then
        log "Monthly refresh scheduled (1st of month)"
        genres_to_refresh+=("${MONTHLY_GENRES[@]}")
    fi

    # Quarterly refresh: Jan 1, Apr 1, Jul 1, Oct 1
    if [ "$day_of_month" = "01" ]; then
        case "$month" in
            01|04|07|10)
                log "Quarterly refresh scheduled (quarter start: month $month)"
                genres_to_refresh+=("${QUARTERLY_GENRES[@]}")
                ;;
        esac
    fi

    # If no scheduled refresh today, log and return empty list
    if [ ${#genres_to_refresh[@]} -eq 0 ]; then
        log "No scheduled refresh for today (day of week: $day_of_week, day of month: $day_of_month, month: $month)"
    fi

    # Remove duplicates (in case of overlap)
    local unique_genres=($(echo "${genres_to_refresh[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

    echo "${unique_genres[@]}"
}

main() {
    log "Starting Onyx cache refresh"

    # Check if admin pin is set
    if [ -z "$ADMIN_PIN" ]; then
        log_error "ADMIN_PIN not set. Cannot proceed."
        exit 1
    fi

    # Determine which genres to refresh
    local genres_to_refresh=($(determine_genres_to_refresh))

    # If no genres to refresh, exit
    if [ ${#genres_to_refresh[@]} -eq 0 ]; then
        log "No genres scheduled for refresh today, exiting"
        exit 0
    fi

    log "Genres scheduled for refresh today: ${genres_to_refresh[*]}"

    # Wait for container to be ready
    if ! wait_for_container; then
        log_error "Container not ready, cannot refresh cache"
        exit 1
    fi

    # Refresh all genres with single API call
    if ! refresh_all; then
        log_error "Failed to refresh cache"
        exit 1
    fi

    log "Cache refresh completed successfully"
}

# Run main function
main 2>&1 | tee -a "$LOG_FILE"
