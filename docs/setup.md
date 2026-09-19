# Operating the hub

The hub runs at `https://<hub_subdomain>.<HUB_DOMAIN>`, behind Cloudflare Access.
Below, `<owner>/<repo>` is this repository and `<project>` is `PROJECT_NAME`.

## What identifies a deployment

None of it is in the repo. The run logs of a public repository are public too,
so in CI these are environment **secrets** (masked in logs), not variables.

| Name | What |
|------|------|
| `PROJECT_NAME` | Prefix of every resource name: Lambdas, buckets, roles, Pages project. Pick once; changing it re-creates everything |
| `AWS_ACCOUNT_ID` | The only account the scripts and Terraform agree to touch |
| `HUB_DOMAIN` | A zone in your Cloudflare account |
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` | |
| `ALLOWED_EMAILS` | JSON list; the only people who get in |
| `ALERT_EMAIL` | Sync failures and budget alarms |

On a laptop the first four go in `.env` (see `.env.example`), the rest in each
stack's gitignored `terraform.tfvars`.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` tests, bundles, applies both
Terraform stacks and publishes the UI. It gets AWS credentials by exchanging
its GitHub identity for the `<project>-ci` role — there are no AWS keys
anywhere, and no `aws login` involved. The role trusts only this repo's
`production` environment, and that environment only accepts `main`.

Pull requests and other branches run `ci.yml`: tests, typecheck, builds,
`terraform fmt` and `validate`. They cannot reach AWS or Cloudflare.

Settings live on the `production` environment in GitHub:

| Kind | Name | What |
|------|------|------|
| secret | `CLOUDFLARE_API_TOKEN` | Pages, Access, DNS |
| secret | `RISEUP_PAT` | RiseUp token; enables the sync schedule once set |
| secret | `GOOGLE_CLIENT_SECRET` | Google sign-in (optional) |
| variable | `PAT_EXPIRES_AT` | `YYYY-MM-DD`, drives the "token expires" warning |
| variable | `GOOGLE_CLIENT_ID` | Google sign-in (optional) |
| secret | everything in the table above | |

## Connect RiseUp (and every ~30 days after)

1. RiseUp → `https://input.riseup.co.il/developer/tokens` → new token, scope
   `budget:read`. It is shown once; note the expiry date.
2. Store it without it touching the shell history or the repo:

   ```bash
   gh secret set RISEUP_PAT --repo <owner>/<repo> --env production      # paste at the prompt
   gh variable set PAT_EXPIRES_AT --repo <owner>/<repo> --env production --body 2026-10-18
   gh workflow run deploy.yml --repo <owner>/<repo>
   ```

   The deploy writes the token to SSM (CI can write it, not read it back) and
   turns on the twice-daily sync.
3. First time only, backfill history:

   ```bash
   gh workflow run sync.yml --repo <owner>/<repo> -f months_back=24
   ```

The hub warns 7 days before expiry, and the sync-failure alarm emails
`ALERT_EMAIL` if it lapses. Until a token is stored the hub shows sample data.

## The assistant ("שאלו אותי")

Runs on Claude Opus 5 through the `<project>-assistant` Lambda. It
answers only through tools over the same dashboard the screen shows (overview,
transaction search, forecast, next month, purchase check, recommendations). One
tool writes: `shift_budget` moves budget between two categories for the current
month, only after an explicit approval in the chat, into `user/budget-shifts.json`.
That log is append-only, and RiseUp itself is never written to. Questions and answers
are stored under `user/chat/` and are readable only by whoever asked.

It needs an Anthropic API key (`sk-ant-api03-…`, from console.anthropic.com →
API keys):

Create the key inside a workspace (Console → API keys → pick the workspace). A
key that is not scoped to a workspace is rejected with a 400.

```bash
gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo> --env production   # paste at the prompt
gh workflow run deploy.yml --repo <owner>/<repo>
gh workflow run assistant-check.yml --repo <owner>/<repo>                # end-to-end test on sample data
```

Without the secret it falls back to the SSM parameter named by
`anthropic_key_param` (in `anthropic_key_region`), for sharing one key between
projects in the same account.

## The daily brief on the phone

