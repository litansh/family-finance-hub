#!/usr/bin/env bash
# Source this: `source scripts/aws-env.sh`. Exports short-lived credentials from
# the AWS_LOGIN_PROFILE profile, because Terraform cannot read `aws login`
# sessions. Log in first, in a real terminal:  aws login --profile <profile>
source "$(dirname "${BASH_SOURCE[0]:-$0}")/config.sh" || return 1
: "${AWS_LOGIN_PROFILE:?AWS_LOGIN_PROFILE is required in .env}"
eval "$(aws configure export-credentials --profile "$AWS_LOGIN_PROFILE" --format env)" || return 1
unset AWS_PROFILE
ACTUAL=$(aws sts get-caller-identity --query Account --output text)
if [ "$ACTUAL" != "$AWS_ACCOUNT_ID" ]; then
  echo "Refusing: credentials are for account $ACTUAL, expected $AWS_ACCOUNT_ID" >&2
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  return 1
fi
echo "AWS credentials set for account $ACTUAL ($AWS_REGION)"
