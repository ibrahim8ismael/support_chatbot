#!/usr/bin/env bash
# ==============================================================================
# Automated Production Deployment Script for Support Agent AI
# ==============================================================================
# Invoked by GitHub Actions upon successful CI checks on 'main' branch.
# Manages immutable image deployments, migrations, rolling container updates,
# health checks, and automated rollback upon validation failure.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCK_FILE="/tmp/support-agent-deploy.lock"
STATE_FILE="${APP_DIR}/.last_known_good_release"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# --- 1. Concurrency Control (Server-side Lock) ---
exec 200>"$LOCK_FILE"
log "Acquiring deployment lock..."
if ! flock -n 200; then
  log_error "Another deployment is currently in progress. Exiting to prevent concurrent modification."
  exit 1
fi

cleanup() {
  flock -u 200 || true
  rm -f "$LOCK_FILE" || true
}
trap cleanup EXIT

# --- 2. Pre-flight Checks ---
IMAGE_TAG="${IMAGE_TAG:-${1:-}}"
if [[ -z "$IMAGE_TAG" ]]; then
  log_error "IMAGE_TAG is required (e.g. Git commit SHA). Usage: IMAGE_TAG=<sha> $0"
  exit 1
fi

REGISTRY="${REGISTRY:-ghcr.io/ibrahim8ismael/support_chatbot}"
API_IMAGE="${API_IMAGE:-${REGISTRY}/api:${IMAGE_TAG}}"
WEB_IMAGE="${WEB_IMAGE:-${REGISTRY}/web:${IMAGE_TAG}}"

cd "$APP_DIR"

if [[ ! -f ".env" ]]; then
  log_error "Missing .env file in $APP_DIR. Cannot deploy without configuration."
  exit 1
fi

log "=== STARTING PRODUCTION DEPLOYMENT ==="
log "  Target Revision (IMAGE_TAG): ${IMAGE_TAG}"
log "  Target API Image:            ${API_IMAGE}"
log "  Target Web Image:            ${WEB_IMAGE}"

# --- 3. Record Current Running State for Rollback ---
CURRENT_API_IMAGE=$(docker inspect --format='{{.Config.Image}}' support-agent-api-1 2>/dev/null || echo "")
CURRENT_GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

if [[ -n "$CURRENT_API_IMAGE" ]]; then
  log "Recording current state for rollback protection (Current image: ${CURRENT_API_IMAGE})..."
  cat <<EOF > "${STATE_FILE}.tmp"
PREV_IMAGE_TAG="${CURRENT_API_IMAGE}"
PREV_GIT_COMMIT="${CURRENT_GIT_COMMIT}"
PREV_DEPLOYED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
EOF
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

# --- 4. Synchronize Repository Manifests ---
log "Fetching latest manifests from Git repository..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git fetch origin main --quiet || true
  git checkout -q main || true
  git pull origin main --quiet || true
fi

# --- 5. Optional Registry Login ---
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  log "Authenticating with GitHub Container Registry..."
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-ibrahim8ismael}" --password-stdin
fi

# --- 6. Pull Target Immutable Images ---
if [[ "${SKIP_PULL:-false}" != "true" ]]; then
  log "Pulling target production Docker images..."
  if ! docker pull "${API_IMAGE}"; then
    log_error "Failed to pull ${API_IMAGE}. Aborting deployment without changing running services."
    exit 1
  fi

  if ! docker pull "${WEB_IMAGE}"; then
    log_error "Failed to pull ${WEB_IMAGE}. Aborting deployment without changing running services."
    exit 1
  fi
else
  log "SKIP_PULL=true: Skipping image pull (using locally available images)."
fi

# --- 7. Database Migration Safety ---
log "Executing database migrations..."
export API_IMAGE
export WEB_IMAGE
export IMAGE_TAG

if ! docker compose -f docker-compose.prod.yml run --rm migrate; then
  log_error "Database migration FAILED! Aborting deployment to prevent application failure."
  exit 1
fi
log "Database migrations executed successfully."

# --- 8. Recreate Application Services ---
log "Deploying new application containers (api, web)..."
# --no-deps ensures postgres and redis are not restarted; they remain untouched
docker compose -f docker-compose.prod.yml up -d --no-deps api web

# --- 9. Automated Health & Smoke Verification ---
log "Initiating post-deployment health checks..."
if "${SCRIPT_DIR}/health-check.sh"; then
  log " Verification PASSED: Deployment of ${IMAGE_TAG} was successful!"
  
  # Record the newly validated release as current known-good
  cat <<EOF > "${STATE_FILE}"
PREV_IMAGE_TAG="${API_IMAGE}"
PREV_GIT_COMMIT="${IMAGE_TAG}"
PREV_DEPLOYED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
EOF
  exit 0
else
  log_error " Health verification FAILED! Triggering automated rollback..."
  "${SCRIPT_DIR}/rollback.sh"
  log_error "Deployment failed and was automatically rolled back."
  exit 1
fi
