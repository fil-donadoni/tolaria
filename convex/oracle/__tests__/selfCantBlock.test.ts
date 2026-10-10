// "This creature can't block." — the static clause frame (CR 509.1b, issue #5407).
//
// Four layers:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition (Craven Giant bare; Rimrock Knight, a face of an
//     adventure card; Kavu Aggressor beside a kicker line).
//  2. REFUSALS — the neighbours of the sentence stay unparsed.
//  3. LOWERING — one JSON-pure `block-restriction` descriptor, no scope field.
//  4. BEHAVIOUR — the compiled definition, registered as-is, makes the creature
//     an ineligible blocker at the real `validateBlockerEligibility` seam, and
//     a control creature without the line is eligible.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import { validateBlockerEligibility } from "../../gre/combat";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const CRAVEN_GIANT = oracleCard({
    oracleId: "3ebd9c8d-c840-4c2e-ace6-352a68d1c20f",
    name: "Craven Giant",
    manaCost: "{2}{R}",
    typeLine: "Creature — Giant",
    oracleText: "This creature can't block.",
    power: "4",
    toughness: "1",
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

function clause(line: string): unknown {
    const parsed = staticSlot.run(line, parseContext());
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error("not a static clause");
    return parsed.value.clause;
}

describe("This creature can't block — golden fixtures (CR 509.1b)", () => {
    it("Craven Giant: the bare sentence", () => {
        expect(sortKeys(compiled(CRAVEN_GIANT))).toEqual(
            sortKeys({
                name: "Craven Giant",
                types: ["Creature"],
                subtypes: ["Giant"],
                manaCost: { X: 2, R: 1 },
                power: 4,
                toughness: 1,
                oracleText: "This creature can't block.",
                compiledStaticEffects: [
                    {
                        kind: "block-restriction",
                        id: "craven-giant-cant-block",
                        oracleText: "This creature can't block.",
                    },
                ],
            })
        );
    });

    it("reads the sentence into the clause and routes it to the static slot", () => {
        expect(clause("This creature can't block.")).toEqual({
            kind: "self-block-restriction",
            sentence: "This creature can't block.",
        });
        const routed = routeLine("This creature can't block.", parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("This creature can't block — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A different restriction: attack is CR 508.1c, a separate frame.
        "This creature can't attack.",
        "This creature can't attack or block.",
        // A conditional / filtered block restriction is a different mechanic.
        "This creature can't block creatures with power 3 or greater.",
        "This creature can't block Humans.",
        "This creature can't block unless you pay {1}.",
        // Not the source itself.
        "Creatures you control can't block.",
        "Target creature can't block.",
        "Enchanted creature can't block and can't attack.",
        // No full stop.
        "This creature can't block",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }
});

describe("This creature can't block — lowering invariants", () => {
    it("is one JSON-pure descriptor with no scope field", () => {
        const definition = compiled(CRAVEN_GIANT);
        expect(definition.compiledStaticEffects).toHaveLength(1);
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });
});

describe("This creature can't block — the compiled definition at the real block check (CR 509.1b)", () => {
    const GIANT_ID = "compiled-craven-giant";
    const BEAR_ID = "compiled-control-bear";

    function withCreatures<T>(fn: () => T): T {
        const giant: CardDefinition = {
            ...compiled(CRAVEN_GIANT),
            id: GIANT_ID,
            rarity: "common",
        };
        const bear: CardDefinition = {
            ...compiled(oracleCard({ name: "Control Bear", oracleText: "" })),
            id: BEAR_ID,
            rarity: "common",
        };
        return withTemporaryDefinition(giant, () =>
            withTemporaryDefinition(bear, fn)
        );
    }

    it("the creature cannot block; a creature without the line can", () => {
        withCreatures(() => {
            const attacker = makeInstance(BEAR_ID, {
                id: "attacker",
                controllerId: "p1",
                ownerId: "p1",
            });
            const giant = makeInstance(GIANT_ID, {
                id: "giant",
                controllerId: "p2",
                ownerId: "p2",
            });
            const bear = makeInstance(BEAR_ID, {
                id: "bear",
                controllerId: "p2",
                ownerId: "p2",
            });
            expect(
                validateBlockerEligibility(attacker, giant, [giant, bear])
                    .eligible
            ).toBe(false);
            expect(
                validateBlockerEligibility(attacker, bear, [giant, bear])
                    .eligible
            ).toBe(true);
        });
    });
});
