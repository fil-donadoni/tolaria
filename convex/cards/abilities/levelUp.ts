// Level Up (CR 702.87) and the LEVEL symbols of a leveler card (CR 711) —
// the WHOLE mechanic in one factory module, so a second leveler card is a
// card-file edit and no engine change at all.
//
// CR 702.87a: "Level up [cost]" means "[Cost]: Put a level counter on this
//   permanent. Activate only as a sorcery."
// CR 711.2a: "{LEVEL N1-N2} [Abilities] [P/T]" means "As long as this creature
//   has at least N1 level counters on it, but no more than N2 level counters
//   on it, it has base power and toughness [P/T] and has [abilities]."
// CR 711.2b: "{LEVEL N3+} [Abilities] [P/T]" means "As long as this creature
//   has N3 or more level counters on it, it has base power and toughness
//   [P/T] and has [abilities]."
// CR 711.4: a leveler permanent has its level up ability at ALL times — it is
//   never gated on the current level, so the ability below carries no
//   `canActivate`.
// CR 711.5/711.6: below N1, and in every zone other than the battlefield, the
//   card has its uppermost printed P/T — which is exactly the definition's own
//   `power`/`toughness`, so the sub-N1 band is expressed by OMISSION rather
//   than by a third static effect.
//
// No new Op and no new `StaticEffect` kind (primitive reuse, ADR 0045 /
// `.claude/rules/gre-development.md` § Primitive reuse): the whole mechanic
// decomposes into three already-exercised primitives —
//   - the `counters` Op (`action: "add"`, issue #841) on `$source`, CR 122.1,
//     with the free-form counter type `"level"`;
//   - `sorcerySpeedOnly` on the activated ability (CR 602.5d, which defers to
//     307.5's timing template) — already honoured by `gre/moves.ts` (bot Move
//     enumeration), `gre/ai/abilityTiming.ts` and `src/lib/card-utils.ts`
//     (the client's activation gate);
//   - a `pt-set` (CR 613.4b, layer 7b) plus a `keyword-grant` (CR 613.1f,
//     layer 6) per band, both gated on the source's own level-counter count.
//
// Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) row
// `id: "level-up"` is the name authority; its `binding` points back here.

import type { ActivatedAbility, ManaCost, StaticEffect } from "../types";

/** CR 122.1 / 702.87a — the counter type a level up ability puts on its
 *  permanent. Not a P/T-modifying counter type (layer 7d parses only the
 *  `"+N/+N"` shape), so the level bands below are what move the stats. */
export const LEVEL_COUNTER = "level";

export interface LevelUpArgs {
    /** Stable id within the source card's `activatedAbilities` array.
     *  Defaults to `"level-up"`. */
    id?: string;
    /** The level up activation cost (CR 702.87a). */
    cost: ManaCost;
    /** The cost as printed in the keyword line, e.g. `"{1}"`. */
    costLabel: string;
    /** Full oracle text override; defaults to the printed keyword line plus
     *  its standard reminder text. */
    oracleText?: string;
}

/** Builds the Level Up activated ability (CR 702.87a). Add it to a leveler
 *  card's `activatedAbilities`; pair it with {@link levelBandStatics}. */
export function levelUpAbility(args: LevelUpArgs): ActivatedAbility {
    return {
        id: args.id ?? "level-up",
        oracleText:
            args.oracleText ??
            `Level up ${args.costLabel} (${args.costLabel}: Put a level counter on this. Level up only as a sorcery.)`,
        cost: { mana: args.cost },
        // CR 702.87a — "Activate only as a sorcery": the CR 307.5 timing
        // template, i.e. only during the controller's own main phase with an
        // empty stack.
        sorcerySpeedOnly: true,
        useStack: true,
        effects: [
            {
                op: "counters",
                action: "add",
                counter: LEVEL_COUNTER,
                target: { ref: "$source" },
                count: 1,
            },
        ],
    };
}

/** One LEVEL symbol of a leveler card (CR 711.2) — itself a keyword ability
 *  representing a static ability (CR 711.2). `max` omitted is the final
 *  `{LEVEL N3+}` band (CR 711.2b). */
export interface LevelBand {
    /** N1 / N3 — the fewest level counters at which the band applies. */
    min: number;
    /** N2 — the most level counters at which the band still applies
     *  (inclusive). Omit for an open-ended `{LEVEL N+}` band. */
    max?: number;
    /** The base power the band sets (CR 711.2a — "base power and toughness"). */
    power: number;
    /** The base toughness the band sets. */
    toughness: number;
    /** Keyword strings the band grants while it applies (CR 711.2 — "and has
     *  [abilities]"). */
    abilities?: readonly string[];
}

