terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.70" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
  }
  # Create the bucket once with scripts/bootstrap-state.sh. Its name is passed
  # at init: -backend-config="bucket=<state bucket>".
  backend "s3" {
    key          = "hub/terraform.tfstate"
    region       = "il-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = "il-central-1"
  allowed_account_ids = [var.aws_account_id] # refuses to run against any other account
  default_tags { tags = { project = var.project_name } }
}
