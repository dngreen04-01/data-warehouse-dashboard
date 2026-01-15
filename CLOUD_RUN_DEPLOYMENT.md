# Google Cloud Run Deployment Plan - Data Warehouse Application

> **Multi-Session Project Plan**
> This is a substantial deployment project split into phases that can be completed across multiple Claude Code sessions.

> **File Location**: This plan should be saved as `CLOUD_RUN_DEPLOYMENT.md` in the project root.
> When this plan is approved, Claude will copy it to the project and add a reference in `CLAUDE.md`.

---

## Session Management Instructions

### For Claude Code (READ THIS FIRST)

When starting a new session on this project:

1. **Read this plan file first**: `CLOUD_RUN_DEPLOYMENT.md` (in project root)
2. **Check the Phase Tracker below** to see current progress
3. **Update phase status** after completing each phase:
   - `[ ]` = Not started
   - `[~]` = In progress
   - `[x]` = Completed
4. **Add completion notes** under each phase as you finish tasks
5. **Do not skip phases** - they have dependencies

### Starting a Session
Tell Claude: *"Continue the Cloud Run deployment - check the plan and resume from where we left off"*

### Phase Dependencies
```
Phase 1 (GCP Setup) → Phase 2 (Docker) → Phase 3 (Deploy) → Phase 4 (ETL) → Phase 5 (CI/CD) → Phase 6 (Verify)
                                              ↓
                                    Phase 3.4 (Supabase Auth Config)
```

---

## Phase Tracker

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1 | Google Cloud Setup | [x] | Completed - APIs enabled, secrets created |
| 2 | Create Dockerfiles & Config | [x] | Completed - all files created |
| 3 | Deploy Services | [x] | Backend & Frontend deployed, CORS configured |
| 3.4 | Supabase Auth Config | [x] | Redirect URLs configured |
| 4 | ETL Jobs Setup | [x] | Completed - jobs configured and tested |
| 5 | CI/CD Pipeline | [x] | Completed - GitHub Actions with WIF working |
| 6 | Verification & Testing | [x] | Completed - all services verified |

---

## Overview

Deploy a full-stack Data Warehouse application consisting of:
- **Backend**: FastAPI Python API (port 8001)
- **Frontend**: React + Vite static app
- **ETL Jobs**: Python scripts for Xero sync, reports, etc.
- **Database**: Supabase PostgreSQL (external, managed)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Google Cloud Run                             │
├─────────────────────┬─────────────────────┬─────────────────────┤
│  Frontend Service   │  Backend Service    │  ETL Jobs           │
│  (Static + nginx)   │  (FastAPI)          │  (Cloud Run Jobs)   │
│  Port 8080          │  Port 8001          │  Triggered by       │
│                     │                     │  Cloud Scheduler    │
└─────────────────────┴─────────────────────┴─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Supabase PostgreSQL │
                    │  (External)          │
                    └─────────────────────┘
```

---

## Phase 1: Prepare Application for Cloud Run

### 1.1 Create Backend Dockerfile

**File**: `/Dockerfile.backend`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY api/ ./api/
COPY src/ ./src/
COPY scripts/ ./scripts/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8001

# Expose port
EXPOSE 8001

# Run the application
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### 1.2 Create Frontend Dockerfile

**File**: `/frontend/Dockerfile`

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL

# Set environment variables for build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

### 1.3 Create Frontend nginx.conf

**File**: `/frontend/nginx.conf`

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # Handle SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 1.4 Parameterize CORS in Backend

**File to modify**: `/api/main.py`

Replace hardcoded CORS origins with environment variable:

```python
import os

# Get allowed origins from environment variable
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 1.5 Create .dockerignore files

**File**: `/.dockerignore`
```
.git
.gitignore
.env
.env.*
__pycache__
*.pyc
*.pyo
.pytest_cache
.coverage
htmlcov
node_modules
frontend/node_modules
frontend/dist
*.md
.github
.vscode
archive/
output/
```

