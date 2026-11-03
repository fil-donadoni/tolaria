// "This creature can block only creatures with flying." — the static clause
// frame (CR 509.1b, issue #3315).
//
// Four layers:
//
//  1. GOLDEN fixture — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition (Welkin Tern), JSON-pure.
//  2. REFUSALS — the neighbours of the sentence stay unparsed; a form the
//     closed `CombatCounterpartFilter` vocabulary cannot state leaves its card
//     unparsed and names the fragment (Air Bladder).
//  3. ROUND TRIP — Brazen Borrower, hand-written with the same descriptor,
//     compares EQUAL through the gold harness (data, not `incomparable`).
//  4. BEHAVIOUR — at the real `validateBlockerEligibility` seam, the compiled
//     descriptor and a closure stating the same rule give the same verdict for
//     every attacker: a flier is blockable, a ground creature is not, and a
//     flier by GRANT (live `staticAbilities`) counts.

import { describe, expect, it } from "vitest";
import { getDefinition, withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import { validateBlockerEligibility } from "../../gre/combat";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE = "This creature can block only creatures with flying.";

const WELKIN_TERN = oracleCard({
    oracleId: "010c660a-a67b-48f0-a63a-15470eb89f69",
    name: "Welkin Tern",
    manaCost: "{1}{U}",
    typeLine: "Creature — Bird",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nThis creature can block only creatures with flying.",
    power: "2",
    toughness: "1",
});

function compiled(card: ReturnType<typeof oracleCard>): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition as CardDefinition;
}

describe("can block only creatures with flying — golden fixture (CR 509.1b)", () => {
    it("Welkin Tern: the whole compiled definition", () => {
        expect(sortKeys(compiled(WELKIN_TERN))).toEqual(
            sortKeys({
                name: "Welkin Tern",
                types: ["Creature"],
                subtypes: ["Bird"],
                manaCost: { X: 1, U: 1 },
                power: 2,
                toughness: 1,
                oracleText:
                    "Flying (This creature can't be blocked except by creatures with flying or reach.)\nThis creature can block only creatures with flying.",
                staticAbilities: ["flying"],
                compiledStaticEffects: [
                    {
                        kind: "block-restriction",
                        id: "welkin-tern-blocks-only-flying",
                        oracleText: LINE,
                        onlyAgainst: { keyword: "flying" },
                    },
                ],
            })
        );
    });

    it("is JSON-pure: the compiled row survives serialization unchanged", () => {
        const definition = compiled(WELKIN_TERN);
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });

    it("reads the sentence into the clause and routes it to the static slot", () => {
        const parsed = staticSlot.run(LINE, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "self-block-restriction",
                sentence: LINE,
                onlyAgainst: { keyword: "flying" },
            });
        const routed = routeLine(LINE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("can block only creatures with flying — refusals (fail-closed)", () => {
    const refused = [
        // Not the source itself: a set (CR 509.1b over many creatures).
        "Creatures with flying can block only creatures with flying.",
        // A counterpart the closed vocabulary cannot state.
        "This creature can block only creatures with reach.",
        "This creature can block only creatures with power 3 or greater.",
        "This creature can block only creatures with flying or reach.",
        // A token's quoted ability is not this slot's sentence.
        "This token can block only creatures with flying",
        // No full stop.
        "This creature can block only creatures with flying",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }

    it("Air Bladder: the Aura form leaves the card unparsed, naming the fragment", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "25c8a3b0-c393-4fc6-a373-808cd8e9850c",
                name: "Air Bladder",
                manaCost: "{U}",
                typeLine: "Enchantment — Aura",
                oracleText:
                    "Enchant creature\nEnchanted creature has flying.\nEnchanted creature can block only creatures with flying.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.fragment)).toContain(
            "Enchanted creature can block only creatures with flying."
        );
    });
});

describe("can block only creatures with flying — Guard C compares data", () => {
    it("Brazen Borrower round-trips EQUAL, not incomparable", () => {
        const definition = getDefinition(
            "c2089ec9-0665-448f-bfe9-d181de127814"
        );
        expect(roundTripCard(definition).verdict).toEqual({
            ok: true,
            kind: "equal",
        });
    });
});

describe("can block only creatures with flying — the real block check (CR 509.1b)", () => {
    const TERN_ID = "compiled-welkin-tern";
    const CLOSURE_ID = "closure-blocks-only-flyers";
    const BIRD_ID = "control-bird";
    const BEAR_ID = "control-bear";

    function withCreatures<T>(fn: () => T): T {
        const tern: CardDefinition = {
            ...compiled(WELKIN_TERN),
            id: TERN_ID,
            rarity: "common",
        };
        // The closure way of stating the same rule — the encoding every
        // hand-written restriction used before the descriptor existed.
        const closure: CardDefinition = {
            ...compiled(
                oracleCard({ name: "Closure Tern", oracleText: "Flying" })
            ),
            id: CLOSURE_ID,
            rarity: "common",
            staticEffects: [
                {
                    kind: "block-restriction",
                    id: "closure-blocks-only-flying",
                    side: "blocker",
                    predicate: (_self, attacker) =>
                        (
                            (attacker as { staticAbilities?: string[] })
                                .staticAbilities ?? []
                        ).includes("flying"),
                    oracleText: LINE,
                },
            ],
        };
        const bird: CardDefinition = {
            ...compiled(
                oracleCard({ name: "Control Bird", oracleText: "Flying" })
            ),
            id: BIRD_ID,
            rarity: "common",
        };
        const bear: CardDefinition = {
            ...compiled(oracleCard({ name: "Control Bear", oracleText: "" })),
            id: BEAR_ID,
            rarity: "common",
        };
        return withTemporaryDefinition(tern, () =>
            withTemporaryDefinition(closure, () =>
                withTemporaryDefinition(bird, () =>
                    withTemporaryDefinition(bear, fn)
                )
            )
        );
    }

    function canBlock(blockerId: string, attackerId: string, grant = false) {
        const attacker = makeInstance(attackerId, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
            ...(grant ? { staticAbilities: ["flying"] } : {}),
        });
        const blocker = makeInstance(blockerId, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        return validateBlockerEligibility(attacker, blocker, [blocker])
            .eligible;
    }

    it("the compiled descriptor blocks a flier and refuses a ground creature", () => {
        withCreatures(() => {
            expect(canBlock(TERN_ID, BIRD_ID)).toBe(true);
            expect(canBlock(TERN_ID, BEAR_ID)).toBe(false);
            // CR 613.1f — flying by grant lives on the live staticAbilities.
            expect(canBlock(TERN_ID, BEAR_ID, true)).toBe(true);
        });
    });

    it("the descriptor and the closure give the same verdict for every attacker", () => {
        withCreatures(() => {
            for (const [attacker, grant] of [
                [BIRD_ID, false],
                [BEAR_ID, false],
                [BEAR_ID, true],
            ] as const) {
                expect(canBlock(TERN_ID, attacker, grant)).toBe(
                    canBlock(CLOSURE_ID, attacker, grant)
                );
            }
        });
    });
});
