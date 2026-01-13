#!/bin/bash
# Cloud Run Deployment Script - Phase 3
# Data Warehouse Application
#
# Usage:
#   ./scripts/deploy-cloud-run.sh [command]
#
# Commands:
#   setup     - Set environment variables (run first)
#   backend   - Deploy backend service (3.1)
#   frontend  - Deploy frontend service (3.2)
#   cors      - Update backend CORS (3.3)
#   all       - Deploy everything in sequence
#   status    - Check deployment status

set -e

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================================================

# Required: Your Google Cloud Project ID
export PROJECT_ID="${PROJECT_ID:-your-project-id}"

# Required: Supabase Configuration (get from Supabase Dashboard > Settings > API)
export SUPABASE_URL="${SUPABASE_URL:-https://your-project.supabase.co}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-your-anon-key}"

# Region (default: Sydney)
export REGION="${REGION:-australia-southeast1}"

# Service names
export BACKEND_SERVICE="data-warehouse-api"
export FRONTEND_SERVICE="data-warehouse-frontend"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_header() {
    echo ""
    echo "=============================================="
    echo "$1"
    echo "=============================================="
    echo ""
}

check_config() {
    local missing=0

    if [[ "$PROJECT_ID" == "your-project-id" ]]; then
        echo "ERROR: PROJECT_ID not set. Please set it:"
        echo "  export PROJECT_ID=\"your-actual-project-id\""
        missing=1
    fi

    if [[ "$SUPABASE_URL" == "https://your-project.supabase.co" ]]; then
        echo "ERROR: SUPABASE_URL not set. Please set it:"
        echo "  export SUPABASE_URL=\"https://your-project.supabase.co\""
        missing=1
    fi

    if [[ "$SUPABASE_ANON_KEY" == "your-anon-key" ]]; then
        echo "ERROR: SUPABASE_ANON_KEY not set. Please set it:"
        echo "  export SUPABASE_ANON_KEY=\"your-anon-key\""
        missing=1
    fi

    if [[ $missing -eq 1 ]]; then
        echo ""
        echo "Get these values from:"
        echo "  - PROJECT_ID: Google Cloud Console"
        echo "  - SUPABASE_URL & SUPABASE_ANON_KEY: Supabase Dashboard > Settings > API"
        exit 1
    fi

    echo "Configuration validated:"
    echo "  PROJECT_ID: $PROJECT_ID"
    echo "  REGION: $REGION"
    echo "  SUPABASE_URL: $SUPABASE_URL"
    echo ""
}

# ============================================================================
# PHASE 3.1: DEPLOY BACKEND
# ============================================================================

deploy_backend() {
    print_header "Phase 3.1: Deploying Backend Service"
    check_config

    echo "Step 1: Building backend Docker image..."
    gcloud builds submit \
        --config cloudbuild-backend.yaml \
        --substitutions="_IMAGE_TAG=${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/backend:latest" \
        .

    echo ""
    echo "Step 2: Deploying backend to Cloud Run..."

    # Note: FRONTEND_URL will be updated after frontend deployment
    gcloud run deploy ${BACKEND_SERVICE} \
        --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/backend:latest \
        --region ${REGION} \
        --platform managed \
        --port 8001 \
        --memory 2Gi \
        --cpu 2 \
        --timeout 900 \
        --min-instances 0 \
        --max-instances 10 \
        --set-secrets="SUPABASE_CONNECTION_STRING=SUPABASE_CONNECTION_STRING:latest" \
        --set-secrets="SUPABASE_JWT_SECRET=SUPABASE_JWT_SECRET:latest" \
        --set-secrets="SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest" \
        --set-secrets="SUPABASE_URL=SUPABASE_URL:latest" \
        --set-secrets="XERO_CLIENT_ID=XERO_CLIENT_ID:latest" \
        --set-secrets="XERO_CLIENT_SECRET=XERO_CLIENT_SECRET:latest" \
        --set-secrets="XERO_TENANT_ID=XERO_TENANT_ID:latest" \
        --set-secrets="XERO_ENCRYPTION_KEY=XERO_ENCRYPTION_KEY:latest" \
        --set-secrets="SENDGRID_API_KEY=SENDGRID_API_KEY:latest" \
        --set-secrets="GOOGLE_API_KEY=GOOGLE_API_KEY:latest" \
        --set-env-vars="XERO_SCOPES=accounting.transactions accounting.transactions.read accounting.contacts.read accounting.settings.read" \
        --set-env-vars="ALLOWED_ORIGINS=http://localhost:5173" \
        --allow-unauthenticated

    BACKEND_URL=$(gcloud run services describe ${BACKEND_SERVICE} --region ${REGION} --format 'value(status.url)')
    echo ""
    echo "Backend deployed successfully!"
    echo "Backend URL: ${BACKEND_URL}"
    export BACKEND_URL
}

# ============================================================================
# PHASE 3.2: DEPLOY FRONTEND
# ============================================================================

