#!/usr/bin/env bash
# ==============================================================================
# Automated Rollback Script for Support Agent AI
# ==============================================================================
# Restores the application to the last known-good image and git revision without
# destroying databases, Redis queues, or host reverse proxy configuration.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_FILE="${APP_DIR}/.last_known_good_release"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

log "=== INITIATING AUTOMATIC ROLLBACK ==="

if [[ ! -f "$STATE_FILE" ]]; then
  log_error "Cannot roll back: State file $STATE_FILE not found."
  log_error "Preserving current containers for inspection."
  exit 1
fi

# Load previous known-good release metadata
# Expected format: PREV_IMAGE_TAG=..., PREV_GIT_COMMIT=..., PREV_DEPLOYED_AT=...
# shellcheck source=/dev/null
source "$STATE_FILE"

if [[ -z "${PREV_IMAGE_TAG:-}" ]]; then
  log_error "Cannot roll back: PREV_IMAGE_TAG is empty in $STATE_FILE."
  exit 1
fi

log "Rolling back to last known-good revision:"
log "  Tag:    ${PREV_IMAGE_TAG}"
log "  Commit: ${PREV_GIT_COMMIT:-unknown}"
log "  Date:   ${PREV_DEPLOYED_AT:-unknown}"

cd "$APP_DIR"

# Restore containers to previous image
log "Recreating API and Web services with previous image tag..."
IMAGE_TAG="${PREV_IMAGE_TAG}" docker compose -f docker-compose.prod.yml up -d --no-deps api web

log "Verifying health of restored revision..."
if "${SCRIPT_DIR}/health-check.sh"; then
  log " Rollback SUCCESSFUL: Application restored to revision ${PREV_IMAGE_TAG}."
  exit 0
else
  log_error "Rollback health check FAILED. Recent logs:"
  docker compose -f docker-compose.prod.yml logs --tail=50 api web >&2
  exit 1
fi