**File**: `/frontend/.dockerignore`
```
node_modules
dist
.env
.env.*
*.md
```

---

---

## PHASE 1: Google Cloud Setup (User Actions Required)

> **Who does this**: User (manual)
> **Estimated time**: 15-30 minutes
> **Prerequisites**: Google Cloud account with billing enabled

### Task Checklist
- [x] 1.1 Create or select a Google Cloud Project
- [x] 1.2 Enable billing on the project
- [x] 1.3 Install Google Cloud SDK (`gcloud`) locally
- [x] 1.4 Enable required APIs
- [x] 1.5 Create Artifact Registry repository
- [x] 1.6 Create secrets in Secret Manager
- [x] 1.7 Configure Supabase authentication hook

### 1.1-1.3 Prerequisites

**User Action Required:**
1. Create or select a Google Cloud Project
2. Enable billing on the project
3. Install Google Cloud SDK (`gcloud`) locally

### 1.4 Enable Required APIs

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    cloudscheduler.googleapis.com
```

### 1.5 Create Artifact Registry Repository

```bash
# Create a Docker repository
gcloud artifacts repositories create data-warehouse \
    --repository-format=docker \
    --location=australia-southeast1 \
    --description="Data Warehouse Docker images"
```

### 1.6 Create Secrets in Secret Manager

**User Action Required:** Create secrets for sensitive values:

```bash
# Database connection
echo -n "your-supabase-connection-string" | \
    gcloud secrets create SUPABASE_CONNECTION_STRING --data-file=-

# Supabase Authentication (REQUIRED for RBAC system)
echo -n "your-supabase-jwt-secret" | \
    gcloud secrets create SUPABASE_JWT_SECRET --data-file=-
# Get JWT secret from: Supabase Dashboard > Settings > API > JWT Secret

echo -n "your-supabase-service-role-key" | \
    gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
# Get service role key from: Supabase Dashboard > Settings > API > service_role key
# Required for: user invitations, admin operations

echo -n "https://your-project.supabase.co" | \
    gcloud secrets create SUPABASE_URL --data-file=-

# Xero OAuth credentials
echo -n "your-xero-client-id" | \
    gcloud secrets create XERO_CLIENT_ID --data-file=-

echo -n "your-xero-client-secret" | \
    gcloud secrets create XERO_CLIENT_SECRET --data-file=-

echo -n "your-xero-tenant-id" | \
    gcloud secrets create XERO_TENANT_ID --data-file=-

echo -n "your-xero-encryption-key" | \
    gcloud secrets create XERO_ENCRYPTION_KEY --data-file=-

# SendGrid
echo -n "your-sendgrid-api-key" | \
    gcloud secrets create SENDGRID_API_KEY --data-file=-

# Google API (Gemini)
echo -n "your-google-api-key" | \
    gcloud secrets create GOOGLE_API_KEY --data-file=-
```

### 1.7 Configure Supabase Authentication Hook

**User Action Required:** Register the custom access token hook in Supabase:

1. Go to Supabase Dashboard > Authentication > Hooks
2. Enable "Customize Access Token (JWT) Claims"
3. Select the function: `public.custom_access_token_hook`
4. Save changes

This hook injects `user_role` and `permissions` into the JWT token, which the backend uses for authorization.

**Phase 1 Completion**: Update the Phase Tracker table above when all tasks are complete.

---

## PHASE 2: Create Dockerfiles & Config (Claude Can Implement)

> **Who does this**: Claude Code
> **Estimated time**: 10-15 minutes
> **Prerequisites**: Phase 1 complete

### Task Checklist
- [x] 2.1 Create `/Dockerfile.backend`
- [x] 2.2 Create `/frontend/Dockerfile`
- [x] 2.3 Create `/frontend/nginx.conf`
- [x] 2.4 Create `/Dockerfile.etl`
- [x] 2.5 Create `/.dockerignore`
- [x] 2.6 Create `/frontend/.dockerignore`
- [x] 2.7 Modify `/api/main.py` to parameterize CORS

The Dockerfile templates are already defined in Phase 1 sections 1.1-1.5 above.

**Phase 2 Completed**: All Docker configuration files created and CORS parameterized.

---

## PHASE 3: Deploy Services (Manual Commands)

> **Who does this**: User (with Claude guidance)
> **Estimated time**: 20-30 minutes
> **Prerequisites**: Phase 1 and Phase 2 complete

### Task Checklist
- [ ] 3.1 Build and deploy backend service
- [ ] 3.2 Build and deploy frontend service
- [ ] 3.3 Update backend CORS with frontend URL
- [ ] 3.4 Configure Supabase Auth for Cloud Run URLs

### 3.1 Deploy Backend Service

```bash
export PROJECT_ID="your-project-id"
export REGION="australia-southeast1"
export FRONTEND_URL="https://your-frontend-url.run.app"  # Update after frontend deploy

