/**
 * The Now view's formatting vocabulary (PRD #3148 S2), ported from
 * `scripts/dashboard/format.js` (#2625).
 *
 * Every export is a total function of its arguments: no DOM, no fetch, no
 * module-level state. What did NOT come across is `esc` — the vanilla modules
 * built HTML strings and had to escape every interpolation by hand, which is
 * exactly the class of bug the PRD names ("a cell is a string of HTML the
 * caller must remember to escape"). React escapes text nodes, so the function
 * has no call site here and importing it would invite one back.
 *
 * S3 brought the History half across: `fmtDur`, `fmtMetric`, `tier`, `fmtMin`,
 * `mc` and the three metric PREDICATES below. The predicates are the load-
 * bearing ones — `isAdditive` decides whether a chart may stack, whether a
 * tile may express a share, and whether a series tail may fold into "Other".
 * Get it wrong and the page prints a number that measures nothing.
 *
 * `format.js` stays where it is until S4, which deletes it with the directory.
 */

export function fmtNum(n: number | null | undefined, integral = false): string {
    if (n == null) return "–";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(1) + "k";
    if (integral || a >= 10) return Math.round(n).toLocaleString();
    return n.toFixed(1);
}

/** A whole-token figure with a thousands separator or a k/M suffix — the
 *  tally form, never `1234.0`. */
export const fmtTokens = (n: number | null | undefined): string =>
    fmtNum(n, true);

export function fmtUsd(n: number | null | undefined): string {
    if (n == null) return "–";
    return n >= 100 ? "$" + Math.round(n).toLocaleString() : "$" + n.toFixed(2);
}

/**
 * `ClaimRow.ageHours` as elapsed time a person reads at a glance.
 *
 * FLOOR, not round (#2632 review finding 8): "23h ago" must mean at least 23
 * whole hours have elapsed. Rounding reports a claim as an hour OLDER than it
 * is, which is the wrong direction for a staleness signal to lie in. Minutes
 * below one hour, because a 3-minute-old claim reading "0h ago" is
 * indistinguishable from a 55-minute-old one.
 */
export function fmtAgo(hours: number | null | undefined): string {
    if (hours == null) return "—";
    if (hours < 1) return `${Math.floor(hours * 60)}m ago`;
    return `${Math.floor(hours)}h ago`;
}

/** Elapsed time from an epoch-ms stamp: `just now`, `3m ago`, `2h ago`,
 *  `3d ago`. Floors, like `fmtAgo`, and for the same reason. */
export function fmtAgoMs(
    ms: number | null | undefined,
    nowMs: number = Date.now()
): string {
    if (ms == null || !Number.isFinite(ms)) return "—";
    const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86_400)}d ago`;
}

/** Unix SECONDS → a local 24h `HH:MM`. `null` in, `null` out: `batchStartedAt`
 *  is `null` for an empty batch, and this must not fabricate a `00:00`. */
export function fmtClock(
    epochSeconds: number | null | undefined
): string | null {
    if (epochSeconds == null) return null;
    const d = new Date(epochSeconds * 1000);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

/** Epoch MS → a local `HH:MM`; `fmtClock` takes seconds. */
export const fmtClockMs = (ms: number | null | undefined): string | null =>
    ms == null ? null : fmtClock(Math.floor(ms / 1000));

/**
 * The driver's `pct` as a person reads it: a whole percent — `28%`, never
 * `28.03027192142857` — or the literal `n/a` the driver logs when no budget
 * ceiling is configured, passed through as words.
 */
export function fmtPct(raw: string | number | null | undefined): string {
    const n = Number(raw);
    if (raw == null || raw === "" || !Number.isFinite(n)) {
        return raw == null || raw === "" ? "—" : String(raw);
    }
    return `${Math.round(n)}%`;
}

/** A local `HH:MM:SS` — the tail drawer's per-entry stamp. */
export function fmtTime(ms: number | null | undefined): string {
    if (ms == null) return "";
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
}

/**
 * The dashboard's own repo slug, mirroring the default `TOLARIA_PROJECT_REPO`
 * hardcoded server-side in `scripts/loop-status.ts`. This page is
 * loopback-only, single-user tooling (PRD #2621 D11) — not something that
 * warrants a server round trip to learn its own slug.
 */
export const GITHUB_REPO = "fil-donadoni/tolaria";

export const issueUrl = (n: number | string): string =>
    `https://github.com/${GITHUB_REPO}/issues/${n}`;

export const plural = (n: number, one: string, many: string): string =>
    n === 1 ? one : many;

/* ─────────────────────────────────────────────────────────────────────────
   THE HISTORY HALF (PRD #3148 S3)
   ───────────────────────────────────────────────────────────────────────── */

/** A metric name's UNIT, read off the name — the store returns bare numbers
 *  and the column name is the only thing that says what they count. */
export const isSeconds = (m: string): boolean => m.endsWith("seconds");
export const isCost = (m: string): boolean => m.includes("cost");

/** Counts are whole things — rendering one run as "1.0" reads as a rate,
 *  not a tally. */
export const isCount = (m: string): boolean =>
    ["runs", "calls", "messages"].includes(m);

/**
 * Only a SUM composes. A mean or a max is a statistic of the rows in its own
 * group: stacking them produces a number that measures nothing, and dividing
 * one by another is not a share. Everything that stacks, totals, or expresses
 * a percentage is gated on this.
 */
export const isAdditive = (m: string): boolean => !/^(avg|max)_/.test(m);

/** Seconds as elapsed time a person reads at a glance. */
export function fmtDur(s: number | null | undefined): string {
    if (s == null) return "–";
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    const h = Math.floor(s / 3600);
    return `${h}h ${Math.round((s % 3600) / 60)}m`;
}

/** A metric value in the unit its NAME implies — the one formatter every
 *  History chart, tile and table cell goes through, so a duration cannot
 *  render as a bare number in one card and as `2h 14m` in the next. */
export function fmtMetric(
    metric: string,
    v: number | null | undefined
): string {
    if (isSeconds(metric)) return fmtDur(v);
    if (isCost(metric)) return fmtUsd(v);
    return fmtNum(v, isCount(metric));
}

/** `claude-opus-4-1-20250805` → `opus`. */
export const tier = (m: string | null | undefined): string =>
    m ? m.replace(/^claude-/, "").replace(/-\d.*$/, "") : "—";

/** Whole minutes with this page's own minute mark. The ONE authority for a
 *  per-role minute cell — before #2634 the Issues and Sessions tables each
 *  repeated `Math.round(v) + "'"` at four call sites apiece. */
export const fmtMin = (m: number): string => `${Math.round(m)}'`;

/**
 * minutes · cost — the Family × role pivot's cell, or `null` when there is
 * nothing to show.
 *
 * `null` rather than an em-dash string, because the caller renders the empty
 * mark as a component. The DISTINCTION is the point and it is the vanilla
 * one: a role cell can exist and still sum to zero (a run that took no
 * measurable time and cost nothing), and `0' · $0.00` claims a measurement
 * where the table means "nothing happened here".
 */
export const mc = (min: number, cost: number): string | null =>
    min || cost ? `${Math.round(min)}' · ${fmtUsd(cost)}` : null;
