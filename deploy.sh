#!/bin/bash
# ============================================================
# AgentOS — Deployment Script

# MikroTik Firebase Auth Server Deployment Script

set -euo pipefail

echo "🚀 Starting deployment..."

# ── Configuration ─────────────────────────────────────────────
PROJECT_NAME="agentos"
REGION="us-central1"
SERVICE_ACCOUNT="agentos-sa"
PORT=3000

# ── Colours ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Prerequisites ─────────────────────────────────────────────
check_prerequisites() {
    log_info "Checking prerequisites..."
    for cmd in gcloud docker node; do
        command -v "$cmd" >/dev/null 2>&1 || { log_error "$cmd not installed"; exit 1; }
    done
 
    node_major=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
    if [ "$node_major" -lt 22 ]; then
        log_error "Node.js 22+ required (current: $(node --version))"
        exit 1
    fi
 
    gcloud config get-value project >/dev/null 2>&1 || {
        log_error "gcloud not authenticated — run: gcloud auth login"
        exit 1
    }
    log_info "Prerequisites OK"
}

# ── Environment ───────────────────────────────────────────────
setup_environment() {
    log_info "Loading environment..."
    if [ ! -f .env ]; then
        log_error ".env not found. Copy .env.example and fill in your values."
        exit 1
    fi
 
    set -a; source .env; set +a
 
    # Only TELEGRAM_BOT_TOKEN is strictly required for gateway mode.
    # Domain-specific vars (ROS_HOST, ROS_PASS, etc.) are optional — warn, do not fail.
    required_vars=(
        "TELEGRAM_BOT_TOKEN"
        "TELEGRAM_ALLOWED_CHAT_ID"
    )
 
    optional_vars=(
        "ROS_HOST"
        "ROS_PASS"
    )
 
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_error "Required variable $var not set in .env"
            exit 1
        fi
    done

    for var in "${optional_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_warn "Optional variable $var not set — domain-specific features may be disabled"
        fi
    done
    log_info "Environment OK"
}

 
# ── Build + push ──────────────────────────────────────────────
build_and_push() {
    log_info "Building Docker image..."
    GCP_PROJECT=$(gcloud config get-value project)
    GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
    IMAGE_SHA="gcr.io/${GCP_PROJECT}/${PROJECT_NAME}:${GIT_SHA}"
    IMAGE_LATEST="gcr.io/${GCP_PROJECT}/${PROJECT_NAME}:latest"
 
    docker build -t "$IMAGE_SHA" -t "$IMAGE_LATEST" .
    docker push "$IMAGE_SHA"
    docker push "$IMAGE_LATEST"
 
    echo "$IMAGE_SHA" > .image_tag
    log_info "Image pushed: $IMAGE_SHA"
}

# ── Cloud Run deploy ──────────────────────────────────────────
deploy_cloud_run() {
    log_info "Deploying to Cloud Run..."
    GCP_PROJECT=$(gcloud config get-value project)
    IMAGE_SHA=$(cat .image_tag)
 
    # Create service account if missing
    if ! gcloud iam service-accounts describe \
        "${SERVICE_ACCOUNT}@${GCP_PROJECT}.iam.gserviceaccount.com" \
        >/dev/null 2>&1; then
        log_info "Creating service account ${SERVICE_ACCOUNT}..."
        gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
            --display-name="AgentOS Service Account"
    fi
 
    gcloud run deploy "$PROJECT_NAME" \
        --image "$IMAGE_SHA" \
        --platform managed \
        --region "$REGION" \
        --service-account "${SERVICE_ACCOUNT}@${GCP_PROJECT}.iam.gserviceaccount.com" \
        --port "$PORT" \
        --memory 1Gi \
        --cpu 1 \
        --concurrency 80 \
        --max-instances 10 \
        --min-instances 1 \
        --timeout 300 \
        --set-env-vars="NODE_ENV=production" \
        --set-env-vars="TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" \
        --set-env-vars="TELEGRAM_ALLOWED_CHAT_ID=${TELEGRAM_ALLOWED_CHAT_ID}" \
        --set-env-vars="ROS_HOST=${ROS_HOST}" \
        --set-env-vars="ROS_PORT=${ROS_PORT:-8728}" \
        --set-env-vars="ROS_USER=${ROS_USER:-admin}" \
        --set-env-vars="ROS_PASS=${ROS_PASS}" \
        --set-env-vars="DATA_BACKEND=${DATA_BACKEND:-local}" \
        --set-env-vars="LLM_PROVIDER=${LLM_PROVIDER:-gemini}" \
        --set-env-vars="GEMINI_API_KEY=${GEMINI_API_KEY:-}" \
        --set-env-vars="GATEWAY_PORT=${GATEWAY_PORT:-19876}"
 
    SERVICE_URL=$(gcloud run services describe "$PROJECT_NAME" \
        --region "$REGION" --format 'value(status.url)')
    log_info "Deployed: ${SERVICE_URL}"
    log_info "Health check: curl -H 'Authorization: Bearer \$(gcloud auth print-identity-token)' ${SERVICE_URL}/health"
}


# ── Firebase ────────────────────────────────────────────
setup_firebase() {
    log_info "Deploying Firebase (rules, indexes, and hosting)..."
    command -v firebase >/dev/null 2>&1 || {
        log_warn "firebase-tools not installed — skipping (npm install -g firebase-tools)"
        return 0
    }
    firebase deploy --only firestore:indexes && log_info "Indexes deployed" \
        || log_warn "Indexes deployment skipped"
    firebase deploy --only firestore:rules && log_info "Rules deployed" \
        || log_warn "Rules deployment skipped"
    firebase deploy --only hosting && log_info "Hosting (www/) deployed" \
        || log_warn "Hosting deployment skipped"
}

# ── Firebase Hosting only ──────────────────────────────────
deploy_www() {
    log_info "Deploying www/ to Firebase Hosting..."
    command -v firebase >/dev/null 2>&1 || {
        log_error "firebase-tools not installed — run: npm install -g firebase-tools"
        exit 1
    }
    firebase deploy --only hosting && log_info "Hosting deployed ✔" \
        || { log_error "Hosting deploy failed"; exit 1; }
}

# ── Firebase local debug serve ─────────────────────────────
serve_www() {
    log_info "Starting Firebase local hosting server..."
    command -v firebase >/dev/null 2>&1 || {
        log_error "firebase-tools not installed — run: npm install -g firebase-tools"
        exit 1
    }
    log_info "Open http://localhost:5000 in your browser"
    firebase serve --only hosting
}

# ── Main ────────────────────────────────────────────
usage() {
    echo "Usage: $0 [build|deploy|firebase|www|serve|all]"
    echo "  build    — build and push Docker image only"
    echo "  deploy   — deploy to Cloud Run (requires prior build)"
    echo "  firebase — deploy Firestore rules, indexes, and Hosting (www/)"
    echo "  www      — deploy www/ to Firebase Hosting only"
    echo "  serve    — start Firebase local hosting server for debug (http://localhost:5000)"
    echo "  all      — run all steps (default)"
}
 
main() {
    check_prerequisites
    setup_environment
 
    case "${1:-all}" in
        build)    build_and_push ;;
        deploy)   deploy_cloud_run ;;
        firebase) setup_firebase ;;
        www)      deploy_www ;;
        serve)    serve_www ;;
        all)
            build_and_push
            deploy_cloud_run
            setup_firebase
            ;;
        --help|-h) usage ;;
        *)
            log_error "Unknown command: $1"
            usage
            exit 1
            ;;
    esac
 
    log_info "✅ Done."
}
 
main "$@"
 