deploy_frontend() {
    print_header "Phase 3.2: Deploying Frontend Service"
    check_config

    # Get backend URL
    BACKEND_URL=$(gcloud run services describe ${BACKEND_SERVICE} --region ${REGION} --format 'value(status.url)' 2>/dev/null || echo "")

    if [[ -z "$BACKEND_URL" ]]; then
        echo "ERROR: Backend service not found. Please deploy backend first:"
        echo "  ./scripts/deploy-cloud-run.sh backend"
        exit 1
    fi

    echo "Backend URL: ${BACKEND_URL}"
    echo ""

    echo "Step 1: Building frontend Docker image..."
    cd frontend
    gcloud builds submit \
        --config cloudbuild.yaml \
        --substitutions="_IMAGE_TAG=${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/frontend:latest,_VITE_SUPABASE_URL=${SUPABASE_URL},_VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY},_VITE_API_URL=${BACKEND_URL}" \
        .
    cd ..

    echo ""
    echo "Step 2: Deploying frontend to Cloud Run..."
    gcloud run deploy ${FRONTEND_SERVICE} \
        --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/frontend:latest \
        --region ${REGION} \
        --platform managed \
        --port 8080 \
        --memory 256Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 5 \
        --allow-unauthenticated

    FRONTEND_URL=$(gcloud run services describe ${FRONTEND_SERVICE} --region ${REGION} --format 'value(status.url)')
    echo ""
    echo "Frontend deployed successfully!"
    echo "Frontend URL: ${FRONTEND_URL}"
    export FRONTEND_URL
}

# ============================================================================
# PHASE 3.3: UPDATE BACKEND CORS
# ============================================================================

update_cors() {
    print_header "Phase 3.3: Updating Backend CORS"
    check_config

    # Get frontend URL
    FRONTEND_URL=$(gcloud run services describe ${FRONTEND_SERVICE} --region ${REGION} --format 'value(status.url)' 2>/dev/null || echo "")

    if [[ -z "$FRONTEND_URL" ]]; then
        echo "ERROR: Frontend service not found. Please deploy frontend first:"
        echo "  ./scripts/deploy-cloud-run.sh frontend"
        exit 1
    fi

    echo "Updating backend CORS with frontend URL: ${FRONTEND_URL}"

    gcloud run services update ${BACKEND_SERVICE} \
        --region ${REGION} \
        --update-env-vars="ALLOWED_ORIGINS=${FRONTEND_URL},FRONTEND_URL=${FRONTEND_URL}"

    echo ""
    echo "CORS updated successfully!"
}

# ============================================================================
# STATUS CHECK
# ============================================================================

check_status() {
    print_header "Deployment Status"

    echo "Cloud Run Services:"
    gcloud run services list --region ${REGION} 2>/dev/null || echo "  No services found or not authenticated"

    echo ""
    echo "Service URLs:"

    BACKEND_URL=$(gcloud run services describe ${BACKEND_SERVICE} --region ${REGION} --format 'value(status.url)' 2>/dev/null || echo "Not deployed")
    FRONTEND_URL=$(gcloud run services describe ${FRONTEND_SERVICE} --region ${REGION} --format 'value(status.url)' 2>/dev/null || echo "Not deployed")

    echo "  Backend:  ${BACKEND_URL}"
    echo "  Frontend: ${FRONTEND_URL}"

    if [[ "$BACKEND_URL" != "Not deployed" ]]; then
        echo ""
        echo "Testing backend health..."
        curl -s "${BACKEND_URL}/api/merchants" | head -c 200 || echo "  (request failed)"
    fi
}

# ============================================================================
# DEPLOY ALL
# ============================================================================

deploy_all() {
    print_header "Deploying All Services"

    deploy_backend
    deploy_frontend
    update_cors

    print_header "Deployment Complete!"

    BACKEND_URL=$(gcloud run services describe ${BACKEND_SERVICE} --region ${REGION} --format 'value(status.url)')
    FRONTEND_URL=$(gcloud run services describe ${FRONTEND_SERVICE} --region ${REGION} --format 'value(status.url)')

    echo "Your application is now deployed:"
    echo ""
    echo "  Frontend: ${FRONTEND_URL}"
    echo "  Backend:  ${BACKEND_URL}"
    echo ""
    echo "IMPORTANT: Complete Phase 3.4 manually:"
    echo ""
    echo "1. Go to Supabase Dashboard > Authentication > URL Configuration"
    echo "2. Update Site URL to: ${FRONTEND_URL}"
    echo "3. Add to Redirect URLs: ${FRONTEND_URL}/**"
    echo ""
    echo "See CLOUD_RUN_DEPLOYMENT.md for full instructions."
}

# ============================================================================
# MAIN
# ============================================================================

show_usage() {
    echo "Cloud Run Deployment Script - Phase 3"
    echo ""
    echo "Usage: ./scripts/deploy-cloud-run.sh [command]"
    echo ""
    echo "Commands:"
    echo "  setup     Show required environment variables"
    echo "  backend   Deploy backend service (Phase 3.1)"
    echo "  frontend  Deploy frontend service (Phase 3.2)"
    echo "  cors      Update backend CORS (Phase 3.3)"
    echo "  all       Deploy everything in sequence"
    echo "  status    Check deployment status"
    echo ""
    echo "Before running, set these environment variables:"
    echo "  export PROJECT_ID=\"your-gcp-project-id\""
    echo "  export SUPABASE_URL=\"https://your-project.supabase.co\""
    echo "  export SUPABASE_ANON_KEY=\"your-anon-key\""
    echo ""
}

case "${1:-}" in
    setup)
        print_header "Required Environment Variables"
        echo "Set these before running deployment commands:"
        echo ""
        echo "# Google Cloud Project ID"
        echo "export PROJECT_ID=\"your-gcp-project-id\""
        echo ""
        echo "# Supabase Configuration (Dashboard > Settings > API)"
        echo "export SUPABASE_URL=\"https://your-project.supabase.co\""
        echo "export SUPABASE_ANON_KEY=\"your-anon-key\""
        echo ""
        echo "# Optional: Change region (default: australia-southeast1)"
        echo "export REGION=\"australia-southeast1\""
        echo ""
        ;;
    backend)
        deploy_backend
        ;;
    frontend)
        deploy_frontend
        ;;
    cors)
        update_cors
        ;;
    all)
        deploy_all
        ;;
    status)
        check_status
        ;;
    *)
        show_usage
        ;;
esac
