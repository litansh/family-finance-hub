variable "project_name" {
  description = "Prefix of every resource name. Changing it re-creates everything, the data bucket included."
  type        = string
}

variable "aws_account_id" {
  type = string
}

variable "access_team_domain" {
  description = "<team>.cloudflareaccess.com"
  type        = string
}

variable "access_aud" {
  description = "`terraform output -raw access_aud` from ../cloudflare"
  type        = string
}

variable "allowed_emails" {
  description = "Same list as the Access policy; the API checks it independently"
  type        = list(string)
  sensitive   = true
}

variable "pat_expires_at" {
  description = "Expiry date (YYYY-MM-DD) of the RiseUp token currently in SSM"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "alert_email" {
  description = "Where sync failures and budget alarms go"
  type        = string
  sensitive   = true
}

variable "sync_enabled" {
  description = "Run the RiseUp sync on schedule. Off until a token is stored, so the failure alarm stays quiet."
  type        = bool
  default     = false
}

variable "anthropic_key_param" {
  description = "SSM SecureString holding the Anthropic API key. May be shared with another project; read-only here."
  type        = string
  default     = "/shared/anthropic-key"
}

variable "anthropic_key_region" {
  description = "Region of that parameter, which may differ from the hub's."
  type        = string
  default     = "eu-central-1"
}

variable "anthropic_api_key" {
  description = "Optional. Passed as TF_VAR_anthropic_api_key from the GitHub secret; kept in the encrypted state and the Lambda's encrypted environment."
  type        = string
  default     = ""
  sensitive   = true
}

variable "anthropic_workspace_id" {
  description = "Optional. Only for an API key that is not scoped to a workspace: Anthropic then wants the workspace named on every request."
  type        = string
  default     = ""
  sensitive   = true
}

# Web Push signing keys (`npx web-push generate-vapid-keys`). Empty = no phone notifications.
variable "vapid_public_key" {
  type    = string
  default = ""
}

variable "vapid_private_key" {
  type      = string
  default   = ""
  sensitive = true
}
