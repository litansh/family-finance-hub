# Roadmap

Live since 2026-09-18, on sample data until
a RiseUp token is stored. Operating notes: [setup.md](setup.md).

## Done

- [x] `packages/core`: month status, alerts, recurring detection, trends — unit tested
- [x] UI: Home, Month, Trends, Recurring; verified in WebKit at iPhone 16 Pro and 17 Pro Max
- [x] Sync and API Lambdas; API verifies the Access JWT and the email allowlist itself
- [x] Domain, DNS, Pages, Access policy for the family allowlist; `pages.dev` locked out
- [x] Terraform for AWS and Cloudflare; GitHub Actions CI and OIDC deploy

## Next

- [ ] Store the RiseUp token, backfill 24 months, check the numbers against the RiseUp app
- [ ] Google sign-in (needs an OAuth client from Google Cloud Console)
- [ ] Sign in on both iPhones, add to home screen
- [ ] Tune alert thresholds and category handling against real data
- [ ] Does one RiseUp account cover the household, or is a second token needed?
- [ ] Rotate the Cloudflare API token that was pasted into a chat during setup

## Later

- [ ] Annual charges coming due (needs 12+ months of real history)
- [ ] Net worth: balances, mortgage, pension, investments — manual sources RiseUp does not see
- [ ] Goals and a monthly family review page
