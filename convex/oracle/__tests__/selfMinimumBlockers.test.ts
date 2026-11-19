// "This creature can't be blocked except by three or more creatures." — the
// minimum-blockers evasion frame (CR 509.1b, issue #9937).
//
// Four layers:
//
//  1. GOLDEN fixtures — real Oracle cards compiled whole must produce exactly
//     these Compiled Definitions (Rampaging Ceratops; Phyrexian Colossus,
//     where the marker sits beside the `does-not-untap` one).
//  2. REFUSALS — the neighbours of the sentence stay unparsed.
//  3. LOWERING — the existing `minimum-blockers:N` marker, no new static kind.
//  4. BEHAVIOUR — the compiled definition, registered as-is, raises the
//     attacker's minimum-blocker threshold at the real `getMinimumBlockers`
//     seam the block-confirm check and the Bot's block enumerator read.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import { getMinimumBlockers } from "../../gre/combat";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE =
    "This creature can't be blocked except by three or more creatures.";

const RAMPAGING_CERATOPS = oracleCard({
    oracleId: "91d01119-9b3e-4629-8cf0-bbca2c19a7cc",
    name: "Rampaging Ceratops",
    manaCost: "{4}{R}",
    typeLine: "Creature — Dinosaur",
    oracleText: LINE,
    power: "5",
    toughness: "4",
});

const PHYREXIAN_COLOSSUS = oracleCard({
    oracleId: "caab555c-7852-418a-bdc3-f908af7e0932",
    name: "Phyrexian Colossus",
    manaCost: "{7}",
    typeLine: "Artifact Creature — Phyrexian Golem",
    oracleText: `This creature doesn't untap during your untap step.\nPay 8 life: Untap this creature.\n${LINE}`,
    power: "8",
    toughness: "8",
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

describe("can't be blocked except by N or more creatures — golden fixtures (CR 509.1b)", () => {
    it("Rampaging Ceratops: the bare sentence", () => {
        expect(sortKeys(compiled(RAMPAGING_CERATOPS))).toEqual(
            sortKeys({
                name: "Rampaging Ceratops",
                types: ["Creature"],
                subtypes: ["Dinosaur"],
                manaCost: { X: 4, R: 1 },
                power: 5,
                toughness: 4,
                oracleText: LINE,
                staticAbilities: ["minimum-blockers:3"],
            })
        );
    });

    it("Phyrexian Colossus: the marker beside does-not-untap and an untap ability", () => {
        expect(sortKeys(compiled(PHYREXIAN_COLOSSUS))).toEqual(
            sortKeys({
                name: "Phyrexian Colossus",
                types: ["Artifact", "Creature"],
                subtypes: ["Phyrexian", "Golem"],
                manaCost: { X: 7 },
                power: 8,
                toughness: 8,
                oracleText: PHYREXIAN_COLOSSUS.oracleText,
                staticAbilities: ["does-not-untap", "minimum-blockers:3"],
                activatedAbilities: [
                    {
                        id: "phyrexian-colossus-ability",
                        oracleText: "Pay 8 life: Untap this creature.",
                        cost: { life: 8 },
                        useStack: true,
                        effects: [
                            {
                                op: "tapUntap",
                                action: "untap",
                                target: { ref: "$source" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("reads the sentence into the clause and routes it to the static slot", () => {
        expect(clause(LINE)).toEqual({ kind: "minimum-blockers", count: 3 });
        const routed = routeLine(LINE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("can't be blocked except by N or more creatures — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A filtered rider is a different restriction (CR 509.1b + a filter).
        "This creature can't be blocked except by three or more creatures with flying.",
        "This creature can't be blocked except by two or more creatures and/or Walls.",
        // A filtered blocker set, not a count.
        "This creature can't be blocked except by creatures with flying.",
        "This creature can't be blocked except by Walls.",
        // A grant to other creatures is a different slot shape (issue #9937
        // "Out of this ticket").
        "Each creature you control with menace can't be blocked except by three or more creatures.",
        "Creatures you control can't be blocked except by three or more creatures.",
        "Enchanted creature can't be blocked except by three or more creatures.",
        // One blocker is no restriction; a digit is not how Oracle prints it.
        "This creature can't be blocked except by one or more creatures.",
        "This creature can't be blocked except by 3 or more creatures.",
        // Not a number word.
        "This creature can't be blocked except by many or more creatures.",
        // No full stop.
        "This creature can't be blocked except by three or more creatures",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }
});

describe("can't be blocked except by N or more creatures — lowering invariants", () => {
    it("lowers to the existing marker only: no compiled static effect", () => {
        const definition = compiled(RAMPAGING_CERATOPS);
        expect(definition.staticAbilities).toEqual(["minimum-blockers:3"]);
        expect(definition.compiledStaticEffects).toBeUndefined();
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });
});

describe("can't be blocked except by N or more creatures — the compiled definition at the real threshold seam (CR 509.1b)", () => {
    it("the compiled attacker needs three blockers; a vanilla attacker needs one", () => {
        const CERATOPS_ID = "compiled-rampaging-ceratops";
        const BEAR_ID = "compiled-minimum-blockers-bear";
        const ceratops: CardDefinition = {
            ...compiled(RAMPAGING_CERATOPS),
            id: CERATOPS_ID,
            rarity: "uncommon",
        };
        const bear: CardDefinition = {
            ...compiled(oracleCard({ name: "Control Bear", oracleText: "" })),
            id: BEAR_ID,
            rarity: "common",
        };
        withTemporaryDefinition(ceratops, () =>
            withTemporaryDefinition(bear, () => {
                const attacker = makeInstance(CERATOPS_ID, {
                    id: "ceratops",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const control = makeInstance(BEAR_ID, {
                    id: "bear",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                expect(getMinimumBlockers(attacker)).toBe(3);
                expect(getMinimumBlockers(control)).toBe(1);
            })
        );
    });
});
