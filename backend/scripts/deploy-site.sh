#!/usr/bin/env bash
# Uploads the website to S3 (served by CloudFront) with the right API address and Cognito ids.
# Usage (from backend/):  ./scripts/deploy-site.sh [path-to-website-folder]   (default: the folder above backend/)
set -euo pipefail

STACK="${STACK:-cloudpet}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE_ARG=()
[ -n "${AWS_PROFILE:-}" ] && PROFILE_ARG=(--profile "$AWS_PROFILE")
SITE_DIR="$(cd "${1:-..}" && pwd)"

out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" "${PROFILE_ARG[@]}" \
          --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

BUCKET="$(out SiteBucketName)"; API="$(out ApiUrl)"; POOL="$(out UserPoolId)"
CLIENT="$(out UserPoolClientId)"; URL="$(out SiteUrl)"
[ -n "$BUCKET" ] && [ -n "$API" ] && [ -n "$CLIENT" ] || { echo "Could not read the stack outputs. Is '$STACK' deployed in $REGION?"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
rsync -a --exclude backend --exclude node_modules --exclude '.git*' --exclude '*.py' --exclude '*.png.bak' "$SITE_DIR"/ "$STAGE"/
mkdir -p "$STAGE/js"
cat > "$STAGE/js/config.js" <<CFG
window.CLOUDPET_CONFIG = { apiBase: "$API", region: "$REGION", userPoolId: "$POOL", clientId: "$CLIENT" };
CFG

aws s3 sync "$STAGE" "s3://$BUCKET" --delete --region "$REGION" "${PROFILE_ARG[@]}"
echo
echo "Website uploaded. Open: $URL"
