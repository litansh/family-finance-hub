variable "project_name" {
  description = "Name of the Pages project. Changing it re-creates the project."
  type        = string
}

variable "domain" {
  description = "A zone in the Cloudflare account, e.g. example.com"
  type        = string
}

variable "hub_subdomain" {
  description = "Hostname label for the hub. Empty string serves it on the apex."
  type        = string
  default     = "finance"
}

variable "cloudflare_account_id" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type      = string
  sensitive = true
}

variable "allowed_emails" {
  description = "The only people who can open the hub"
  type        = list(string)
  sensitive   = true
  validation {
    condition     = length(var.allowed_emails) > 0 && length(var.allowed_emails) <= 4
    error_message = "This is a family hub: list between one and four emails."
  }
}

variable "api_origin" {
  description = "The API Lambda's function URL, from the aws stack. Empty until that stack exists; the UI then runs on sample data."
  type        = string
  default     = ""
}

# Google sign-in. Leave both empty to fall back to Cloudflare's emailed one-time PIN.
variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  description = "Pass as TF_VAR_google_client_secret; never write it to a file in the repo"
  type        = string
  default     = ""
  sensitive   = true
}
