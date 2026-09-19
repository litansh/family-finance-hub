# What the hub shows

The UI is Hebrew and right-to-left. Principles, from the family's own brief:

- **Explained.** Every figure has a one-line plain-language caption and a `?`
  button with a fuller explanation; all of them are collected in a glossary
  (`apps/web/src/lib/glossary.ts`). No finance jargon without a definition.
- **Flexible.** Every block is a widget. In ⚙ → "סידור המסכים" a widget can be
  moved up or down, sent to another screen, or hidden and brought back. Each
  person has their own arrangement, saved on the device and in the hub.
- **Nothing is deleted.** The sync merges into what is stored. A transaction
  RiseUp drops is kept and marked; one RiseUp recategorizes keeps its earlier
  category on record. `user/` data keeps every version indefinitely.
- **Ours, not RiseUp's.** Moving a transaction to another category or adding a
  note is stored in a separate layer applied on top of RiseUp's data. No sync
  and no change made inside RiseUp can overwrite it, and it can always be undone.
- **Accessible.** Three text sizes, light and dark, 44px touch targets, labelled
  controls, focus-trapped dialogs, a skip link, and a table view for every chart.

## Recommendations (המלצות)

Rule-based and explainable — each one shows the numbers it came from, concrete
steps, and an estimated yearly saving when one can be estimated honestly. Rules
live in `packages/core/src/recommendations.ts`: a recurring charge that rose,
two or more loans in parallel (mortgage excluded), overdraft interest, bank and
card fees, three or more insurance payees, stacked subscriptions, telecom worth
a comparison call, installment load above 10% of income, a category over budget
three months running, a savings rate under 10%. Each can be marked done,
snoozed for a month, or dismissed; the status is shared between both of us.
They are not professional financial advice, and the UI says so.

The test for every tile: does it change what we do this month? If not, it goes
on a drill-down page, not the home screen.

Source legend — **R**: RiseUp today (`get_budget`, `get_transactions`).
**R+**: needs RiseUp's announced `get_balances` / `get_cashflow`.
**D**: derived by us from stored history. **M**: manual entry or another source.

## Home: "Are we OK this month?"

Answerable in five seconds, on a phone.

| Tile | Question it answers | Source |
|------|---------------------|--------|
| Left to spend | Planned variable spend minus actual, and per remaining day | R |
| Month projection | At the current pace, do we end the month positive or negative? | R + D |
| Income received vs. expected | Did both salaries and other income land? | R |
| Fixed charges status | Which expected fixed expenses have hit, which are pending | R |
| Alerts | Everything from the Alerts section below, newest first | D |
| Data freshness | Last sync time, RiseUp token days-to-expiry | D |

## Month view

- Envelopes: planned vs. actual per category, over-budget ones first — R
- Transactions: searchable by business, date, amount, category — R
- Biggest transactions of the month, and the ones that are unusual for that business — R + D
- Who/which card spent, if RiseUp exposes the source account — R (verify in Phase 0)

## Trends (needs a few months of stored history)

- Net cashflow per month, 12-month view: are we saving or bleeding? — D
- Savings rate: (income − expenses) / income — D
- Category drift: categories growing fastest vs. their 6-month average — D
- Fixed vs. variable split over time — D
- Groceries, eating out, kids, car, home: the household's big five, tracked individually — D

## Recurring charges and subscriptions

- Detected recurring charges with monthly and annualized cost — D
- Price changes: same business, amount went up — D
- New recurring charges this month; ones that stopped — D
- Annual charges coming due in the next 60 days (insurance, licenses, memberships) — D

## Alerts

- Envelope passed 80% / 100% before month end
- Projection turns negative
- Expected income not received by its usual day
- Duplicate charge: same business, same amount, within 3 days
- Unusually large transaction vs. that business's history
- New business never seen before above a threshold
- Sync failed or RiseUp token expiring within 7 days

## Net worth and the long game — not in RiseUp

RiseUp sees bank and card cashflow only. To be genuinely on top of things we
also need, updated monthly by hand or import at first:

| Item | Source |
|------|--------|
| Account balances, emergency fund in months of expenses | R+ / M |
| Mortgage and loans: balance, rate, monthly payment, end date | M |
| Pension, keren hishtalmut, gemel: balances and monthly deposits | M |
| Investments and savings | M |
| Net worth over time | D from the above |
| Goals: target, progress, monthly contribution needed | M + D |
| Large known upcoming expenses (holidays, car, school year, arnona) | M |

## Monthly family review

One generated page per closed month: what came in, what went out, where we
beat or missed the plan, what changed in recurring charges, net worth delta,
and three decisions for next month. Built for a 15-minute sit-down.

## Build order

1. Home + Month view — all from RiseUp today.
2. Alerts and recurring detection — as soon as backfill gives us history.
3. Trends — meaningful after ~3 months of data (backfill may give this on day one).
4. Net worth, goals, monthly review — manual sources.
