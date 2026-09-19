terraform {
  required_version = ">= 1.10"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
  # State sits next to the aws stack's, encrypted. It holds the Google client
  # secret once that is set. -backend-config="bucket=<state bucket>" at init.
  backend "s3" {
    key          = "cloudflare/terraform.tfstate"
    region       = "il-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment.
provider "cloudflare" {}
