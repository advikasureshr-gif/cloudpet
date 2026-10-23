#!/usr/bin/env bash
# Deletes EVERYTHING in the stack (website, API, database, Cognito users). Run after the demo.
set -euo pipefail
STACK="${STACK:-cloudpet}"; REGION="${AWS_REGION:-us-east-1}"
PROFILE_ARG=(); [ -n "${AWS_PROFILE:-}" ] && PROFILE_ARG=(--profile "$AWS_PROFILE")
BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" "${PROFILE_ARG[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue" --output text 2>/dev/null || true)"
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] && aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" "${PROFILE_ARG[@]}" || true
sam delete --stack-name "$STACK" --region "$REGION" --no-prompts "${PROFILE_ARG[@]}"
