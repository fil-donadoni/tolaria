/**
 * Corpus-scaled size budgets for `bun run check:bundle` (issue #9489).
 *
 * WHY THIS EXISTS. The `card-set-` budget row sums every hand-written Set
 * chunk. It was a fixed byte count (490,000 B). The corpus it measures grows
 * with every hand-written card, and hand-tail cards land daily.
 * `check:bundle` is health-only (12–24 s), so no `cards` diff ever ran it. Ordinary card growth (2,097 → 2,266 `defineCard`, 436,709
 * → 490,902 B gzip, ≈ 320 B per card) went over the number and turned base
 * tip `18ba7b7be854` RED. Nothing had gone wrong: the row exists to catch
 * the literal pool coming back into a client graph (+99 KB), and a fixed
 * number over a growing corpus catches growth instead.
 *
 * So a `sum` row's budget is a function of the corpus it sums: an anchor
 * measurement plus headroom, plus a per-unit allowance for every unit added
 * since. The allowance sits just above the observed marginal, so ordinary
 * growth never uses up the headroom. The headroom sits below the re-entry
 * jump, so re-entry still goes red. The two pull against each other: every
 * unit adds `perUnitBytes − marginal` of slack, so re-entry is caught only
 * within `reanchorHorizon` units of the anchor. Past the horizon
 * `bundle-budget.test.ts` goes red and asks for a re-anchor: re-measure
 * (`bun run check:bundle` prints the sum) and move the anchor. That is a
 * one-line edit, made deliberately, about once per doubling of the corpus.
 *
 * A CORPUS ALSO SHRINKS, AND NOT AT THE SAME RATE (issue #10048). The Oracle
 * migrations retire hand-written cards — the ones the grammar compiles, the
 * simplest first. From the first anchor (2,266 cards, 490,902 B) to tip
 * `7700f6300f9d`, 259 cards were retired and 17 added: the chunks shrank
 * 32,862 B, about 136 B per net card removed. The budget gave back the growth
 * allowance, 340 B, for each. That is 49,418 B more than the chunks shrank,
 * past the 49,000 B headroom, and the tip went RED on 458,040 B > 457,622 B.
 * Nothing had come back.
 *
 * So the two directions carry two rates. A unit ADDED is allowed
 * `perUnitBytes`, at or above what a card costs. A unit REMOVED gives back
 * `perUnitShrinkBytes`, at or below what a retired card sheds. Retirement
 * loosens the budget by `shed − perUnitShrinkBytes` per card, so re-entry is
 * caught only within `reanchorHorizonBelow` units under the anchor. The
 * horizon is sized for a retired card shedding as much as the mean card
 * (`meanUnitBytes`), well above the shed observed. Outside either horizon
 * `bundle-budget.test.ts` goes red, and `check:lane` runs it on every diff
 * that moves the corpus (the `bundle-budget` cheap guard), so the re-anchor
 * is asked of the landing that crosses the horizon, never of the base tip.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ScaledBudget {
    /** Units in the corpus when the anchor was measured. */
    anchorUnits: number;
    /** gzip bytes measured on that corpus. */
    anchorBytes: number;
    /** Fixed slack over the anchor, in gzip bytes. Must stay below the jump
     *  the row exists to catch. */
    headroomBytes: number;
    /** gzip bytes allowed per unit added since the anchor. Must stay at or
     *  above the observed marginal, or ordinary growth uses up the headroom. */
    perUnitBytes: number;
    /** gzip bytes given back per unit removed since the anchor. Must stay at
     *  or below the observed shed, or ordinary retirement uses up the
     *  headroom (issue #10048). */
    perUnitShrinkBytes: number;
    /** Units past the anchor within which the row still catches its jump
     *  (the slack `perUnitBytes − marginal` adds up per unit). The live corpus
     *  past this → re-anchor. */
    reanchorHorizon: number;
    /** Units under the anchor within which the row still catches its jump
     *  (the slack `shed − perUnitShrinkBytes` adds up per unit). The live
     *  corpus under this → re-anchor. */
    reanchorHorizonBelow: number;
}

/** The budget for a corpus of `units`: the growth allowance above the
 *  anchor, the smaller shrink rate below it. */
export function scaledBudgetBytes(b: ScaledBudget, units: number): number {
    const delta = units - b.anchorUnits;
    return (
        b.anchorBytes +
        b.headroomBytes +
        (delta >= 0 ? b.perUnitBytes : b.perUnitShrinkBytes) * delta
    );
}

/** The mean gzip weight of one unit at the anchor. The most a retired unit is
 *  ASSUMED to shed when the lower horizon is sized. One stretch was measured:
 *  the Set chunks' retired cards shed 135 B against a mean of 217 B. */
export function meanUnitBytes(b: ScaledBudget): number {
    return b.anchorBytes / b.anchorUnits;
}

/** True while `units` is inside both re-anchor horizons, the range the
 *  budget is sound in. Outside it: re-measure, move the anchor. */
export function withinReanchorHorizons(
    b: ScaledBudget,
    units: number
): boolean {
    const delta = units - b.anchorUnits;
    return delta <= b.reanchorHorizon && -delta <= b.reanchorHorizonBelow;
}

/** Literal-pool re-entry into a client graph (issue #2702: +97–99 KB gzip
 *  measured). The jump the `card-set-` row exists to catch. */
export const POOL_REENTRY_GZIP_BYTES = 97_000;

/** Observed marginal gzip cost of one hand-written card in the Set chunks:
 *  (490,902 − 436,709) B / (2,266 − 2,097) cards, from issue #5615 to tip
 *  `18ba7b7be854` (issue #9489). */
export const OBSERVED_SET_BYTES_PER_CARD = 321;

/** Observed gzip shed of one retired hand-written card in the Set chunks:
 *  (490,902 − 458,040) B / (2,266 − 2,024) cards, from issue #9489's anchor to
 *  tip `7700f6300f9d` (259 retired, 17 added; issue #10048). Rounded down. */
export const OBSERVED_SET_BYTES_PER_RETIRED_CARD = 135;

/** The `card-set-` row, anchored on the RED tip's measurement (issue #10048;
 *  first anchored at 2,266 cards / 490,902 B by issue #9489). */
export const SET_CHUNK_BUDGET: ScaledBudget = {
    anchorUnits: 2_024,
    anchorBytes: 458_040,
    headroomBytes: 49_000,
    perUnitBytes: 340,
    perUnitShrinkBytes: 100,
    reanchorHorizon: 2_000,
    reanchorHorizonBelow: 350,
};

const DEFINE_CARD = /\bdefineCard\(/g;

/** Hand-written cards in the Set modules: `defineCard(` calls across
 *  `convex/cards/sets/<set>/*.cards.ts`, which is exactly what the
 *  `card-set-<code>` chunks bundle. */
export function countHandWrittenCards(root: string): number {
    const setsDir = join(root, "convex", "cards", "sets");
    let n = 0;
    for (const set of readdirSync(setsDir, { withFileTypes: true })) {
        if (!set.isDirectory() || set.name.startsWith("__")) continue;
        const dir = join(setsDir, set.name);
        for (const f of readdirSync(dir)) {
            if (!f.endsWith(".cards.ts")) continue;
            n +=
                readFileSync(join(dir, f), "utf8").match(DEFINE_CARD)?.length ??
                0;
        }
    }
    return n;
}