# Build and push backend image
gcloud builds submit \
    --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/backend:latest \
    --file Dockerfile.backend .

# Deploy backend service
gcloud run deploy data-warehouse-api \
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
    --set-env-vars="ALLOWED_ORIGINS=${FRONTEND_URL}" \
    --set-env-vars="FRONTEND_URL=${FRONTEND_URL}" \
    --allow-unauthenticated
```

### 3.2 Deploy Frontend Service

```bash
export BACKEND_URL=$(gcloud run services describe data-warehouse-api --region ${REGION} --format 'value(status.url)')

# Build and push frontend image (with build args)
cd frontend
gcloud builds submit \
    --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/frontend:latest \
    --build-arg VITE_SUPABASE_URL="https://your-project.supabase.co" \
    --build-arg VITE_SUPABASE_ANON_KEY="your-anon-key" \
    --build-arg VITE_API_URL="${BACKEND_URL}"

# Deploy frontend service
gcloud run deploy data-warehouse-frontend \
    --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/frontend:latest \
    --region ${REGION} \
    --platform managed \
    --port 8080 \
    --memory 256Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 5 \
    --allow-unauthenticated

cd ..
```

### 3.3 Update Backend CORS with Frontend URL

```bash
export FRONTEND_URL=$(gcloud run services describe data-warehouse-frontend --region ${REGION} --format 'value(status.url)')

# Update backend with correct frontend URL
gcloud run services update data-warehouse-api \
    --region ${REGION} \
    --update-env-vars="ALLOWED_ORIGINS=${FRONTEND_URL},FRONTEND_URL=${FRONTEND_URL}"
```

### 3.4 Configure Supabase Auth for Cloud Run (CRITICAL)

**User Action Required:** Update Supabase to work with Cloud Run URLs:

#### Step 1: Update Redirect URLs
1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Add your Cloud Run frontend URL to **Redirect URLs**:
   ```
   https://data-warehouse-frontend-XXXXXX-ts.a.run.app/**
   ```
   (Replace with your actual Cloud Run URL)

#### Step 2: Update Site URL
1. In the same page, update **Site URL** to your Cloud Run frontend URL:
   ```
   https://data-warehouse-frontend-XXXXXX-ts.a.run.app
   ```

#### Step 3: Email Template Configuration
1. Go to Authentication > Email Templates
2. Update the **Confirm signup** and **Magic Link** templates
3. Ensure the `{{ .ConfirmationURL }}` variable is used (Supabase auto-appends the redirect)

**Note:** The magic link emails will redirect users to your Cloud Run frontend URL after authentication.

#### Authentication Flow in Production
```
1. User enters email on Cloud Run frontend
2. signInWithOtp() → Supabase sends magic link email
3. Magic link contains: https://your-project.supabase.co/auth/v1/verify?...&redirect_to=https://your-cloudrun-frontend.run.app
4. User clicks → Supabase verifies → Redirects to Cloud Run frontend with session
5. Frontend extracts session, stores tokens
6. API calls include: Authorization: Bearer {access_token}
7. Backend verifies JWT using SUPABASE_JWT_SECRET
```

**Phase 3 Completion**: Update the Phase Tracker table above when all tasks are complete.

---

## PHASE 4: ETL Jobs Setup (Manual Commands)

> **Who does this**: User (with Claude guidance)
> **Estimated time**: 15-20 minutes
> **Prerequisites**: Phase 3 complete (backend deployed)

### Task Checklist
- [x] 4.1 Build and push ETL Docker image
- [x] 4.2 Create daily-xero-sync Cloud Run Job + Scheduler
- [x] 4.3 Create daily-items-sync Cloud Run Job + Scheduler
- [x] 4.4 Create daily-budget-sync Cloud Run Job + Scheduler
- [x] 4.5 Create weekly-email-reports Cloud Run Job + Scheduler
- [x] 4.6 Test jobs manually

### 4.1 Create ETL Job Dockerfile

**File**: `/Dockerfile.etl`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY scripts/ ./scripts/

ENV PYTHONUNBUFFERED=1
```

