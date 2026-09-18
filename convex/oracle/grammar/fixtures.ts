/**
 * Golden fixtures — the evidence a Grammar Rule carries for the forms it
 * accepts (ADR 0137, ADR 0105 § 7.1).
 *
 * A fixture is a real corpus card's Oracle row and the Compiled Definition the
 * rule must produce for it. `__tests__/goldenFixtures.test.ts` compiles every
 * fixture and requires the output to equal `expected`, so a fixture is never a
 * declaration: one that stops matching the compiler is a red test, not a stale
 * claim.
 *
 * What a fixture BUYS is computed, never written down: the quarantine gate
 * (`gates.ts` — `fixtureForms`) runs the same smoke planner over `expected`,
 * and every card-dependent skip form it finds there is a form the grammar has
 * proven it emits correctly. A corpus card whose only smoke skips are such
 * forms reaches `ready` — no field here names a card, a form, or a state.
 *
 * The first fixture arrived with the kicker rule (issue #3826); a
 * card-dependent skip with no fixture exhibiting its form still quarantines,
 * exactly as every smoke skip did before this registry existed.
 */

import type { CompiledDefinition, OracleCard } from "../types";

export interface GoldenFixture {
    /** The `label` of the Grammar Rule that accepts the form. */
    readonly rule: string;
    /** A real corpus card whose Oracle text exhibits the form. */
    readonly card: OracleCard;
    /** The Compiled Definition the rule must produce for `card` — the gold. */
    readonly expected: CompiledDefinition;
}

// Frozen: `fixtureForms` caches by array identity, so the registry may never
// change in place.
export const GOLDEN_FIXTURES: readonly GoldenFixture[] = Object.freeze([
    // CR 702.33d — "If this spell was kicked, <effect>" gates the effect on
    // the spell's kicker tally. Exhibits the "reads the spell's kicker count"
    // form: the canned smoke scenario casts unkicked, so this fixture is the
    // evidence that the gate the grammar emits is the one the hand-written
    // catalogue writes (Dismantling Blow also round-trips, Guard C).
    {
        rule: "kicker",
        card: {
            oracleId: "300cba5a-adbb-4852-be06-ac00d9d6fd37",
            name: "Dismantling Blow",
            manaCost: "{2}{W}",
            typeLine: "Instant",
            oracleText:
                "Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards.",
            layout: "normal",
        },
        expected: {
            name: "Dismantling Blow",
            types: ["Instant"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards.",
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {2}{U}",
                    mana: { X: 2, U: 1 },
                },
            ],
            effects: [
                { op: "destroy", target: { target: 0 } },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "draw", player: "controller", count: 2 }],
                },
            ],
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
        },
    },
]);
