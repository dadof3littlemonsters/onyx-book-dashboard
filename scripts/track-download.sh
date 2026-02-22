#!/bin/bash

# Ebook Download Tracker
# Monitors a download through the complete Onyx pipeline from qBittorrent to Audiobookshelf

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
QBIT_URL="${QBIT_URL:-http://localhost:8080}"
QBIT_USER="${QBIT_USER}"
QBIT_PASS="${QBIT_PASS}"
IMPORT_LOG="/opt/onyx/data/import_log.json"
WEBHOOK_LOG="/tmp/qbit-webhook.log"
DOWNLOADS_DIR="/mnt/unionfs/downloads/books"
AUDIOBOOK_DEST="/mnt/unionfs/Media/Audiobooks"
EBOOK_DEST="/mnt/books/ebooks"

# Usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] <search_term>

Track an ebook/audiobook download through the Onyx pipeline.

OPTIONS:
    -f, --follow        Follow mode: monitor in real-time (for active downloads)
    -h, --hash HASH     Search by torrent hash instead of name
    -v, --verbose       Verbose output
    --help              Show this help message

EXAMPLES:
    # Check status of completed download
    $0 "The Atlas Six"
    
    # Monitor active download in real-time
    $0 --follow "Blood and Ash"
    
    # Search by torrent hash
    $0 --hash 479b5a6322c079c3f490a7f1aa6de1a7d5df010e

PIPELINE STAGES:
    1. qBittorrent Download
    2. Webhook Trigger
    3. Processing (parse, organize, move)
    4. Import Log Entry
    5. Audiobookshelf Library (for audiobooks)

EOF
    exit 1
}

# Parse arguments
FOLLOW_MODE=false
SEARCH_BY_HASH=false
VERBOSE=false
SEARCH_TERM=""
HASH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--follow)
            FOLLOW_MODE=true
            shift
            ;;
        -h|--hash)
            SEARCH_BY_HASH=true
            HASH="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            usage
            ;;
        *)
            SEARCH_TERM="$1"
            shift
            ;;
    esac
done

if [[ -z "$SEARCH_TERM" && -z "$HASH" ]]; then
    echo -e "${RED}Error: Search term or hash required${NC}"
    usage
fi

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_stage() {
    echo -e "\n${CYAN}━━━ $1 ━━━${NC}"
}

# Check qBittorrent status
check_qbittorrent() {
    log_stage "Stage 1: qBittorrent Download"
    
    if [[ -z "$QBIT_USER" || -z "$QBIT_PASS" ]]; then
        log_warning "qBittorrent credentials not set (QBIT_USER/QBIT_PASS)"
        log_info "Skipping qBittorrent API check"
        return 1
    fi
    
    # Login to qBittorrent
    local cookie_file=$(mktemp)
    local login_response=$(curl -s -c "$cookie_file" --data "username=$QBIT_USER&password=$QBIT_PASS" "$QBIT_URL/api/v2/auth/login")
    
    if [[ "$login_response" != "Ok." ]]; then
        log_error "Failed to login to qBittorrent"
        rm -f "$cookie_file"
        return 1
    fi
    
    # Get torrent list
    local torrents=$(curl -s -b "$cookie_file" "$QBIT_URL/api/v2/torrents/info?category=books")
    rm -f "$cookie_file"
    
    if [[ $SEARCH_BY_HASH == true ]]; then
        local torrent=$(echo "$torrents" | jq -r ".[] | select(.hash == \"$HASH\")")
    else
        local torrent=$(echo "$torrents" | jq -r ".[] | select(.name | test(\"$SEARCH_TERM\"; \"i\"))")
    fi
    
    if [[ -z "$torrent" || "$torrent" == "null" ]]; then
        log_warning "No matching torrent found in qBittorrent"
        return 1
    fi
    
    local name=$(echo "$torrent" | jq -r '.name')
    local hash=$(echo "$torrent" | jq -r '.hash')
    local state=$(echo "$torrent" | jq -r '.state')
    local progress=$(echo "$torrent" | jq -r '.progress * 100 | floor')
    local save_path=$(echo "$torrent" | jq -r '.save_path')
    
    log_info "Torrent: ${YELLOW}$name${NC}"
    log_info "Hash: $hash"
    log_info "State: $state"
    log_info "Progress: ${progress}%"
    log_info "Save Path: $save_path"
    
    if [[ "$state" == "uploading" || "$state" == "stalledUP" ]]; then
        log_success "Download complete, seeding"
        return 0
    elif [[ "$state" == "downloading" || "$state" == "stalledDL" ]]; then
        log_warning "Download in progress (${progress}%)"
        return 2
    else
        log_info "State: $state"
        return 0
    fi
}

# Check webhook log
check_webhook_log() {
    log_stage "Stage 2: Webhook Trigger"
    
    if [[ ! -f "$WEBHOOK_LOG" ]]; then
        log_warning "Webhook log not found: $WEBHOOK_LOG"
        return 1
    fi
    
    local search_pattern="$SEARCH_TERM"
    if [[ $SEARCH_BY_HASH == true ]]; then
        search_pattern="$HASH"
    fi
    
    local webhook_entries=$(grep -i "$search_pattern" "$WEBHOOK_LOG" 2>/dev/null || true)
    
    if [[ -z "$webhook_entries" ]]; then
        log_warning "No webhook trigger found for this download"
        log_info "Webhook may not have been triggered yet"
        return 1
    fi
    
    log_success "Webhook triggered"
    if [[ $VERBOSE == true ]]; then
        echo "$webhook_entries" | tail -5
    else
        echo "$webhook_entries" | tail -1
    fi
    
    return 0
}

