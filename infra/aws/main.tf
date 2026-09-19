locals {
  name      = var.project_name
  pat_param = "/${var.project_name}/riseup-pat"
  dist      = "${path.module}/../../services/backend/dist"
}

data "aws_caller_identity" "me" {}

# ---- Data -------------------------------------------------------------------

resource "aws_s3_bucket" "data" {
  bucket = "${local.name}-data-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# A bad sync overwrites a month; versioning makes that recoverable.
resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-old-riseup-versions"
    status = "Enabled"
    # RiseUp data can always be pulled again. Everything under user/ is ours
    # alone, so every earlier version of it is kept indefinitely.
    filter { prefix = "transactions/" }
    noncurrent_version_expiration { noncurrent_days = 365 }
  }
}

resource "aws_s3_bucket_policy" "data_tls_only" {
  bucket = aws_s3_bucket.data.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.data.arn, "${aws_s3_bucket.data.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ---- Lambdas ----------------------------------------------------------------

data "archive_file" "sync" {
  type        = "zip"
  source_dir  = "${local.dist}/sync"
  output_path = "${local.dist}/zips/sync.zip"
}

data "archive_file" "assistant" {
  type        = "zip"
  source_dir  = "${local.dist}/assistant"
  output_path = "${local.dist}/zips/assistant.zip"
}

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${local.dist}/api"
  output_path = "${local.dist}/zips/api.zip"
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sync" {
  name               = "${local.name}-sync"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = { sync = aws_iam_role.sync.name, api = aws_iam_role.api.name }
  role       = each.value
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Only the sync job can read the RiseUp token or write data.
resource "aws_iam_role_policy" "sync" {
  role = aws_iam_role.sync.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.data.arn}/*" },
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.data.arn },
      { Effect = "Allow", Action = "ssm:GetParameter", Resource = "arn:aws:ssm:il-central-1:${data.aws_caller_identity.me.account_id}:parameter${local.pat_param}" },
    ]
  })
}

resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:GetObject", Resource = "${aws_s3_bucket.data.arn}/*" },
      # The API can write only what the family creates in the hub. RiseUp's
      # budgets and transactions are read-only to it, and nothing can delete.
      { Effect = "Allow", Action = "s3:PutObject", Resource = "${aws_s3_bucket.data.arn}/user/*" },
      # The assistant shares this role. It reads an Anthropic key that already
      # lives in this account for another family project; nothing else in SSM.
      { Effect = "Allow", Action = "ssm:GetParameter", Resource = "arn:aws:ssm:${var.anthropic_key_region}:${data.aws_caller_identity.me.account_id}:parameter${var.anthropic_key_param}" },
      { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = "arn:aws:lambda:il-central-1:${data.aws_caller_identity.me.account_id}:function:${local.name}-assistant" },
      # Without ListBucket a missing key reads as AccessDenied instead of NoSuchKey.
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.data.arn },
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = toset(["sync", "api", "assistant"])
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 30
}

resource "aws_lambda_function" "sync" {
  function_name    = "${local.name}-sync"
  role             = aws_iam_role.sync.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.sync.output_path
  source_code_hash = data.archive_file.sync.output_base64sha256
  timeout          = 120
  memory_size      = 512
  environment {
    variables = { DATA_BUCKET = aws_s3_bucket.data.id, PAT_PARAM = local.pat_param }
  }
  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 15
  memory_size      = 512
  # No reserved concurrency: this account's Lambda quota is the new-account 10,
  # and AWS will not let a reservation take the unreserved pool below that.
  environment {
    variables = {
      DATA_BUCKET        = aws_s3_bucket.data.id
      ACCESS_TEAM_DOMAIN = var.access_team_domain
      ACCESS_AUD         = var.access_aud
      ALLOWED_EMAILS     = join(",", var.allowed_emails)
      PAT_EXPIRES_AT     = var.pat_expires_at
      ASSISTANT_FUNCTION = "${local.name}-assistant"
    }
  }
  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Answers questions in the background: a good answer with several lookups can
# outlast API Gateway's 30 seconds, so the API queues a job and the page polls.
resource "aws_lambda_function" "assistant" {
  function_name    = "${local.name}-assistant"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.assistant.output_path
  source_code_hash = data.archive_file.assistant.output_base64sha256
  timeout          = 180
  memory_size      = 1024
  environment {
    # A key given through the ANTHROPIC_API_KEY GitHub secret wins; without one
    # the function falls back to the SSM parameter.
    variables = merge(
      { DATA_BUCKET = aws_s3_bucket.data.id, ANTHROPIC_KEY_PARAM = var.anthropic_key_param, ANTHROPIC_KEY_REGION = var.anthropic_key_region },
      var.anthropic_api_key == "" ? {} : { ANTHROPIC_API_KEY = var.anthropic_api_key },
      var.anthropic_workspace_id == "" ? {} : { ANTHROPIC_WORKSPACE_ID = var.anthropic_workspace_id },
    )
  }
  depends_on = [aws_cloudwatch_log_group.lambda]
}

# A failed background job must not be retried: that would bill the question twice.
resource "aws_lambda_function_event_invoke_config" "assistant" {
  function_name          = aws_lambda_function.assistant.function_name
  maximum_retry_attempts = 0
}

# Public endpoint, no IAM auth: every request must carry a valid Cloudflare
# Access JWT, which the handler verifies before touching any data. (Lambda
# function URLs would be simpler but do not exist in il-central-1.)
resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each  = toset(["GET", "PUT"])
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "${each.key} /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

moved {
  from = aws_apigatewayv2_route.api
  to   = aws_apigatewayv2_route.api["GET"]
}

# Two people use this. The throttle caps what anyone hammering the URL can cost.
resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---- Schedule ---------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.sync.arn }]
  })
}

resource "aws_scheduler_schedule" "sync" {
  name                         = "${local.name}-sync"
  schedule_expression          = "cron(0 6,18 * * ? *)"
  schedule_expression_timezone = "Asia/Jerusalem"
  state                        = var.sync_enabled ? "ENABLED" : "DISABLED"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ monthsBack = 1 })
  }
}

# ---- Alarms -----------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# The usual cause is the 30-day RiseUp token expiring.
resource "aws_cloudwatch_metric_alarm" "sync_failed" {
  alarm_name          = "${local.name}-sync-failed"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.sync.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_budgets_budget" "hub" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:project$${local.name}"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
