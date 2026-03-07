#!/usr/bin/env bash
# deploy-all.sh — Bootstrap the full AWS infrastructure from scratch.
#
# Prerequisites:
#   - AWS CLI configured with admin credentials
#   - Set GITHUB_ORG, GITHUB_REPO, APP_DOMAIN, COGNITO_DOMAIN_PREFIX env vars
#
# Usage:
#   export GITHUB_ORG=myorg
#   export GITHUB_REPO=scheduleMarketplace
#   export APP_DOMAIN=https://schedulemarketplace.com   # or http://localhost:5173 for dev
#   export COGNITO_DOMAIN_PREFIX=ncaa-schedule-marketplace
#   export AWS_REGION=us-east-2
#   export ENVIRONMENT=prod
#
#   chmod +x infra/scripts/deploy-all.sh
#   ./infra/scripts/deploy-all.sh

set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
ENV="${ENVIRONMENT:-prod}"
STACK_PREFIX="ncaa-marketplace"
CFN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../cfn" && pwd)"

: "${GITHUB_ORG:?Set GITHUB_ORG}"
: "${GITHUB_REPO:?Set GITHUB_REPO}"
: "${APP_DOMAIN:=http://localhost:5173}"
: "${COGNITO_DOMAIN_PREFIX:=ncaa-schedule-marketplace}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[deploy-all]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }

deploy_stack() {
  local stack_name="$1"
  local template="$2"
  shift 2
  local params=("$@")

  log "Deploying stack: $stack_name"

  aws cloudformation deploy \
    --region "$REGION" \
    --stack-name "$stack_name" \
    --template-file "$template" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    ${params[@]+"${params[@]}"}

  log "Stack $stack_name — done"
}

# -------------------------
# 1. GitHub OIDC + Deploy Role
# -------------------------
log "=== Step 1: GitHub OIDC Provider & Deploy Role ==="
deploy_stack \
  "${STACK_PREFIX}-github-oidc-${ENV}" \
  "${CFN_DIR}/01-github-oidc.yml" \
  --parameter-overrides \
    "GitHubOrg=${GITHUB_ORG}" \
    "GitHubRepo=${GITHUB_REPO}" \
    "Environment=${ENV}"

ROLE_ARN=$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "${STACK_PREFIX}-github-oidc-${ENV}" \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text)

log "GitHub Actions Role ARN: ${ROLE_ARN}"
warn "Add this as GitHub secret AWS_DEPLOY_ROLE: ${ROLE_ARN}"

# -------------------------
# 2. Storage (DynamoDB + S3)
# -------------------------
log "=== Step 2: Storage (DynamoDB + S3) ==="
deploy_stack \
  "${STACK_PREFIX}-storage-${ENV}" \
  "${CFN_DIR}/02-storage.yml" \
  --parameter-overrides \
    "Environment=${ENV}"

DEPLOY_BUCKET=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/deploy-bucket" \
  --query Parameter.Value --output text)

log "Deploy bucket: ${DEPLOY_BUCKET}"
warn "Add this as GitHub secret DEPLOY_BUCKET: ${DEPLOY_BUCKET}"

# -------------------------
# 3. Cognito
# -------------------------
log "=== Step 3: Cognito User Pool ==="
deploy_stack \
  "${STACK_PREFIX}-cognito-${ENV}" \
  "${CFN_DIR}/03-cognito.yml" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "AppDomain=${APP_DOMAIN}" \
    "CognitoDomainPrefix=${COGNITO_DOMAIN_PREFIX}"

COGNITO_DOMAIN=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/cognito-domain" \
  --query Parameter.Value --output text)

COGNITO_CLIENT_ID=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/cognito-client-id" \
  --query Parameter.Value --output text)

log "Cognito domain: ${COGNITO_DOMAIN}"
warn "Add GitHub secret VITE_COGNITO_DOMAIN: ${COGNITO_DOMAIN}"
warn "Add GitHub secret VITE_COGNITO_CLIENT_ID: ${COGNITO_CLIENT_ID}"

# -------------------------
# 4. Lambda + API Gateway
# -------------------------
log "=== Step 4: Lambda + API Gateway ==="
deploy_stack \
  "${STACK_PREFIX}-lambda-${ENV}" \
  "${CFN_DIR}/04-lambda.yml" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "DeployBucket=/ncaa-marketplace/${ENV}/deploy-bucket" \
    "TeamsTable=/ncaa-marketplace/${ENV}/teams-table" \
    "SchedulesTable=/ncaa-marketplace/${ENV}/schedules-table" \
    "MarketplaceTable=/ncaa-marketplace/${ENV}/marketplace-table" \
    "ImportJobsTable=/ncaa-marketplace/${ENV}/import-jobs-table" \
    "ImportBucket=/ncaa-marketplace/${ENV}/import-bucket" \
    "ScraperBucket=/ncaa-marketplace/${ENV}/scraper-bucket" \
    "CognitoUserPoolId=/ncaa-marketplace/${ENV}/cognito-user-pool-id" \
    "CognitoClientId=/ncaa-marketplace/${ENV}/cognito-client-id"

API_URL=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/api-url" \
  --query Parameter.Value --output text)

log "API Gateway URL: ${API_URL}"
warn "Add GitHub secret VITE_API_BASE: ${API_URL}"

# -------------------------
# 5. CDN (CloudFront)
# -------------------------
log "=== Step 5: CloudFront CDN ==="
deploy_stack \
  "${STACK_PREFIX}-cdn-${ENV}" \
  "${CFN_DIR}/05-cdn.yml" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "FrontendBucketName=/ncaa-marketplace/${ENV}/frontend-bucket"

CF_DIST_ID=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/cloudfront-distribution-id" \
  --query Parameter.Value --output text)

CF_DOMAIN=$(aws ssm get-parameter \
  --region "$REGION" \
  --name "/ncaa-marketplace/${ENV}/cloudfront-domain" \
  --query Parameter.Value --output text)

log "CloudFront distribution: ${CF_DIST_ID}"
log "Frontend URL: https://${CF_DOMAIN}"
warn "Add GitHub secret CLOUDFRONT_DISTRIBUTION_ID: ${CF_DIST_ID}"

# -------------------------
# Summary
# -------------------------
echo ""
log "=== All stacks deployed successfully! ==="
echo ""
echo "Required GitHub Secrets:"
echo "  AWS_DEPLOY_ROLE             = ${ROLE_ARN}"
echo "  AWS_REGION                  = ${REGION}"
echo "  DEPLOY_BUCKET               = ${DEPLOY_BUCKET}"
echo "  CLOUDFRONT_DISTRIBUTION_ID  = ${CF_DIST_ID}"
echo "  VITE_API_BASE               = ${API_URL}"
echo "  VITE_COGNITO_DOMAIN         = ${COGNITO_DOMAIN}"
echo "  VITE_COGNITO_CLIENT_ID      = ${COGNITO_CLIENT_ID}"
echo ""
echo "Frontend: https://${CF_DOMAIN}"
echo "API:      ${API_URL}/health"
