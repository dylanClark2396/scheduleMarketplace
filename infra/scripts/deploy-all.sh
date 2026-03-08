#!/usr/bin/env bash
# deploy-all.sh — Bootstrap the full AWS infrastructure from scratch.
#
# Prerequisites:
#   - AWS CLI configured with admin credentials
#
# Usage:
#   ./infra/scripts/deploy-all.sh \
#     --org myorg \
#     --repo scheduleMarketplace \
#     [--domain http://localhost:5173] \
#     [--cognito-prefix schedule-marketplace] \
#     [--region us-east-1] \
#     [--env prod]

set -euo pipefail

export MSYS_NO_PATHCONV=1  # prevent Git Bash on Windows from converting /paths to C:/...

# -------------------------
# Argument parsing
# -------------------------
REGION="us-east-1"
ENV="prod"
APP_DOMAIN="http://localhost:5173"
COGNITO_DOMAIN_PREFIX="schedule-marketplace"
GITHUB_ORG=""
GITHUB_REPO=""

usage() {
  echo "Usage: $0 --org <github-org> --repo <github-repo> [options]"
  echo ""
  echo "Required:"
  echo "  --org    <org>     GitHub org or username"
  echo "  --repo   <repo>    GitHub repository name"
  echo ""
  echo "Optional:"
  echo "  --domain  <url>    App domain (default: http://localhost:5173)"
  echo "  --cognito-prefix   Cognito hosted UI prefix (default: schedule-marketplace)"
  echo "  --region  <region> AWS region (default: us-east-1)"
  echo "  --env     <env>    Environment: prod|dev (default: prod)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org)            GITHUB_ORG="$2";            shift 2 ;;
    --repo)           GITHUB_REPO="$2";           shift 2 ;;
    --domain)         APP_DOMAIN="$2";            shift 2 ;;
    --cognito-prefix) COGNITO_DOMAIN_PREFIX="$2"; shift 2 ;;
    --region)         REGION="$2";               shift 2 ;;
    --env)            ENV="$2";                  shift 2 ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$GITHUB_ORG" || -z "$GITHUB_REPO" ]] && usage

STACK_PREFIX="schedule-marketplace"
CFN_DIR="$(cygpath -w "$(cd "$(dirname "${BASH_SOURCE[0]}")/../cfn" && pwd)")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy-all]${NC} $*"; }
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

# -------------------------
# 2. Storage (DynamoDB + S3)
# -------------------------
log "=== Step 2: Storage (DynamoDB + S3) ==="
deploy_stack \
  "${STACK_PREFIX}-storage-${ENV}" \
  "${CFN_DIR}/02-storage.yml" \
  --parameter-overrides \
    "Environment=${ENV}"

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

# -------------------------
# 4. Lambda + API Gateway
# -------------------------
log "=== Step 4: Lambda + API Gateway ==="
deploy_stack \
  "${STACK_PREFIX}-lambda-${ENV}" \
  "${CFN_DIR}/04-lambda.yml" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "DeployBucket=/schedule-marketplace/${ENV}/deploy-bucket" \
    "TeamsTable=/schedule-marketplace/${ENV}/teams-table" \
    "SchedulesTable=/schedule-marketplace/${ENV}/schedules-table" \
    "MarketplaceTable=/schedule-marketplace/${ENV}/marketplace-table" \
    "ImportJobsTable=/schedule-marketplace/${ENV}/import-jobs-table" \
    "ImportBucket=/schedule-marketplace/${ENV}/import-bucket" \
    "ScraperBucket=/schedule-marketplace/${ENV}/scraper-bucket" \
    "CognitoUserPoolId=/schedule-marketplace/${ENV}/cognito-user-pool-id" \
    "CognitoClientId=/schedule-marketplace/${ENV}/cognito-client-id"

# -------------------------
# 5. CDN (CloudFront)
# -------------------------
log "=== Step 5: CloudFront CDN ==="
deploy_stack \
  "${STACK_PREFIX}-cdn-${ENV}" \
  "${CFN_DIR}/05-cdn.yml" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "FrontendBucketName=/schedule-marketplace/${ENV}/frontend-bucket"

# -------------------------
# Summary — read outputs from SSM
# -------------------------
get_param() {
  aws ssm get-parameter --region "$REGION" --name "/schedule-marketplace/${ENV}/$1" \
    --query Parameter.Value --output text 2>/dev/null || echo "(not found)"
}

DEPLOY_BUCKET=$(get_param deploy-bucket)
COGNITO_DOMAIN=$(get_param cognito-domain)
COGNITO_CLIENT_ID=$(get_param cognito-client-id)
API_URL=$(get_param api-url)
CF_DIST_ID=$(get_param cloudfront-distribution-id)
CF_DOMAIN=$(get_param cloudfront-domain)

echo ""
log "=== All stacks deployed successfully! ==="
echo ""
echo "Required GitHub Secrets:"
echo "  AWS_DEPLOY_ROLE             = ${ROLE_ARN}"
echo "  AWS_REGION                  = ${REGION}"
echo "  VITE_API_BASE               = ${API_URL}"
echo "  VITE_COGNITO_DOMAIN         = ${COGNITO_DOMAIN}"
echo "  VITE_COGNITO_CLIENT_ID      = ${COGNITO_CLIENT_ID}"
echo "  VITE_REDIRECT_URI           = ${APP_DOMAIN}/callback"
echo ""
echo "Frontend: https://${CF_DOMAIN}"
echo "API:      ${API_URL}/health"
echo "CF Dist:  ${CF_DIST_ID}"
echo "S3 Deploy Bucket: ${DEPLOY_BUCKET}"
