// Castability model — "can this deck pay this spell's coloured pips by the
// turn it wants to be cast?" (PRD #8772). ONE model, read by both the builder
// that chooses a Maindeck (`autoBuild.ts`'s castability term) and the Draft
// Table Audit that measures one (`src/lib/limited/draftTableAudit.ts`), so the
// build optimises exactly the number the audit's Floors hold.
//
// Declared and simple: a spell of mana value `mv` is cast on the play on turn
// `max(1, mv)`, having seen `7 + turn − 1` cards of the deck. It is castable
// when the mana sources among those cards can be ALLOCATED to its coloured
// pips, each source paying ONE pip of a colour it produces (issue #9338): a
// `{U}{B}` spell on one Underground Sea and nothing else is not castable, and
// a dual is never a full source of both colours on the same turn. The
// probability is exact — a multivariate hypergeometric over the deck's source
// kinds, summed over the draws whose sources admit such an allocation (Hall's
// condition). A source that sacrifices itself for mana counts as a fraction of
// one (`botDrafter.ts#sourceWeight`, issue #9337): a fractional kind count reads
// as the multilinear interpolation between the integer counts either side of
// it. Not modelled, deliberately: the generic part of the cost and the total
// land drop, `{C}` pips, mulligans, the draw on the draw.
//
// Pure: no DB, no registry, no RNG.
import type { Color } from "../cards/types";

/** Opening hand size, the first of the cards seen by a turn. */
export const OPENING_HAND = 7;

const TRUE_COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** A deck's mana sources by KIND: the key is the WUBRG-ordered string of the
 *  true colours one source produces (`"U"`, `"UB"`, `"WUBRG"`), the value how
 *  many such sources the deck holds — fractional when a one-shot source counts
 *  as part of one (`botDrafter.ts#sourceWeight`). A source producing no true
 *  colour has no key — it pays no coloured pip. */
export type ManaSourceKinds = ReadonlyMap<string, number>;

/** How much of a source of colour `c` a producer is (`botDrafter.ts#sourceWeight`):
 *  passed in, so this module stays free of the Bot's drafter. */
export type SourceWeight<P> = (producer: P, c: Color) => number;

/** A producer as the castability model reads it. */
export interface ManaProducer {
    producedColors: readonly Color[];
}

/** Below this a kind count is zero: the residue of adding and removing
 *  fractional weights. */
const COUNT_EPSILON = 1e-9;

/** The kind key of a source producing `colors` (`""` when it produces no
 *  true colour). */
export function sourceKindKey(colors: readonly Color[]): string {
    return TRUE_COLORS.filter((c) => colors.includes(c)).join("");
}

/** Counts `producers` by source kind (`ManaSourceKinds`), each weighted by
 *  `weight` (`addProducer`). A producer of no true colour is skipped. */
export function manaSourceKinds<P extends ManaProducer>(
    producers: readonly P[],
    weight: SourceWeight<P>
): Map<string, number> {
    const kinds = new Map<string, number>();
    for (const p of producers) addProducer(kinds, p, weight, 1);
    return kinds;
}

/** Adds one producer to `kinds` (`sign` −1 removes it). A producer whose
 *  colours all weigh the same is that weight of ONE kind; one whose colours
 *  weigh differently is split into layers so each colour's total equals its
 *  weight — a source full for `U` and half for `B` is half a `"UB"` source
 *  plus half a `"U"` source. */
export function addProducer<P extends ManaProducer>(
    kinds: Map<string, number>,
    producer: P,
    weight: SourceWeight<P>,
    sign: 1 | -1
): void {
    const weighted = producer.producedColors
        .filter((c) => TRUE_COLORS.includes(c))
        .map((c) => ({ c, w: weight(producer, c) }))
        .filter((x) => x.w > 0);
    const levels = [...new Set(weighted.map((x) => x.w))].sort((a, b) => b - a);
    levels.forEach((w, i) => {
        const below = levels[i + 1] ?? 0;
        const colors = weighted.filter((x) => x.w >= w).map((x) => x.c);
        addSources(kinds, colors, sign * (w - below));
    });
}

