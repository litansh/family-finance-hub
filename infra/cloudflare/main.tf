locals {
  hub_host = var.hub_subdomain == "" ? var.domain : "${var.hub_subdomain}.${var.domain}"
}

resource "cloudflare_pages_project" "hub" {
  account_id        = var.cloudflare_account_id
  name              = var.project_name
  production_branch = "main"
  # Cloudflare requires fail_open to match across both environments. Closed: if
  # the function cannot run, the request fails rather than skipping the host check.
  deployment_configs = {
    production = {
      compatibility_date = "2026-09-01"
      fail_open          = false
      env_vars = merge(
        { HUB_HOST = { type = "plain_text", value = local.hub_host } },
        var.api_origin == "" ? {} : { API_ORIGIN = { type = "plain_text", value = trimsuffix(var.api_origin, "/") } },
      )
    }
    preview = {
      compatibility_date = "2026-09-01"
      fail_open          = false
      env_vars           = { HUB_HOST = { type = "plain_text", value = local.hub_host } }
    }
  }
}

resource "cloudflare_pages_domain" "hub" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.hub.name
  name         = local.hub_host
}

resource "cloudflare_dns_record" "hub" {
  zone_id = var.cloudflare_zone_id
  name    = local.hub_host
  type    = "CNAME"
  content = cloudflare_pages_project.hub.subdomain
  proxied = true
  ttl     = 1
}

locals {
  use_google = var.google_client_id != ""
}

# Google proves who is signing in; the policy below still decides who gets in.
# Any Google account can reach the login screen, only the listed emails pass it.
resource "cloudflare_zero_trust_access_identity_provider" "google" {
  count      = local.use_google ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = "Google"
  type       = "google"
  config = {
    client_id     = var.google_client_id
    client_secret = var.google_client_secret
  }
}

resource "cloudflare_zero_trust_access_policy" "family" {
  account_id       = var.cloudflare_account_id
  name             = "Family"
  decision         = "allow"
  session_duration = "720h"
  include          = [for e in var.allowed_emails : { email = { email = e } }]
}

# Access only accepts hostnames inside the zone, so the project's *.pages.dev
# address cannot be listed here. apps/web/functions/_middleware.ts closes it.
resource "cloudflare_zero_trust_access_application" "hub" {
  account_id           = var.cloudflare_account_id
  name                 = "Family Finance Hub"
  type                 = "self_hosted"
  session_duration     = "720h"
  app_launcher_visible = false
  # With Google as the only login method, skip Cloudflare's chooser screen.
  auto_redirect_to_identity = local.use_google
  allowed_idps              = local.use_google ? [cloudflare_zero_trust_access_identity_provider.google[0].id] : null
  destinations              = [{ type = "public", uri = local.hub_host }]
  policies                  = [{ id = cloudflare_zero_trust_access_policy.family.id, precedence = 1 }]
}
