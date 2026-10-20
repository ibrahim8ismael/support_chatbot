#!/usr/bin/env bash
# ==============================================================================
# Health Check Verification Script for Support Agent AI
# ==============================================================================
# Validates both internal loopback container bindings and public reverse proxy
# routes across API, DB, Redis, Queue, and Web services.
# ==============================================================================

set -euo pipefail

MAX_ATTEMPTS="${MAX_ATTEMPTS:-15}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-4}"
API_URL="${API_URL:-http://127.0.0.1:3201/health}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3200}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-support-agent.imtelak.com}"
PUBLIC_API_URL="https://${PUBLIC_DOMAIN}/health"
PUBLIC_WEB_URL="https://${PUBLIC_DOMAIN}/"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

log "Starting health verification (Max attempts: ${MAX_ATTEMPTS}, Interval: ${INTERVAL_SECONDS}s)..."

# 1. Verify Internal Backend API Health (DB, Redis, Queue)
api_healthy=0
for ((i=1; i<=MAX_ATTEMPTS; i++)); do
  log "Attempt $i/$MAX_ATTEMPTS: Checking internal API health at ${API_URL}..."
  response=$(curl -sf -m 5 "${API_URL}" || true)
  if [[ -n "$response" ]]; then
    # Verify JSON response contains expected status flags
    if echo "$response" | grep -q '"status":"ok"' && \
       echo "$response" | grep -q '"db":"ok"' && \
       echo "$response" | grep -q '"redis":"ok"'; then
      log " Internal API is HEALTHY: $response"
      api_healthy=1
      break
    else
      log " Internal API responded, but dependencies not ready: $response"
    fi
  else
    log " Internal API not yet answering, waiting..."
  fi
  sleep "${INTERVAL_SECONDS}"
done

if [[ "$api_healthy" -ne 1 ]]; then
  log_error "Internal API health check FAILED after ${MAX_ATTEMPTS} attempts."
  exit 1
fi

# 2. Verify Internal Web Service
web_healthy=0
for ((i=1; i<=MAX_ATTEMPTS; i++)); do
  log "Attempt $i/$MAX_ATTEMPTS: Checking internal Web service at ${WEB_URL}..."
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "${WEB_URL}" || true)
  if [[ "$http_code" =~ ^(200|307|308|302)$ ]]; then
    log " Internal Web service is HEALTHY (HTTP $http_code)."
    web_healthy=1
    break
  else
    log " Internal Web service returned HTTP $http_code, waiting..."
  fi
  sleep "${INTERVAL_SECONDS}"
done

if [[ "$web_healthy" -ne 1 ]]; then
  log_error "Internal Web health check FAILED after ${MAX_ATTEMPTS} attempts."
  exit 1
fi

# 3. Verify Public Reverse Proxy API Route
public_api_code=$(curl -sf -o /dev/null -w "%{http_code}" -m 8 "${PUBLIC_API_URL}" || true)
if [[ "$public_api_code" == "200" ]]; then
  log " Public HTTPS API route is HEALTHY (${PUBLIC_API_URL} -> HTTP 200)."
else
  log_error "Public HTTPS API route failed: ${PUBLIC_API_URL} returned HTTP ${public_api_code}."
  exit 1
fi

# 4. Verify Public Reverse Proxy Web Route
public_web_code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "${PUBLIC_WEB_URL}" || true)
if [[ "$public_web_code" =~ ^(200|307|308|302)$ ]]; then
  log " Public HTTPS Web route is HEALTHY (${PUBLIC_WEB_URL} -> HTTP ${public_web_code})."
else
  log_error "Public HTTPS Web route failed: ${PUBLIC_WEB_URL} returned HTTP ${public_web_code}."
  exit 1
fi

log " All health and routing verifications PASSED successfully!"
exit 0
