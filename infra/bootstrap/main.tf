# Applied once from a laptop. Creates the role GitHub Actions assumes, so every
# later deploy runs from CI with short-lived credentials and no stored AWS keys.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
  # The bucket is passed at init: -backend-config="bucket=<state bucket>".
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "il-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = "il-central-1"
  allowed_account_ids = [var.aws_account_id]
  default_tags { tags = { project = var.project_name } }
}

variable "project_name" {
  description = "Prefix of every resource name. Changing it re-creates everything."
  type        = string
}

variable "aws_account_id" {
  type = string
}

variable "github_subjects" {
  description = <<-EOT
    OIDC subject prefixes of the repositories allowed to deploy, without the
    trailing ":environment:...". Classic form is "repo:<owner>/<repo>". Accounts
    with immutable subjects carry numeric ids, "repo:<owner>@<id>/<repo>@<id>",
    and the repo name is part of it, so list the old and the new one while renaming.
    `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`
  EOT
  type        = list(string)
}

locals {
  name    = var.project_name
  account = var.aws_account_id
  region  = "il-central-1"
  state   = "arn:aws:s3:::${local.name}-tfstate-${local.account}"
}

# Shared with other personal projects in this account; not managed here.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "ci" {
  name                 = "${local.name}-ci"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # Only the deploy job, which runs in the `production` environment, and
          # that environment only accepts the main branch. A pull request or a
          # fork cannot obtain these credentials.
          "token.actions.githubusercontent.com:sub" = [for s in var.github_subjects : "${s}:environment:production"]
        }
      }
    }]
  })
}

# Everything is scoped to this project's resource names. CI never reads the
# financial data or the RiseUp token: it can write the token, not read it back.
resource "aws_iam_role_policy" "ci" {
  role = aws_iam_role.ci.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "State", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${local.state}/*" },
      { Sid = "StateList", Effect = "Allow", Action = "s3:ListBucket", Resource = local.state },
      {
        Sid      = "DataBucketConfig"
        Effect   = "Allow"
        Action   = ["s3:CreateBucket", "s3:ListBucket", "s3:Get*Configuration", "s3:Put*Configuration", "s3:GetBucket*", "s3:PutBucket*", "s3:DeleteBucketPolicy", "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration", "s3:GetAccelerateConfiguration", "s3:GetReplicationConfiguration"]
        Resource = "arn:aws:s3:::${local.name}-data-${local.account}"
      },
      { Sid = "Lambda", Effect = "Allow", Action = "lambda:*", Resource = "arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-*" },
      {
        Sid    = "Roles"
        Effect = "Allow"
        Action = ["iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
        # The CI role itself is excluded, so a workflow cannot rewrite its own limits.
        Resource = ["arn:aws:iam::${local.account}:role/${local.name}-sync", "arn:aws:iam::${local.account}:role/${local.name}-api", "arn:aws:iam::${local.account}:role/${local.name}-scheduler"]
      },
      {
        Sid       = "AttachLogsPolicyOnly"
        Effect    = "Allow"
        Action    = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource  = "arn:aws:iam::${local.account}:role/${local.name}-*"
        Condition = { ArnEquals = { "iam:PolicyARN" = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" } }
      },
      {
        Sid       = "PassRolesToServices"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = "arn:aws:iam::${local.account}:role/${local.name}-*"
        Condition = { StringEquals = { "iam:PassedToService" = ["lambda.amazonaws.com", "scheduler.amazonaws.com"] } }
      },
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:ListTagsLogGroup"], Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/lambda/${local.name}-*" },
      { Sid = "LogsDescribe", Effect = "Allow", Action = "logs:DescribeLogGroups", Resource = "*" },
      # HTTP API ARNs carry generated ids, not names, so they cannot be narrowed further.
      { Sid = "HttpApi", Effect = "Allow", Action = ["apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:PUT", "apigateway:DELETE", "apigateway:TagResource", "apigateway:UntagResource"], Resource = ["arn:aws:apigateway:${local.region}::/apis", "arn:aws:apigateway:${local.region}::/apis/*", "arn:aws:apigateway:${local.region}::/tags/*"] },
      { Sid = "Scheduler", Effect = "Allow", Action = "scheduler:*", Resource = "arn:aws:scheduler:${local.region}:${local.account}:schedule/default/${local.name}-*" },
      { Sid = "Sns", Effect = "Allow", Action = "sns:*", Resource = "arn:aws:sns:${local.region}:${local.account}:${local.name}-*" },
      { Sid = "Alarms", Effect = "Allow", Action = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:TagResource", "cloudwatch:UntagResource"], Resource = "arn:aws:cloudwatch:${local.region}:${local.account}:alarm:${local.name}-*" },
      { Sid = "Budget", Effect = "Allow", Action = ["budgets:ViewBudget", "budgets:ModifyBudget", "budgets:ListTagsForResource", "budgets:TagResource", "budgets:UntagResource"], Resource = "arn:aws:budgets::${local.account}:budget/${local.name}-*" },
      { Sid = "WriteRiseupToken", Effect = "Allow", Action = ["ssm:PutParameter", "ssm:AddTagsToResource"], Resource = "arn:aws:ssm:${local.region}:${local.account}:parameter/${local.name}/riseup-pat" },
      { Sid = "WhoAmI", Effect = "Allow", Action = "sts:GetCallerIdentity", Resource = "*" },
    ]
  })
}

output "ci_role_arn" {
  value = aws_iam_role.ci.arn
}