### 4.2 Deploy Daily Sync Job

```bash
# Build ETL image
gcloud builds submit \
    --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/etl:latest \
    --file Dockerfile.etl .

# Create Cloud Run Job for daily sync
gcloud run jobs create daily-xero-sync \
    --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/etl:latest \
    --region ${REGION} \
    --memory 1Gi \
    --cpu 1 \
    --max-retries 3 \
    --task-timeout 30m \
    --set-secrets="SUPABASE_CONNECTION_STRING=SUPABASE_CONNECTION_STRING:latest" \
    --set-secrets="XERO_CLIENT_ID=XERO_CLIENT_ID:latest" \
    --set-secrets="XERO_CLIENT_SECRET=XERO_CLIENT_SECRET:latest" \
    --set-secrets="XERO_TENANT_ID=XERO_TENANT_ID:latest" \
    --set-secrets="XERO_ENCRYPTION_KEY=XERO_ENCRYPTION_KEY:latest" \
    --set-env-vars="XERO_SCOPES=accounting.transactions accounting.transactions.read accounting.contacts.read accounting.settings.read" \
    --command="python" \
    --args="-m,src.ingestion.sync_xero"

# Schedule daily sync (6:00 AM UTC)
gcloud scheduler jobs create http daily-xero-sync-trigger \
    --location ${REGION} \
    --schedule "0 6 * * *" \
    --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/daily-xero-sync:run" \
    --http-method POST \
    --oauth-service-account-email "${PROJECT_ID}@appspot.gserviceaccount.com"
```

### 4.3 Deploy Items Sync Job

```bash
gcloud run jobs create daily-items-sync \
    --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/etl:latest \
    --region ${REGION} \
    --memory 1Gi \
    --cpu 1 \
    --max-retries 3 \
    --task-timeout 30m \
    --set-secrets="SUPABASE_CONNECTION_STRING=SUPABASE_CONNECTION_STRING:latest" \
    --set-secrets="XERO_CLIENT_ID=XERO_CLIENT_ID:latest" \
    --set-secrets="XERO_CLIENT_SECRET=XERO_CLIENT_SECRET:latest" \
    --set-secrets="XERO_TENANT_ID=XERO_TENANT_ID:latest" \
    --set-secrets="XERO_ENCRYPTION_KEY=XERO_ENCRYPTION_KEY:latest" \
    --command="python" \
    --args="-m,src.ingestion.sync_items"

# Schedule items sync (12:00 PM UTC)
gcloud scheduler jobs create http daily-items-sync-trigger \
    --location ${REGION} \
    --schedule "0 12 * * *" \
    --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/daily-items-sync:run" \
    --http-method POST \
    --oauth-service-account-email "${PROJECT_ID}@appspot.gserviceaccount.com"
```

### 4.4 Deploy Budget Sync Job

