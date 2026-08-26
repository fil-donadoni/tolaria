/**
 * Pure formatting vocabulary shared by Now and History (#2625).
 *
 * Every export here is a total function of its arguments: no DOM, no fetch, no
 * module-level mutable state. That is what lets the Now modules that build
 * HTML strings from it be imported and executed directly by the `node` vitest
 * project, which has neither a DOM nor a browser.
 */

export const isSeconds = (m) => m.endsWith("seconds");
export const isCost = (m) => m.includes("cost");
export const isTokens = (m) => m.endsWith("tokens");

export function fmtDur(s) {
    if (s == null) return "–";
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    const h = Math.floor(s / 3600);
    return `${h}h ${Math.round((s % 3600) / 60)}m`;
}

// Counts are whole things — rendering one run as "1.0" reads as a
// rate, not a tally.
export const isCount = (m) => ["runs", "calls", "messages"].includes(m);

/**
 * Only a sum composes. A mean or a max is a statistic of the rows in
 * its own group: stacking them produces a number that measures
 * nothing, and dividing one by another is not a share. Everything
 * that stacks, totals, or expresses a percentage is gated on this.
 */
export const isAdditive = (m) => !/^(avg|max)_/.test(m);

export function fmtNum(n, integral = false) {
    if (n == null) return "–";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(1) + "k";
    if (integral || a >= 10) return Math.round(n).toLocaleString();
    return n.toFixed(1);
}

/** `ageHours` (a `ClaimRow`'s own float) as elapsed time a person reads at a
 *  glance — `23h ago`, `42m ago` — for the Now claims table (#2632). Minutes
 *  below one hour: a claim that is 3 minutes old reading "0h ago" looks
 *  identical to one that is 55 minutes old. */
export function fmtAgo(hours) {
    if (hours == null) return "—";
    // FLOOR, not round (#2632 review finding 8) — "23h ago" must mean "at
    // least 23 whole hours have elapsed", the reading the AC's own example
    // (23.8h → "23h ago") states; rounding instead reports a claim as one
    // hour (or minute) OLDER than it has actually been alive, which is the
    // wrong direction for a staleness/amber signal to lie in.
    if (hours < 1) return `${Math.floor(hours * 60)}m ago`;
    return `${Math.floor(hours)}h ago`;
}

/** Unix SECONDS → a 24h `HH:MM` clock reading, in the viewer's own local
 *  time zone — the Now view's `Batch #389 · started 22:24` heading (#2632).
 *  `null` in, `null` out: `batchStartedAt` (`lib/loop-status.ts`) is `null`
 *  when the batch is empty or predates the `ts` field, and this must not
 *  turn that into a fabricated "00:00". */
export function fmtClock(epochSeconds) {
    if (epochSeconds == null) return null;
    const d = new Date(epochSeconds * 1000);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function fmtUsd(n) {
    if (n == null) return "–";
    return n >= 100 ? "$" + Math.round(n).toLocaleString() : "$" + n.toFixed(2);
}

export function fmtMetric(metric, v) {
    if (isSeconds(metric)) return fmtDur(v);
    if (isCost(metric)) return fmtUsd(v);
    return fmtNum(v, isCount(metric));
}

/** HTML-escape. Every `innerHTML` template on this page routes through it. */
export const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"]/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
            })[c]
    );

/** `claude-opus-4-1-20250805` → `opus`. */
export const tier = (m) =>
    m ? m.replace(/^claude-/, "").replace(/-\d.*$/, "") : "—";

/** minutes · cost, or an em-dash when the cell is empty. */
export const mc = (min, cost) =>
    min || cost
        ? `${Math.round(min)}' · ${fmtUsd(cost)}`
        : "<span class='mini'>—</span>";

/**
 * Whole minutes with this page's own minute mark ('), or the shared
 * empty-cell placeholder when there is nothing to show (#2634). The ONE
 * authority for a per-role minute cell — before this, the Issues and
 * Sessions tables each duplicated `Math.round(v) + "'"` at four call sites
 * apiece, the exact "toFixed sprinkled around" shape this exists to end.
 */
export const fmtMin = (m) =>
    m ? `${Math.round(m)}'` : "<span class='mini'>—</span>";

/** Dollars, or the shared empty-cell placeholder — the ternary the Issues
 *  table's four cost columns used to repeat at every call site (#2634). */
export const fmtUsdCell = (n) =>
    n ? fmtUsd(n) : "<span class='mini'>—</span>";