/** Adds `count` sources producing `colors` to `kinds` (a negative `count`
 *  removes them, never below zero). */
export function addSources(
    kinds: Map<string, number>,
    colors: readonly Color[],
    count: number
): void {
    const key = sourceKindKey(colors);
    if (key === "") return;
    const n = Math.max(0, (kinds.get(key) ?? 0) + count);
    if (n < COUNT_EPSILON) kinds.delete(key);
    else kinds.set(key, n);
}

/** `C(n, k)` as a float, 0 outside `0 ≤ k ≤ n`. */
function binomial(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    const m = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < m; i++) r = (r * (n - i)) / (i + 1);
    return r;
}

/** `P(X ≥ atLeast)` for `X ~ Hypergeometric(population, successes, draws)`.
 *  A fractional `successes` (a deck counting a one-shot source as half a
 *  source, `botDrafter.ts#sourceWeight`) reads as the linear interpolation
 *  between the integer counts either side of it. */
export function hypergeometricAtLeast(
    population: number,
    successes: number,
    draws: number,
    atLeast: number
): number {
    if (atLeast <= 0) return 1;
    const whole = Math.floor(successes);
    const part = successes - whole;
    if (part > 0) {
        return (
            (1 - part) *
                hypergeometricAtLeast(population, whole, draws, atLeast) +
            part * hypergeometricAtLeast(population, whole + 1, draws, atLeast)
        );
    }
    const n = Math.min(draws, population);
    if (successes < atLeast || n < atLeast) return 0;
    const lnC = (a: number, b: number): number => {
        let s = 0;
        for (let i = 0; i < b; i++) s += Math.log(a - i) - Math.log(i + 1);
        return s;
    };
    const failures = population - successes;
    let below = 0;
    for (let k = Math.max(0, n - failures); k < atLeast; k++) {
        below += Math.exp(
            lnC(successes, k) + lnC(failures, n - k) - lnC(population, n)
        );
    }
    return Math.max(0, Math.min(1, 1 - below));
}

/** One group of sources, as the spell sees them: the bitmask of the spell's
 *  needed colours they produce, how many the deck holds, and the most of them
 *  any allocation can use (the pips of those colours). */
interface SourceGroup {
    mask: number;
    count: number;
    cap: number;
}

/** The probability, under the declared model, that a spell with these
 *  coloured `pips` and this `manaValue` has every pip payable by its own turn
 *  in a `deckSize`-card deck holding these `sources`, each source paying one
 *  pip of a colour it produces. A spell with no coloured pip reads 1: nothing
 *  to pay for. */
export function pipCastability(
    pips: Partial<Record<Color, number>>,
    manaValue: number,
    deckSize: number,
    sources: ManaSourceKinds
): number {
    const needed = TRUE_COLORS.filter((c) => (pips[c] ?? 0) > 0);
    if (needed.length === 0) return 1;
    const need = needed.map((c) => pips[c] ?? 0);
    const draws = Math.min(
        deckSize,
        OPENING_HAND + Math.max(1, Math.round(manaValue)) - 1
    );

    // Group the sources by the needed colours they produce; the rest pay
    // nothing this spell asks for.
    const byMask = new Map<number, number>();
    for (const [key, count] of sources) {
        let mask = 0;
        needed.forEach((c, i) => {
            if (key.includes(c)) mask |= 1 << i;
        });
        if (mask !== 0) byMask.set(mask, (byMask.get(mask) ?? 0) + count);
    }
    const groups: SourceGroup[] = [...byMask].map(([mask, count]) => ({
        mask,
        count,
        cap: need.reduce((s, n, i) => (mask & (1 << i) ? s + n : s), 0),
    }));
    // A fractional group count (a one-shot source weighing part of one)
    // reads as the multilinear interpolation between the integer counts
    // either side of it — per group, the same rule `hypergeometricAtLeast`
    // applies to one colour.
    const fractional = groups
        .map((g, i) => ({ i, part: g.count - Math.floor(g.count) }))
        .filter((x) => x.part > COUNT_EPSILON && 1 - x.part > COUNT_EPSILON);
    const whole = groups.map((g) => ({
        ...g,
        count: Math.floor(g.count + COUNT_EPSILON),
    }));
    let p = 0;
    for (let corner = 0; corner < 1 << fractional.length; corner++) {
        let weight = 1;
        const at = whole.map((g) => ({ ...g }));
        fractional.forEach(({ i, part }, bit) => {
            if (corner & (1 << bit)) {
                at[i].count += 1;
                weight *= part;
            } else {
                weight *= 1 - part;
            }
        });
        p += weight * castabilityAtCounts(need, at, draws, deckSize);
    }
    return Math.max(0, Math.min(1, p));
}