```bash
gcloud run jobs create daily-budget-sync \
    --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/etl:latest \
    --region ${REGION} \
    --memory 1Gi \
    --cpu 1 \
    --max-retries 3 \
    --task-timeout 30m \
    --set-secrets="SUPABASE_CONNECTION_STRING=SUPABASE_CONNECTION_STRING:latest" \
    --set-secrets="XERO_CLIENT_ID=XERO_CLIENT_ID:latest" \
    --set-secrets="XERO_CLIENT_SECRET=XERO_CLIENT_SECRET:latest" \
    --set-secrets="XERO_TENANT_ID=XERO_TENANT_ID:latest" \
    --set-secrets="XERO_ENCRYPTION_KEY=XERO_ENCRYPTION_KEY:latest" \
    --command="python" \
    --args="-m,src.ingestion.sync_budgets"

# Schedule budget sync (after Xero sync, 7:00 AM UTC)
gcloud scheduler jobs create http daily-budget-sync-trigger \
    --location ${REGION} \
    --schedule "0 7 * * *" \
    --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/daily-budget-sync:run" \
    --http-method POST \
    --oauth-service-account-email "${PROJECT_ID}@appspot.gserviceaccount.com"
```

### 4.5 Deploy Weekly Email Reports Job

```bash
gcloud run jobs create weekly-email-reports \
    --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/data-warehouse/etl:latest \
    --region ${REGION} \
    --memory 1Gi \
    --cpu 1 \
    --max-retries 3 \
    --task-timeout 30m \
    --set-secrets="SUPABASE_CONNECTION_STRING=SUPABASE_CONNECTION_STRING:latest" \
    --set-secrets="SENDGRID_API_KEY=SENDGRID_API_KEY:latest" \
    --command="python" \
    --args="-m,src.reporting.weekly_email"

# Schedule weekly reports (Monday 8:00 AM UTC)
gcloud scheduler jobs create http weekly-email-reports-trigger \
    --location ${REGION} \
    --schedule "0 8 * * 1" \
    --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/weekly-email-reports:run" \
    --http-method POST \
    --oauth-service-account-email "${PROJECT_ID}@appspot.gserviceaccount.com"
```

**Phase 4 Completion**: Update the Phase Tracker table above when all tasks are complete.

---

## PHASE 5: CI/CD Pipeline (Claude Can Implement + User Setup)

> **Who does this**: Claude Code (workflow file) + User (WIF setup, GitHub secrets)
> **Estimated time**: 20-30 minutes
> **Prerequisites**: Phase 3 complete (services deployed)

### Task Checklist
- [x] 5.1 Create `.github/workflows/deploy-cloud-run.yml` (Claude)
- [x] 5.2 Set up Workload Identity Federation (User)
- [x] 5.3 Add GitHub repository secrets (User)
- [x] 5.4 Test deployment pipeline

### 5.1 Create GitHub Actions Workflow

**File**: `.github/workflows/deploy-cloud-run.yml`

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: australia-southeast1
  BACKEND_SERVICE: data-warehouse-api
  FRONTEND_SERVICE: data-warehouse-frontend

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      - name: Build and Push Backend
        run: |
          docker build -f Dockerfile.backend -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/backend:${{ github.sha }} .
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/backend:${{ github.sha }}

      - name: Deploy Backend to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.BACKEND_SERVICE }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/backend:${{ github.sha }}

  deploy-frontend:
    runs-on: ubuntu-latest
    needs: deploy-backend
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Get Backend URL
        id: backend
        run: |
          BACKEND_URL=$(gcloud run services describe ${{ env.BACKEND_SERVICE }} --region ${{ env.REGION }} --format 'value(status.url)')
          echo "url=${BACKEND_URL}" >> $GITHUB_OUTPUT

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      - name: Build and Push Frontend
        working-directory: frontend
        run: |
          docker build \
            --build-arg VITE_SUPABASE_URL=${{ secrets.VITE_SUPABASE_URL }} \
            --build-arg VITE_SUPABASE_ANON_KEY=${{ secrets.VITE_SUPABASE_ANON_KEY }} \
            --build-arg VITE_API_URL=${{ steps.backend.outputs.url }} \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/frontend:${{ github.sha }} .
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/frontend:${{ github.sha }}

      - name: Deploy Frontend to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.FRONTEND_SERVICE }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/data-warehouse/frontend:${{ github.sha }}

      - name: Update Backend CORS
        run: |
          FRONTEND_URL=$(gcloud run services describe ${{ env.FRONTEND_SERVICE }} --region ${{ env.REGION }} --format 'value(status.url)')
          gcloud run services update ${{ env.BACKEND_SERVICE }} \
            --region ${{ env.REGION }} \
            --set-env-vars="ALLOWED_ORIGINS=${FRONTEND_URL}"
