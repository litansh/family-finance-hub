# Feed this to the cloudflare stack as api_origin.
output "api_url" {
  value     = aws_apigatewayv2_api.api.api_endpoint
  sensitive = true # deploy logs are public
}

output "data_bucket" {
  value = aws_s3_bucket.data.id
}

output "sync_function" {
  value = aws_lambda_function.sync.function_name
}
