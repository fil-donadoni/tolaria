// "This creature can't attack unless you control more creatures than defending
// player." — the static clause frame (CR 508.1c).
//
// Four layers: GOLDEN fixture (Goblin Goon), REFUSALS (neighbours stay
// unparsed), LOWERING (JSON-pure descriptor), BEHAVIOUR (the compiled
// definition at the real `validateAttackerEligibility` seam).

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { makeInstance, makeState } from "../../cards/__tests__/setup.helper";
import { validateAttackerEligibility } from "../../gre/combat";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE =
    "This creature can't attack unless you control more creatures than defending player.";

const GOBLIN_GOON = oracleCard({
    oracleId: "e91bcf01-113b-4532-9f78-2a155b17be4f",
    name: "Goblin Goon",
    manaCost: "{3}{R}",
    typeLine: "Creature — Goblin Mutant",
    oracleText: LINE,
    power: "6",
    toughness: "6",
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("This creature can't attack unless you control more creatures than defending player — golden (CR 508.1c)", () => {
    it("Goblin Goon: the whole definition", () => {
        expect(sortKeys(compiled(GOBLIN_GOON))).toEqual(
            sortKeys({
                name: "Goblin Goon",
                types: ["Creature"],
                subtypes: ["Goblin", "Mutant"],
                manaCost: { X: 3, R: 1 },
                power: 6,
                toughness: 6,
                oracleText: LINE,
                compiledStaticEffects: [
                    {
                        kind: "attack-restriction",
                        id: "goblin-goon-cant-attack",
                        oracleText: LINE,
                        unless: "more-creatures-than-defender",
                    },
                ],
            })
        );
    });

    it("reads the sentence into the clause and routes it to the static slot", () => {
        const parsed = staticSlot.run(LINE, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "self-attack-restriction",
                unless: "more-creatures-than-defender",
                sentence: LINE,
            });
        const routed = routeLine(LINE, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("This creature can't attack unless … — refusals (fail-closed neighbours)", () => {
    const refused = [
        "This creature can't attack unless you control fewer creatures than defending player.",
        "This creature can't attack unless you control more lands than defending player.",
        "This creature can't attack unless defending player controls an Island.",
        "This creature can't attack unless you control more creatures than defending player",
        "Creatures you control can't attack unless you control more creatures than defending player.",
        "Target creature can't attack unless you control more creatures than defending player.",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }
});

describe("This creature can't attack unless … — lowering invariants", () => {
    it("is one JSON-pure descriptor", () => {
        const definition = compiled(GOBLIN_GOON);
        expect(definition.compiledStaticEffects).toHaveLength(1);
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });
});

describe("This creature can't attack unless … — at the real attack check (CR 508.1c)", () => {
    const GOON_ID = "compiled-goblin-goon";
    const BEAR_ID = "compiled-control-bear";

    function check(ownCreatures: number, defenderCreatures: number): boolean {
        const goon: CardDefinition = {
            ...compiled(GOBLIN_GOON),
            id: GOON_ID,
            rarity: "common",
        };
        const bear: CardDefinition = {
            ...compiled(oracleCard({ name: "Control Bear", oracleText: "" })),
            id: BEAR_ID,
            rarity: "common",
        };
        return withTemporaryDefinition(goon, () =>
            withTemporaryDefinition(bear, () => {
                const attacker = makeInstance(GOON_ID, {
                    id: "goon",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const mine = [attacker];
                for (let i = 1; i < ownCreatures; i++)
                    mine.push(
                        makeInstance(BEAR_ID, {
                            id: `mine-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    );
                const theirs = Array.from(
                    { length: defenderCreatures },
                    (_, i) =>
                        makeInstance(BEAR_ID, {
                            id: `theirs-${i}`,
                            controllerId: "p2",
                            ownerId: "p2",
                        })
                );
                const state = makeState({
                    players: [
                        { id: "p1", battlefield: mine },
                        { id: "p2", battlefield: theirs },
                    ],
                    activePlayerId: "p1",
                } as never);
                return validateAttackerEligibility(attacker, theirs, state)
                    .eligible;
            })
        );
    }

    it("cannot attack when the boards are equal or the defender has more", () => {
        expect(check(1, 1)).toBe(false);
        expect(check(2, 3)).toBe(false);
        expect(check(1, 0)).toBe(true);
    });

    it("can attack once its controller controls strictly more creatures", () => {
        expect(check(3, 2)).toBe(true);
    });
});
