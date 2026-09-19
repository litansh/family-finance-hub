output "hub_url" {
  value     = "https://${local.hub_host}"
  sensitive = true # deploy logs are public
}

# Feed this to the aws stack as access_aud.
output "access_aud" {
  value     = cloudflare_zero_trust_access_application.hub.aud
  sensitive = true
}

output "cloudflare_account_id" {
  value     = var.cloudflare_account_id
  sensitive = true
}
