/**
 * Lowering: static-clause IR → the `CardDefinition` fields a continuous static
 * ability lives in (CR 113.3d, ADR 0045 / ADR 0105).
 *
 * There are three destinations, and which one a clause takes is a statement
 * about the ENGINE, not about the sentence — which is why this file exists
 * rather than the clause carrying its own encoding:
 *
 *  - `compiledStaticEffects[]` — a real CR 611 continuous effect, emitted as a
 *    JSON descriptor because every `StaticEffect` kind carries a predicate
 *    closure (`cards/compiledStatics.ts`);
 *  - `entersTapped` / `entersWith` — a CR 614.1c self-replacement. NOT a
 *    continuous effect and deliberately not modelled as one: it is applied as
 *    the permanent enters, before the first layer read, and the catalogue-wide
 *    guard `cards/__tests__/entersWithCounters.test.ts` reds on the trigger-
 *    shaped alternative;
 *  - `staticAbilities[]` — the `does-not-untap` marker, which the untap step
 *    reads directly (`gre/phases.ts`). A filtered `untap-restriction` static
 *    would be the wrong encoding for a permanent talking about itself; the
 *    marker is what the hand-written catalogue writes (Island Fish Jasconius,
 *    Basalt Monolith).
 *
 * Nothing here allocates a target slot: a static ability targets nothing
 * (CR 115.1 — only spells and abilities that say "target" do), so there is no
 * `TargetSlots` walk and no one-target ceiling to pay.
 */

import type { CompiledStaticEffect } from "../cards/compiledStatics";
import type { StaticClauseIR } from "./grammar/shared/staticClause";

/** Where one lowered static clause lands. All fields are optional and merged. */
export interface LoweredStatic {
    readonly effect?: CompiledStaticEffect;
    /** CR 702.1 — a keyword this clause GRANTS, censused like a printed one. */
    readonly grantedKeyword?: {
        readonly ability: string;
        readonly implemented: boolean;
    };
    readonly entersTapped?: true;
    readonly entersWithCounters?: {
        readonly type: string;
        readonly count: number;
    };
    readonly staticAbility?: string;
}

export type LowerStaticResult =
    | { readonly ok: true; readonly lowered: LoweredStatic }
    | { readonly ok: false; readonly reason: string };

/**
 * CR 502.1 — the engine-internal marker for "doesn't untap during your untap
 * step", read by the untap step in `gre/phases.ts`. Named from the Mechanics
 * Registry row id (`ENGINE_INTERNAL_MARKERS`, `cards/mechanicsRegistry.ts`)
 * rather than spelled inline at the call site.
 */
const DOES_NOT_UNTAP_MARKER = "does-not-untap";

export function lowerStaticClause(clause: StaticClauseIR): LowerStaticResult {
    switch (clause.kind) {
        case "pt-buff":
            return {
                ok: true,
                lowered: {
                    effect: {
                        kind: "pt-buff",
                        filter: clause.filter,
                        power: clause.power,
                        toughness: clause.toughness,
                    },
                },
            };
        case "keyword-grant":
            return {
                ok: true,
                lowered: {
                    effect: {
                        kind: "keyword-grant",
                        filter: clause.filter,
                        keyword: clause.keyword.ability,
                    },
                    // A GRANTED keyword the engine does not implement ships a
                    // card whose whole behaviour is inert, exactly like a
                    // printed one (the Guard A shape, #962) — so it is
                    // censused on the same path, not trusted because the
                    // grant itself lowered cleanly.
                    grantedKeyword: {
                        ability: clause.keyword.ability,
                        implemented: clause.keyword.status === "implemented",
                    },
                },
            };
        case "cost-modifier":
            return {
                ok: true,
                lowered: {
                    effect: {
                        kind: "cost-modifier",
                        spells: clause.spells,
                        // CR 601.2f — a reduction only ever touches the generic
                        // portion of a cost, which is why both directions carry
                        // a bare number and the descriptor turns it into mana.
                        ...(clause.direction === "more"
                            ? { increase: clause.amount }
                            : { reduction: clause.amount }),
                    },
                },
            };
        case "enters-tapped":
            return {
                ok: true,
                lowered: {
                    entersTapped: true,
                    ...(clause.counters !== undefined
                        ? { entersWithCounters: clause.counters }
                        : {}),
                },
            };
        case "does-not-untap":
            return {
                ok: true,
                lowered: { staticAbility: DOES_NOT_UNTAP_MARKER },
            };
        default: {
            const never: never = clause;
            return {
                ok: false,
                reason: `no lowering for static clause ${JSON.stringify(never)}`,
            };
        }
    }
}