# Check Docker container logs
check_processing_logs() {
    log_stage "Stage 3: Processing"
    
    local search_pattern="$SEARCH_TERM"
    if [[ $SEARCH_BY_HASH == true ]]; then
        search_pattern="$HASH"
    fi
    
    # Check recent Docker logs
    local docker_logs=$(docker logs onyx 2>&1 | grep -i "$search_pattern" | tail -20 || true)
    
    if [[ -z "$docker_logs" ]]; then
        log_warning "No processing logs found"
        return 1
    fi
    
    log_success "Processing logs found"
    
    # Look for key indicators
    if echo "$docker_logs" | grep -q "Processing complete"; then
        log_success "Processing completed"
    elif echo "$docker_logs" | grep -q "ERROR"; then
        log_error "Processing errors detected"
    fi
    
    if [[ $VERBOSE == true ]]; then
        echo "$docker_logs"
    else
        echo "$docker_logs" | grep -E "(MOVE|COPY|HARDLINK|ERROR|Processing complete)" | tail -5
    fi
    
    return 0
}

# Check import log
check_import_log() {
    log_stage "Stage 4: Import Log"
    
    if [[ ! -f "$IMPORT_LOG" ]]; then
        log_error "Import log not found: $IMPORT_LOG"
        return 1
    fi
    
    local search_pattern="$SEARCH_TERM"
    if [[ $SEARCH_BY_HASH == true ]]; then
        search_pattern="$HASH"
    fi
    
    # Search import log (search by name OR hash)
    local import_entry=$(jq -r ".imports[] | select((.torrentName | test(\"$search_pattern\"; \"i\")) or (.torrentHash | test(\"$search_pattern\"; \"i\")))" "$IMPORT_LOG" 2>/dev/null | jq -s '.[0]' 2>/dev/null)
    
    if [[ -z "$import_entry" ]]; then
        log_warning "No import log entry found"
        return 1
    fi
    
    local torrent_name=$(echo "$import_entry" | jq -r '.torrentName')
    local status=$(echo "$import_entry" | jq -r '.status')
    local media_type=$(echo "$import_entry" | jq -r '.mediaType')
    local dest_path=$(echo "$import_entry" | jq -r '.destPath')
    local files_processed=$(echo "$import_entry" | jq -r '.filesProcessed')
    local timestamp=$(echo "$import_entry" | jq -r '.timestamp')
    local scan_triggered=$(echo "$import_entry" | jq -r '.scanTriggered')
    
    log_success "Import logged"
    log_info "Torrent: ${YELLOW}$torrent_name${NC}"
    log_info "Status: $status"
    log_info "Media Type: $media_type"
    log_info "Files Processed: $files_processed"
    log_info "Destination: ${GREEN}$dest_path${NC}"
    log_info "Timestamp: $timestamp"
    log_info "ABS Scan Triggered: $scan_triggered"
    
    # Check for errors
    local errors=$(echo "$import_entry" | jq -r '.errors[]?' 2>/dev/null)
    if [[ -n "$errors" ]]; then
        log_error "Errors found:"
        echo "$errors" | jq -r '.error'
    fi
    
    # Store for next stage
    DEST_PATH="$dest_path"
    MEDIA_TYPE="$media_type"
    
    return 0
}

# Verify file placement
verify_file_placement() {
    log_stage "Stage 5: File Verification"
    
    if [[ -z "$DEST_PATH" ]]; then
        log_warning "Destination path not available from import log"
        return 1
    fi
    
    if [[ -e "$DEST_PATH" ]]; then
        log_success "File exists at destination"
        log_info "Path: ${GREEN}$DEST_PATH${NC}"
        
        if [[ -d "$DEST_PATH" ]]; then
            local file_count=$(find "$DEST_PATH" -type f | wc -l)
            log_info "Directory contains $file_count files"
        else
            local file_size=$(du -h "$DEST_PATH" | cut -f1)
            log_info "File size: $file_size"
        fi
        
        return 0
    else
        log_error "File not found at destination"
        log_info "Expected: $DEST_PATH"
        return 1
    fi
}

# Check Audiobookshelf library
check_audiobookshelf() {
    log_stage "Stage 6: Audiobookshelf Library"
    
    if [[ "$MEDIA_TYPE" != "audiobook" ]]; then
        log_info "Skipping (media type: $MEDIA_TYPE)"
        return 0
    fi
    
    log_info "For audiobooks, check your Audiobookshelf web interface"
    log_info "The library scan should have been triggered automatically"
    
    return 0
}

# Follow mode - monitor in real-time
follow_download() {
    log_info "Starting real-time monitoring..."
    log_info "Press Ctrl+C to stop"
    echo ""
    
    local iteration=0
    while true; do
        clear
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}  Ebook Download Tracker - Follow Mode${NC}"
        echo -e "${CYAN}  Search: ${YELLOW}$SEARCH_TERM${NC}"
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        
        check_qbittorrent
        local qbit_status=$?
        
        check_webhook_log
        check_processing_logs
        check_import_log
        
        if [[ $? -eq 0 ]]; then
            verify_file_placement
            check_audiobookshelf
            
            log_success "Download tracking complete!"
            break
        fi
        
        echo ""
        log_info "Refreshing in 10 seconds... (iteration $((++iteration)))"
        sleep 10
    done
}

# Main execution
main() {
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Ebook Download Tracker${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
    
    if [[ $FOLLOW_MODE == true ]]; then
        follow_download
    else
        check_qbittorrent || true
        check_webhook_log || true
        check_processing_logs || true
        check_import_log
        
        if [[ $? -eq 0 ]]; then
            verify_file_placement
            check_audiobookshelf
        fi
        
        echo ""
        log_info "Tracking complete"
    fi
}

main