/** CR 711.1/711.2 — rejects a band set that cannot describe a printed leveler:
 *  no bands at all, an empty range, an open-ended band that is not the last
 *  one, a closed LAST band, or two bands that overlap or arrive out of order.
 *  Throws at module load (a card's `staticEffects` is built when its set file
 *  is imported), so a malformed leveler is a red catalogue, never a permanent
 *  with two racing layer-7b effects. */
function assertWellFormedBands(bands: readonly LevelBand[]): void {
    if (bands.length === 0) {
        throw new Error(
            "levelBandStatics: a leveler card has at least one LEVEL symbol (CR 711.1)"
        );
    }
    for (let i = 0; i < bands.length; i++) {
        const { min, max } = bands[i];
        const isLast = i === bands.length - 1;
        if (max !== undefined && max < min) {
            throw new Error(
                `levelBandStatics: LEVEL ${min}-${max} is an empty range (CR 711.2a)`
            );
        }
        if (isLast) {
            // CR 711.2b — the last symbol is "{LEVEL N3+}": open-ended, or a
            // level above it would belong to no band at all.
            if (max !== undefined) {
                throw new Error(
                    `levelBandStatics: the last LEVEL symbol must be open-ended (CR 711.2b), got ${min}-${max}`
                );
            }
            continue;
        }
        if (max === undefined) {
            throw new Error(
                `levelBandStatics: only the last LEVEL symbol may be open-ended (CR 711.2b), LEVEL ${min}+ is not`
            );
        }
        if (bands[i + 1].min <= max) {
            throw new Error(
                `levelBandStatics: LEVEL symbols overlap or are out of order (CR 711.2) — ${min}-${max} then ${bands[i + 1].min}`
            );
        }
    }
}

/** Builds the continuous static effects for a leveler card's LEVEL symbols
 *  (CR 711.2a/b). Each band contributes a layer-7b `pt-set` (CR 613.4b) and
 *  one layer-6 `keyword-grant` per granted ability (CR 613.1f), both applying
 *  to the source itself and both gated on its own level-counter count.
 *
 *  The bands MUST be ordered, mutually exclusive, and open-ended only in the
 *  LAST symbol — CR 711.2's printed shape. Checked here rather than left to
 *  the author: two overlapping bands would emit two layer-7b `pt-set`s from
 *  the SAME source with the SAME CR 613.7a timestamp, an unordered tie with no
 *  defined winner; and a level ABOVE a closed final band would silently fall
 *  back to the printed P/T, which is CR 711.5's answer for a level BELOW the
 *  first band and means nothing above the last one. */
export function levelBandStatics(bands: readonly LevelBand[]): StaticEffect[] {
    assertWellFormedBands(bands);
    const effects: StaticEffect[] = [];
    for (const band of bands) {
        const { min, max } = band;
        effects.push({
            kind: "pt-set",
            // CR 711.2a/b — "as long as this creature has at least N1 level
            // counters on it, but no more than N2". `pt-set` is a RECOMPUTED
            // kind (evaluated at every stat read), so the band tracks the
            // counters live with no dependency declaration.
            applies: (target, source, ctx) =>
                target.id === source.id &&
                ctx.getCounterCount(target, LEVEL_COUNTER) >= min &&
                (max === undefined ||
                    ctx.getCounterCount(target, LEVEL_COUNTER) <= max),
            power: band.power,
            toughness: band.toughness,
        });
        for (const ability of band.abilities ?? []) {
            effects.push({
                kind: "keyword-grant",
                // CR 613.5 (issue #1711) — required, not optional: the
                // catalogue guard `counterGatedStatics.test.ts` demands the
                // declaration on every MATERIALIZED kind whose predicate reads
                // counters, and `keyword-grant` is one. It is that guard which
                // makes the flag load-bearing today, not the recompute: since
                // PRD #2064 S4 `recomputeContinuousEffects` no longer filters
                // on it (layer 6 is a per-read derivation). The declaration
                // stays the honest description of what the predicate reads.
                dependsOnCounters: true,
                applies: (target, source, ctx) =>
                    target.id === source.id &&
                    ctx.getCounterCount(target, LEVEL_COUNTER) >= min &&
                    (max === undefined ||
                        ctx.getCounterCount(target, LEVEL_COUNTER) <= max),
                keyword: ability,
            });
        }
    }
    return effects;
}