Every morning at 07:30 (Israel time, after the 06:00 sync) the `<project>-brief`
Lambda tells each subscribed phone that the brief is ready. The notification
carries no amount and no name; the figures appear only inside the hub.

Once, generate the Web Push signing keys and store them as secrets. Without them
the feature stays off and the schedule is disabled:

```bash
npx web-push generate-vapid-keys        # prints a public and a private key
gh secret set VAPID_PUBLIC_KEY  --repo <owner>/<repo> --env production
gh secret set VAPID_PRIVATE_KEY --repo <owner>/<repo> --env production
gh workflow run deploy.yml --repo <owner>/<repo>
```

On each phone: open the hub **from the Home Screen icon** (iOS delivers web
notifications only to an installed web app, iOS 16.4 or later), then ⚙ →
"הסיכום היומי לטלפון" → הפעלה. Send a test to every subscribed phone with:

```bash
gh workflow run brief.yml --repo <owner>/<repo> -f test=true
```

Subscriptions live in `user/push.json`. Only the browsers' own push services are
accepted as endpoints. A phone whose subscription died is marked and skipped, and
subscribes again by itself the next time the hub is opened on it.

## Google sign-in

Without this, Access emails a one-time PIN, which already works. For Google,
once, in Google Cloud Console:

1. New project → APIs & Services → OAuth consent screen → External → publish.
2. Credentials → Create OAuth client ID → Web application.
   - Authorized JavaScript origin: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URI: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
3. ```bash
   gh variable set GOOGLE_CLIENT_ID --repo <owner>/<repo> --env production --body <client id>
   gh secret set GOOGLE_CLIENT_SECRET --repo <owner>/<repo> --env production
   gh workflow run deploy.yml --repo <owner>/<repo>
   ```

Google only proves who is signing in. The Access policy and the API both still
check the email against `ALLOWED_EMAILS`. Note the Google option also appears on
any other Access apps in the same Cloudflare account; their own policies still
decide who gets in.

## On the iPhones

Open the hub in Safari → sign in → Share → Add to Home Screen. It opens
full-screen, and the Access session lasts 30 days.

## Pushing as the right person

On a machine where `gh` has two accounts logged in, the active one can flip without
notice. Enable the guard once, with your own values (nothing personal is kept in
the repo); it then refuses a push made as anyone else:

```bash
git config core.hooksPath .githooks
git config hooks.ghuser <your GitHub login>
git config hooks.email  <the commit email this repository uses>
```

## Local development

```bash
npm install
npm run dev                  # http://localhost:5180 on sample data
```

Against your real data, without any cloud: put `RISEUP_PAT=...` in `.env`, then

```bash
set -a; source .env; set +a
npm run sync:local -w @hub/backend -- 12     # writes ./data (gitignored)
npm run api:local -w @hub/backend            # terminal 1
VITE_DATA_SOURCE=api npm run dev                # terminal 2
```

Deploying from a laptop still works (`aws login --profile <AWS_LOGIN_PROFILE>` in
a real terminal, then `scripts/deploy.sh`), but is only needed if CI is down.

## Verify the gate

```bash
curl -sI https://<hub host>/ | head -3                        # 302 to <team>.cloudflareaccess.com
curl -s -o /dev/null -w '%{http_code}\n' https://<project>.pages.dev/            # 404
curl -s "$(terraform -chdir=infra/aws output -raw api_url)/api/dashboard"        # {"error":"forbidden"}
```

## One-time bootstrap

`scripts/bootstrap-state.sh` creates the state bucket; `infra/bootstrap` creates
the CI role. Changing the CI role's permissions or its trust is the one thing CI
cannot do for itself: apply `infra/bootstrap` from a laptop.

```bash
source scripts/aws-env.sh
terraform -chdir=infra/bootstrap init -backend-config="bucket=$TF_STATE_BUCKET"
terraform -chdir=infra/bootstrap apply     # reads infra/bootstrap/terraform.tfvars
```

`github_subjects` in that tfvars lists the repositories allowed to deploy. Get
the exact value with `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.
On accounts with immutable subjects the repo name is part of it, so **before
renaming the repo** add the new subject next to the old one and apply; remove
the old one afterwards.