```

### 5.2 Set Up Workload Identity Federation

**User Action Required:**

```bash
# Create a Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
    --location="global" \
    --display-name="GitHub Actions Pool"

# Create a Workload Identity Provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
    --location="global" \
    --workload-identity-pool="github-pool" \
    --display-name="GitHub Provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com"

# Create a Service Account for GitHub Actions
gcloud iam service-accounts create github-actions-sa \
    --display-name="GitHub Actions Service Account"

# Grant necessary roles
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Allow GitHub Actions to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
    github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/YOUR_GITHUB_ORG/YOUR_REPO_NAME"
```

### 5.3 GitHub Secrets to Configure

**User Action Required:** Add these secrets to your GitHub repository:

| Secret Name | Description |
|-------------|-------------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `WIF_PROVIDER` | `projects/{PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | `github-actions-sa@{PROJECT_ID}.iam.gserviceaccount.com` |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anonymous key |

**Phase 5 Completion**: Update the Phase Tracker table above when all tasks are complete.

---

## PHASE 6: Verification & Testing (Manual)

> **Who does this**: User (with Claude guidance)
> **Estimated time**: 15-20 minutes
> **Prerequisites**: All previous phases complete

### Task Checklist
- [x] 6.1 Verify service deployments are healthy
- [x] 6.2 Test backend API endpoints
- [x] 6.3 Test frontend loads correctly
- [x] 6.4 Test authentication flow (CORS verified, magic link requires manual test)
- [x] 6.5 Test ETL jobs execute successfully
- [x] 6.6 Verify CI/CD pipeline triggers on push

### 6.1 Verify Deployments

```bash
# Check service status
gcloud run services list --region ${REGION}

# Get service URLs
gcloud run services describe data-warehouse-api --region ${REGION} --format 'value(status.url)'
gcloud run services describe data-warehouse-frontend --region ${REGION} --format 'value(status.url)'

# Check logs
gcloud run services logs read data-warehouse-api --region ${REGION} --limit 50
gcloud run services logs read data-warehouse-frontend --region ${REGION} --limit 50
```

### 6.2 Test Endpoints

```bash
# Test backend health
BACKEND_URL=$(gcloud run services describe data-warehouse-api --region ${REGION} --format 'value(status.url)')
curl ${BACKEND_URL}/api/merchants

# Test frontend
FRONTEND_URL=$(gcloud run services describe data-warehouse-frontend --region ${REGION} --format 'value(status.url)')
curl -I ${FRONTEND_URL}
```

### 6.3 Verify ETL Jobs

```bash
# List jobs
gcloud run jobs list --region ${REGION}

# Execute job manually
gcloud run jobs execute daily-xero-sync --region ${REGION}

# Check execution status
gcloud run jobs executions list --job daily-xero-sync --region ${REGION}
```

**Phase 6 Completed** (2026-01-13):
- Services verified healthy: `data-warehouse-api`, `data-warehouse-frontend`
- Backend API returning data (merchants endpoint tested)
- Frontend serving HTML with 200 status
- CORS properly configured for authentication flow
- ETL jobs executing on schedule (daily-xero-sync, daily-budget-sync, daily-items-sync)
- CI/CD pipeline triggered and completed successfully on push to main
- Cloud Scheduler jobs enabled for all ETL tasks

---

## PROJECT COMPLETE

When all phases show `[x]` in the Phase Tracker:

1. **Remove old GitHub Actions ETL workflows** (now replaced by Cloud Scheduler)
2. **Update CLAUDE.md** with production URLs
3. **Document any custom configurations** made during deployment
4. **Set up monitoring alerts** in Google Cloud Console (optional)

---

## Summary: Files to Create/Modify

### New Files
1. `/Dockerfile.backend` - Backend container definition
2. `/frontend/Dockerfile` - Frontend container definition
3. `/frontend/nginx.conf` - nginx configuration for SPA
4. `/Dockerfile.etl` - ETL jobs container definition
5. `/.dockerignore` - Root dockerignore
6. `/frontend/.dockerignore` - Frontend dockerignore
7. `.github/workflows/deploy-cloud-run.yml` - CI/CD workflow

### Files to Modify
1. `/api/main.py` - Parameterize CORS origins with `ALLOWED_ORIGINS` env var

### Authentication Components (Already Implemented - No Changes Needed)
- `/api/auth.py` - JWT verification using `SUPABASE_JWT_SECRET` ✓
- `/frontend/src/contexts/AuthContext.tsx` - Auth state management ✓
- `/frontend/src/components/PermissionGate.tsx` - Role-based UI access ✓
- `supabase/migrations/*_rbac_system.sql` - RBAC tables and hooks ✓

---

## User Input Required

Before proceeding, please provide:

1. **Google Cloud Project ID**: The GCP project to deploy to
2. **GitHub Repository**: Full path (e.g., `username/repo-name`) for Workload Identity Federation
3. **Supabase Credentials** (from Supabase Dashboard > Settings > API):
   - `VITE_SUPABASE_URL` - Project URL
   - `VITE_SUPABASE_ANON_KEY` - anon/public key
   - `SUPABASE_JWT_SECRET` - JWT secret (for backend auth)
   - `SUPABASE_SERVICE_ROLE_KEY` - service_role key (for admin operations)
4. **Custom Domain** (optional): If you want to use a custom domain instead of Cloud Run URLs

**Selected Configuration:**
- Region: `australia-southeast1` (Sydney)
- CI/CD: GitHub Actions with Workload Identity Federation
- ETL: Full migration to Cloud Run Jobs + Cloud Scheduler
- Authentication: Supabase Auth with RBAC (role-based access control)

---

## Authentication Troubleshooting Guide

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Magic link redirects to localhost | Site URL not updated in Supabase | Update Site URL in Supabase Dashboard > Auth > URL Configuration |
| "Invalid JWT" errors | Missing or wrong `SUPABASE_JWT_SECRET` | Verify secret matches Supabase Dashboard > Settings > API > JWT Secret |
| User has no role after signup | Custom hook not registered | Enable hook in Supabase Dashboard > Authentication > Hooks |
| CORS errors on login | `ALLOWED_ORIGINS` doesn't include frontend URL | Update backend env var with Cloud Run frontend URL |
| Invitations fail to send | Missing `SUPABASE_SERVICE_ROLE_KEY` | Add service role key to Cloud Run secrets |
| Permission denied after login | Role/permissions not in JWT | Check custom_access_token_hook is running, verify dw.user_roles has entry |

### Verifying Authentication Works

```bash
# 1. Check backend can verify JWTs
curl -X GET "${BACKEND_URL}/api/users" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

# 2. Check CORS headers
curl -I -X OPTIONS "${BACKEND_URL}/api/users" \
  -H "Origin: ${FRONTEND_URL}" \
  -H "Access-Control-Request-Method: GET"

# 3. Check environment variables are set
gcloud run services describe data-warehouse-api \
  --region ${REGION} \
  --format 'value(spec.template.spec.containers[0].env)'
```

---

## Cost Estimate

Based on typical usage:
- **Cloud Run Services**: ~$5-20/month (pay per use, min instances = 0)
- **Artifact Registry**: ~$0.10/GB/month
- **Secret Manager**: ~$0.06/secret version/month
- **Cloud Scheduler**: First 3 jobs free, then $0.10/job/month
- **Cloud Build**: 120 free build-minutes/day

**Total estimated**: $10-30/month for moderate usage