/** `pipCastability` for integer group counts. */
function castabilityAtCounts(
    need: readonly number[],
    groups: readonly SourceGroup[],
    draws: number,
    deckSize: number
): number {
    const useful = groups.reduce((s, g) => s + g.count, 0);
    const others = Math.max(0, deckSize - useful);
    const population = useful + others;

    // One needed colour: every useful source pays it — the plain
    // hypergeometric tail.
    if (need.length === 1) {
        return hypergeometricAtLeast(population, useful, draws, need[0]);
    }

    // Exact sum over the drawn count of each group, capped at what an
    // allocation can use (a source past `cap` changes no allocation). The
    // state is (sources drawn so far, capped count per group); the weight is
    // the number of ways to draw them.
    const radix = groups.map((g) => g.cap + 1);
    let states = new Map<number, { drawn: number; vec: number[]; w: number }>();
    states.set(0, { drawn: 0, vec: groups.map(() => 0), w: 1 });
    groups.forEach((g, gi) => {
        const next = new Map<
            number,
            { drawn: number; vec: number[]; w: number }
        >();
        for (const s of states.values()) {
            const most = Math.min(g.count, draws - s.drawn);
            for (let k = 0; k <= most; k++) {
                const vec = s.vec.slice();
                vec[gi] = Math.min(k, g.cap);
                const drawn = s.drawn + k;
                let key = drawn;
                for (let i = 0; i < vec.length; i++) {
                    key = key * radix[i] + vec[i];
                }
                const w = s.w * binomial(g.count, k);
                const prev = next.get(key);
                if (prev) prev.w += w;
                else next.set(key, { drawn, vec, w });
            }
        }
        states = next;
    });

    const total = binomial(population, draws);
    if (total === 0) return 0;
    let ok = 0;
    for (const s of states.values()) {
        if (!allocatable(need, groups, s.vec)) continue;
        ok += s.w * binomial(others, draws - s.drawn);
    }
    return Math.max(0, Math.min(1, ok / total));
}

/** Hall's condition: the drawn sources can pay every pip, one pip each, iff
 *  for every set of needed colours the sources producing any of them number
 *  at least those colours' pips. */
function allocatable(
    need: readonly number[],
    groups: readonly SourceGroup[],
    drawn: readonly number[]
): boolean {
    const full = (1 << need.length) - 1;
    for (let set = 1; set <= full; set++) {
        let pips = 0;
        need.forEach((n, i) => {
            if (set & (1 << i)) pips += n;
        });
        let supply = 0;
        groups.forEach((g, gi) => {
            if (g.mask & set) supply += drawn[gi];
        });
        if (supply < pips) return false;
    }
    return true;
}

/** True when the spell has at least one coloured pip to pay for. */
export function hasColouredPip(pips: Partial<Record<Color, number>>): boolean {
    return TRUE_COLORS.some((c) => (pips[c] ?? 0) > 0);
}
