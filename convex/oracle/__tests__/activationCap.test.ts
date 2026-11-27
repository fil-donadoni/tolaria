// The per-turn activation cap — "Activate no more than twice each turn."
// (CR 602.5b), an activated-ability restriction sentence lowered onto
// `ActivatedAbility.maxActivationsPerTurn`.
//
//  1. GOLDEN — Pit Imp compiled whole.
//  2. REFUSALS — the neighbouring caps and windows stay unparsed.
//  3. BEHAVIOUR — the compiled ability, registered as-is, is gated by the one
//     authority (`activationPreconditionViolation`) on the source's tally.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { activationPreconditionViolation } from "../../gre/activationPrecondition";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const PUMP_LINE =
    "{B}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn.";

const PIT_IMP = oracleCard({
    oracleId: "3decbc45-3e79-455f-9d62-878ee31b458d",
    name: "Pit Imp",
    manaCost: "{B}",
    typeLine: "Creature — Imp",
    oracleText: `Flying\n${PUMP_LINE}`,
    power: "0",
    toughness: "1",
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

function refused(line: string) {
    return compileCard(oracleCard({ name: "Probe Imp", oracleText: line }))
        .state;
}

describe("activation cap — golden fixture (CR 602.5b)", () => {
    it("Pit Imp: a pump capped at two activations each turn", () => {
        expect(sortKeys(compiled(PIT_IMP))).toEqual(
            sortKeys({
                name: "Pit Imp",
                types: ["Creature"],
                subtypes: ["Imp"],
                manaCost: { B: 1 },
                power: 0,
                toughness: 1,
                oracleText: `Flying\n${PUMP_LINE}`,
                staticAbilities: ["flying"],
                activatedAbilities: [
                    {
                        id: "pit-imp-ability",
                        oracleText: PUMP_LINE,
                        cost: { mana: { B: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$source" },
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        maxActivationsPerTurn: 2,
                    },
                ],
            })
        );
    });
});

describe("activation cap — refusals (fail-closed)", () => {
    it.each([
        // another count stays under its own key
        "{B}: This creature gets +1/+0 until end of turn. Activate no more than three times each turn.",
        // another window
        "{B}: This creature gets +1/+0 until end of turn. Activate no more than twice each combat.",
        // a cap joined to a second restriction has no "activate only" head
        "{B}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn and only as a sorcery.",
    ])("refuses %s", (line) => {
        expect(refused(line)).toBe("unparsed");
    });
});

describe("activation cap — the activation gate (CR 602.5b)", () => {
    const IMP_ID = "4585bbbb-1111-4111-8111-111111111111";
    const imp = (): CardDefinition =>
        expandDefinition({
            ...compiled(PIT_IMP),
            id: IMP_ID,
            rarity: "common",
        });

    function violation(used: number): string | null {
        return withTemporaryDefinition(imp(), () => {
            const def = imp();
            const ability = def.activatedAbilities![0]!;
            const source = makeInstance(IMP_ID, {
                id: "imp",
                controllerId: "p1",
                ownerId: "p1",
                ...(used > 0
                    ? { activationsThisTurn: { [ability.id]: used } }
                    : {}),
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [source] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            return activationPreconditionViolation(state, source, ability);
        });
    }

    it("admits the first and second activation of the turn", () => {
        expect(violation(0)).toBeNull();
        expect(violation(1)).toBeNull();
    });

    it("refuses the third", () => {
        expect(violation(2)).toBe("Activate no more than 2 times each turn");
    });
});
