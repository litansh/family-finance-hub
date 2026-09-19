project_name          = "family-finance-hub"
domain                = "example.com"
cloudflare_account_id = "00000000000000000000000000000000"
cloudflare_zone_id    = "00000000000000000000000000000000"
allowed_emails        = ["alex@example.com", "noa@example.com"]
google_client_id      = "" # from Google Cloud Console; the secret goes in TF_VAR_google_client_secret
api_origin            = "" # `terraform output -raw api_url` from ../aws
