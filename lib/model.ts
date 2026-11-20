// Overdue Radar: rank pre-token protocols by how long they have run without a token.
//
// The idea is simple: a protocol that has held real TVL for years while recording no
// token is, in the market's own terms, overdue for one. This board scores that overdue
// premium — maturity is the main weight, growth matters but does not decide, and a
// protocol older than the typical pre-token protocol earns a small extra overdue factor.
//
//   base value   = tvl_usd x median(mcap_usd / tvl_usd over token-bearing protocols)
//   maturity     = 0.70 + min(age_days, 1460) / 1460 x 0.45        (max 1.15)
//   overdue      = 1.05 when age_days > median pre-token age, else 1.00
//   growth       = 1 + 0.25 x clamp(change_7d, -40, +80) / 100
//   implied      = round(base value x maturity x overdue x growth)
//
// The median ratio and the median pre-token age are both computed from the snapshot on
// every run, never hard-coded. No protocol name is ever special-cased: the same function
// scores every row. A protocol is pre-token when its record carries no token at all
// (no market cap, no CoinGecko id, no symbol); protocols whose token already trades are
// kept apart and shown with the market's own value, never mixed into the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  overdue_factor: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
}

export const MODEL: ModelConstants = {
  maturity_floor: 0.7,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  overdue_factor: 1.05,
  growth_weight: 0.25,
  growth_floor: -40,
  growth_cap: 80,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'overdue-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How overdue a protocol is, from its age against the snapshot's median pre-token age. */
export type OverdueBand = 'on schedule' | 'overdue' | 'long overdue' | 'unknown';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  overdue_band: OverdueBand;
  implied_value_usd: number;
  model: {
    median_ratio: number;
    median_age_days: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    overdue_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  overdue_band: OverdueBand;
  implied_value_usd: number;
  base_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  overdue_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  median_ratio: number;
  median_age_days: number;
  gas_table: Record<string, number>;
  gas_default_usd: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted list of numbers; 0 when the list is empty. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The median market-cap/TVL ratio across every protocol in the snapshot that already has
 * a token with a market cap. The middle of the market, not its loudest corner: the mean is
 * dragged up by a few tiny-TVL tokens with huge caps, the median is not.
 */
export function medianMcapTvl(snapshot: Snapshot): number {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  return medianOf(ratios);
}

/**
 * The median age, in days, of the snapshot's pre-token protocols that carry a listing
 * date. The overdue line: a protocol older than this median earns the overdue factor.
 */
export function medianPreTokenAge(snapshot: Snapshot): number {
  const ages = snapshot.protocols
    .filter((p) => isPreToken(p))
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return Math.round(medianOf(ages));
}

/** The overdue band a protocol sits in, from its age against the median pre-token age. */
export function overdueBandFor(age: number | null, medianAge: number): OverdueBand {
  if (age === null) return 'unknown';
  if (age > medianAge * 2) return 'long overdue';
  if (age > medianAge) return 'overdue';
  return 'on schedule';
}

/**
 * Estimated all-in cost of ONE farm step (gas plus the usual swap/pool fee and slippage
 * allowance for a small position) on each chain, in whole US dollars. These are rough
 * planning estimates written by hand, not live prices: gas moves, and a step on Ethereum
 * costs far more than the same step on a cheap chain. Treat every figure as an estimate,
 * never as a quote.
 */
export const GAS_USD_PER_STEP: Record<string, number> = {
  Ethereum: 5.5,
  Bitcoin: 2.0,
  Solana: 0.5,
  Binance: 0.7,
  Base: 0.8,
  Arbitrum: 1.0,
  Optimism: 0.9,
  Polygon: 0.4,
  Avalanche: 1.2,
  Sui: 0.5,
  Aptos: 0.5,
  Sei: 0.5,
  'Hyperliquid L1': 0.7,
  Ink: 0.8,
  Tron: 0.9,
  Monad: 0.5,
  Stellar: 0.3,
  Ripple: 0.3,
  Flare: 0.5,
  Starknet: 1.2,
  'zkSync Era': 0.9,
  Linea: 0.7,
  Scroll: 0.7,
  Mantle: 0.6,
  Berachain: 0.7,
  Unichain: 0.8,
  'World Chain': 0.7,
  Sonic: 0.6,
  Fantom: 0.6,
  Gnosis: 0.5,
  Cronos: 0.7,
  Kava: 0.6,
  Near: 0.4,
  Cosmos: 0.5,
  Osmosis: 0.5,
  TON: 0.4,
};

/** The fallback per-step estimate for a chain the table does not name. */
export const GAS_DEFAULT_USD = 0.9;

/**
 * The multipliers and the implied value one protocol gets under `model`, given the
 * snapshot's median market-cap/TVL ratio and median pre-token age. Maturity is the main
 * weight — four years with no token earns the full premium, a fresh listing earns almost
 * none — growth is clamped so one wild week cannot dominate, and the overdue factor adds
 * 5% to every protocol older than the typical pre-token protocol.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  medianRatio: number,
  medianAge: number,
): {
  implied: number;
  baseValue: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  overdueMult: number;
  band: OverdueBand;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const band = overdueBandFor(age, medianAge);
  const overdueMult = band === 'on schedule' || band === 'unknown' ? 1 : model.overdue_factor;
  const baseValue = protocol.tvl_usd * medianRatio;
  const implied = Math.max(1, Math.round(baseValue * maturityMult * overdueMult * growthMult));
  return { implied, baseValue: Math.round(baseValue), growthPct, growthMult, maturityMult, overdueMult, band, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const medianRatio = medianMcapTvl(snapshot);
  const medianAge = medianPreTokenAge(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen. Exchanges and versioned
  // pools are not farmable launches, so the same rule the watchlist itself uses keeps them out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, medianRatio, medianAge);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    overdue_band: s.v.band,
    implied_value_usd: s.v.implied,
    model: {
      median_ratio: round4(medianRatio),
      median_age_days: medianAge,
      base_value_usd: s.v.baseValue,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      overdue_multiplier: s.v.overdueMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
export function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The estimated all-in cost of one farm step on the protocol's main chain. */
export function gasPerStepUsd(p: SnapshotProtocol): number {
  return GAS_USD_PER_STEP[chainOf(p)] ?? GAS_DEFAULT_USD;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a long-running protocol's farmers stay longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 45;
  if (age < 730) return 60;
  return 90;
}

/**
 * The category's core farm actions, in the words a farmer can follow. Each entry is one
 * step's action; the plan builder adds the shared setup, weekly, hold and claim steps
 * around them. Derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names.
 */
function coreActions(p: SnapshotProtocol, capital: number, chain: string): string[] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning interest`,
      `Borrow a small amount against that deposit, then repay it in full the following week`,
      `Cast a vote in ${name}'s governance, or finish one quest on its points page if it runs one`,
    ];
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return [
      `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the position in range`,
      `Swap a small amount through ${name} once a week so the wallet shows real trading activity`,
      `Stake the LP receipt in ${name}'s gauge or farm if one is live`,
    ];
  }
  if (c.includes('bridge') || c.includes('canonical bridge')) {
    return [
      `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app`,
      `Bridge a smaller amount back the next week, so the wallet shows two-way use`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token`,
      `Delegate or restake that receipt once more if ${name} offers a second layer`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position`,
      `Close the position and open a fresh small one once a week to show steady trading`,
      `Place one limit order as well as a market order, so both order types appear on the account`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and take one position in a ${name} market that settles within the week`,
      `Settle the position and open a new one the following week`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares`,
      `Move a small slice of the deposit into a second vault run by the same curator`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`,
      `Supply the minted asset to ${name}'s own pool so it earns yield while it sits`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it`,
      `Use that asset as collateral in one lending market that accepts it`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`,
      `Extend the cover once before it lapses, rather than letting it expire`,
    ];
  }
  if (c.includes('yield')) {
    return [
      `Deposit $${capital} into ${name}'s largest vault on ${chain} and hold the shares`,
      `Harvest or compound the yield once a week instead of letting it sit untouched`,
      `Split a small part of the deposit into a second ${name} vault on the same chain`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`,
    `Make one swap or interaction inside ${name}'s app every week`,
  ];
}

/**
 * A protocol's farm plan: 6 to 8 steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Older protocols get a longer hold: a farmer who has waited
 * years for a token is expected to wait a little longer still.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasPerStepUsd(p);
  const gasStr = `about $${gas.toFixed(2)} of gas and fees`;
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, fund it on ${chain}, and keep its seed phrase offline.`,
      cost: gasStr,
      time: '5 minutes',
    },
  ];
  for (const action of coreActions(p, capital, chain)) {
    steps.push({ text: `${action}.`, cost: gasStr, time: '15 minutes to set up' });
  }
  steps.push(
    {
      text: `Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active.`,
      cost: gasStr,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the protocol's own points or rewards page and claim only from a link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    overdue_band: row.overdue_band,
    implied_value_usd: row.implied_value_usd,
    base_value_usd: row.model.base_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    overdue_multiplier: row.model.overdue_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    // Full precision here: the dashboard recomputes each row's implied value from it,
    // so it must match the ratio the model scored with, not a rounded display value.
    median_ratio: medianMcapTvl(snapshot),
    median_age_days: medianPreTokenAge(snapshot),
    gas_table: GAS_USD_PER_STEP,
    gas_default_usd: GAS_DEFAULT_USD,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
