# Overdue Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adiyananurulkhusna/overdue-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adiyananurulkhusna/overdue-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

**Overdue Radar** ranks pre-token protocols by how long they have run without a
token — the maturity and overdue-launch premium. A protocol that has held real TVL
for years while recording no token is, in the market's own terms, overdue for one.
This entry is for the make.fun bounty **token-radar-01** ("Build the best token
launch radar", $1,325), scored against the frozen DefiLlama snapshot of 2026-11-14.

## The model

Every row is scored by the same function, from the snapshot's own figures. No
protocol name is special-cased and no row is hand-picked.

**1. Base value.** Take the protocol's TVL and multiply it by the median
market-cap/TVL ratio of the protocols in the snapshot that already have a token
(computed from the snapshot on every run — in this snapshot the median is about
0.21). The median, not the mean, because a few tiny-TVL tokens with huge caps drag
the mean far above the typical protocol.

**2. Maturity — the main weight.** From the age since the protocol was first
listed:

```
maturity = 0.70 + min(age in days, 1460) / 1460 × 0.45   (max 1.15)
```

Four years with no token earns the full premium; a protocol listed last month
earns barely above 0.70. An unknown listing date counts as 365 days.

**3. Overdue premium.** The median age of the snapshot's pre-token protocols is
computed on every run (513 days in this snapshot). A protocol older than that
median earns an extra ×1.05; one older than twice the median is banded "long
overdue" in the dashboard.

**4. Growth — a secondary weight.** The 7-day TVL change, clamped to −40%…+80%
and weighted by 0.25, so one wild week cannot dominate the score:

```
growth = 1 + 0.25 × clamp(change_7d, −40, +80) / 100
```

**The ranked column.**

```
implied_value_usd = round(TVL × median ratio × maturity × overdue × growth)
```

Rows are sorted by that number, highest first.

## Coverage

- The board covers **all 40 watchlist slugs** (TVL ≥ $50M, no token on record),
  plus 160 pre-token protocols below the floor, picked by TVL — 200 rows in total.
  Exchanges and versioned pools are not farmable launches, so the same rule the
  watchlist itself uses keeps them out of the early radar.
- Protocols that already have a token are set aside in a separate "Live token" view
  with their real market caps, never mixed into the ranking.

## The dashboard

`dashboard/` is a static page with no network and no build step: it reads `data.js`,
which `main.ts` writes from the same board.

- Search by name, category or chain; filter by category, chain, minimum TVL and
  **overdue band** (long overdue / overdue / on schedule / unknown age); a
  watchlist-only toggle; sorts by implied value, TVL, 7-day growth, **age** and name.
- A **detail drawer** per protocol: the age in days since listing with an overdue
  band and a maturity bar, the model's full breakdown (TVL, median ratio, base
  value, growth, maturity and overdue multipliers), and the step-by-step farm plan
  with its estimated cost per step.
- An **overdue distribution** panel: how many board rows sit in each band.
- A **farm cost table** with the per-step estimate for every chain.

## How to run

Node 22, standard library only — nothing to install:

```sh
node main.ts --input /path/to/snapshot.json --output ./out
```

This writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. Then open `out/dashboard/index.html` in a browser. The
program exits non-zero if the board fails the gate (missing watchlist slugs, wrong
order, bad farm steps, or fewer than 3 screenshots).

## Caveats

- **Implied value is a model, not a price prediction.** It says what a token might
  be worth *if* the market priced this protocol like the median token-bearing
  protocol today, weighted toward the protocols that have waited longest. It is not
  a forecast of any token's price, and an airdrop is never guaranteed: a protocol
  may never issue a token at all.
- Farm costs are estimates, not live gas prices. Check the real cost before you
  spend anything, use a fresh wallet that holds only what you plan to farm, and
  never pay anyone to claim an airdrop — claim only from links the protocol itself
  publishes.
- The snapshot is frozen at 2026-11-14. Protocols change; this board does not move
  with them.
