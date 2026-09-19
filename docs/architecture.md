# Architecture

## Constraints that drive the design

**The RiseUp MCP server is stdio and local.** `@riseup-oss/mcp` is a Node
process that speaks MCP over stdin/stdout and calls
`https://input.riseup.co.il` with a personal access token. It is not a hosted
HTTP endpoint, so a browser cannot talk to it and a Cloudflare Worker cannot
spawn it.

**It is read-only.** One scope (`budget:read`), two tools today:

| Tool | Input | Returns |
|------|-------|---------|
| `get_budget` | `YYYY-MM` \| `current` \| `previous` | envelopes, planned amounts, transactions |
| `get_transactions` | `cashflowMonth`, `transactionDate`, `businessName` (ANDed) | cashflow transactions |

`get_balances` and `get_cashflow` are announced but not shipped.

**Tokens expire after 30 days by default.** Rotation is a recurring manual
chore unless RiseUp allows a longer expiry at creation time. The hub must
surface "token expires in N days" and fail loudly when the sync gets a 401.

## Decision: sync, don't proxy

The UI never calls RiseUp. A scheduled job pulls data into our own store and
the UI reads from that.

- The PAT lives in exactly one place (AWS Secrets Manager / SSM SecureString),
  never in the browser, never in Cloudflare.
- We build history. RiseUp gives months on request; our store lets us trend
  across years and keep our own annotations.
- The UI stays fast and keeps working when RiseUp is down or the token lapsed.
- We stay polite to an API whose rate limits we don't know yet.

The sync Lambda ships the official `@riseup-oss/mcp` server as a bundled file
next to the handler and runs it as a child process over stdio, using the MCP
SDK client — the same way Claude talks to it. That keeps us on the supported,
official surface rather than reverse-engineering the REST API underneath.

## Components

| Piece | Where | Notes |
|-------|-------|-------|
| DNS, TLS, WAF | Cloudflare | Domain registered at Cloudflare Registrar |
| Auth | Cloudflare Access (Zero Trust free tier, ≤50 users) | Email allowlist on the hub hostname. Access cannot cover the project's `*.pages.dev` addresses (outside the zone), so a Pages middleware answers 404 to any other hostname |
| UI | Cloudflare Pages | Vite + React SPA, mobile-first, installable to the iPhone home screen |
| `/api/*` | Pages Function → API Gateway HTTP API → Lambda | Same origin, so no CORS. Forwards the Access JWT. Throttled to 5 req/s. (Lambda function URLs do not exist in `il-central-1`) |
| API | Lambda, `il-central-1` | Verifies the Access JWT, reads S3, runs `buildDashboard` from `packages/core` |
| Sync | Lambda + EventBridge Scheduler | 06:00 and 18:00 Israel time; current + previous month; backfill on demand |
| Store | S3, versioned, encrypted, TLS-only | RiseUp's data: `budgets/`, `transactions/` (merged on every sync, never replaced), `meta.json`. The family's data: `user/overrides.json`, `user/recommendations.json`, `user/layout/<hash>.json`. The sync never writes under `user/`; the API can write nowhere else and cannot delete |
| Secret | SSM Parameter Store SecureString | Readable by the sync role only |
| Alarms | CloudWatch → SNS email, AWS Budget | Sync failure (usually token expiry), spend over 80% of $5 |
| IaC | Terraform: `infra/bootstrap`, `infra/aws`, `infra/cloudflare` | `allowed_account_ids` pins one account; state in S3 |
| CI/CD | GitHub Actions | Push to `main` deploys. AWS access through OIDC, no stored keys; the role trusts only the `production` environment |

All financial logic lives in `packages/core` as pure functions with unit
tests. The API, the local dev server and the sample-data mode all call the same
`buildDashboard`, so what is tested is what is shown.

## Security

Access is enforced twice. Cloudflare Access gates the hostname at the edge; the
API independently verifies the Access JWT (signature against the team's JWKS,
`aud` tag, email in allowlist). Without the second check, anyone who discovers
the API Gateway URL bypasses Cloudflare entirely.

Financial data for two people: S3 encryption at rest, public access blocked,
TLS-only bucket policy, no amounts or business names in logs, responses sent
`no-store`, a strict CSP and `noindex` on the site.

## Cost

Expected well under $1/month on AWS: Lambda and S3 sit inside or near free
tier at this volume. Cloudflare Pages and Access are free at two users. The
domain is the main line item. A $5 AWS Budget alarm is part of the Terraform.

## Open questions

1. Can a RiseUp PAT be created with an expiry longer than 30 days?
2. Does one RiseUp account cover the whole household, or do both partners
   have separate accounts (two PATs, merged view)?
3. Rate limits on `input.riseup.co.il`.
4. Beyond RiseUp: mortgage, pension, investments, AWS/SaaS bills? RiseUp only
   sees bank and card cashflow.
