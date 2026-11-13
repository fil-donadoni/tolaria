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
    /** Units past the anchor within which the row still catches its jump
     *  (the slack `perUnitBytes − marginal` adds up per unit). The live corpus
     *  past this → re-anchor. */
    reanchorHorizon: number;
}

/** The budget for a corpus of `units`. */
export function scaledBudgetBytes(b: ScaledBudget, units: number): number {
    return (
        b.anchorBytes +
        b.headroomBytes +
        b.perUnitBytes * (units - b.anchorUnits)
    );
}

/** Literal-pool re-entry into a client graph (issue #2702: +97–99 KB gzip
 *  measured). The jump the `card-set-` row exists to catch. */
export const POOL_REENTRY_GZIP_BYTES = 97_000;

/** Observed marginal gzip cost of one hand-written card in the Set chunks:
 *  (490,902 − 436,709) B / (2,266 − 2,097) cards, from issue #5615 to tip
 *  `18ba7b7be854` (issue #9489). */
export const OBSERVED_SET_BYTES_PER_CARD = 321;

/** The `card-set-` row, anchored on the RED tip's measurement (issue #9489). */
export const SET_CHUNK_BUDGET: ScaledBudget = {
    anchorUnits: 2_266,
    anchorBytes: 490_902,
    headroomBytes: 49_000,
    perUnitBytes: 340,
    reanchorHorizon: 2_000,
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
