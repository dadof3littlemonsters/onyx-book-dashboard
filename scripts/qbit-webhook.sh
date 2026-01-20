#!/bin/bash
# Wrapper script for qBittorrent external program
# This handles special characters in torrent names properly

# Log the call for debugging
echo "[$(date)] qBittorrent triggered: $*" >> /tmp/qbit-webhook.log

# Execute the Node.js script with properly quoted arguments
docker exec onyx node /app/scripts/process-download.js "$1" "$2" "$3" "$4" "$5" >> /tmp/qbit-webhook.log 2>&1

# Log completion
echo "[$(date)] Processing complete" >> /tmp/qbit-webhook.log
