#!/usr/bin/env bash
# One-time: create the Terraform state bucket.
set -euo pipefail
source "$(dirname "$0")/aws-env.sh"
BUCKET="$TF_STATE_BUCKET"
aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
echo "State bucket ready: $BUCKET"
