// Castability gate vs. the cast announcement: every announced target group
// (CR 601.2c) must be fillable before `getLegalActions` offers `cast`, through
// the SAME predicate `announceCast` runs (`firstUnfillableCastGroup`).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { getLegalActions } from "../rules";
import { firstUnfillableCastGroup } from "../kicker";

const BEARS = getCardByName("Grizzly Bears").id;

const base: Pick<CardDefinition, "rarity" | "manaCost" | "types"> = {
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Instant"],
};

function castable(def: CardDefinition, creatures: number): boolean {
    const spell = makeInstance(def.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [spell] }),
            makePlayer("p2", {
                battlefield: Array.from({ length: creatures }, (_, i) =>
                    makeInstance(BEARS, { id: `bear-${i}`, controllerId: "p2" })
                ),
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.players[0].manaPool.R = 5;
    return getLegalActions(state, state.players[0], spell).includes("cast");
}

describe("cast gate reads every announced group (CR 601.2c)", () => {
    it("is not offered when an additional group has no legal candidate", () => {
        const def: CardDefinition = {
            ...base,
            id: "cast-gate-test:empty-later-group",
            name: "Gate Empty Later Group",
            targetRequirement: { type: "Creature", count: 1 },
            additionalTargetRequirements: [{ type: "Planeswalker", count: 1 }],
            effects: [],
        };
        withTemporaryDefinition(def, () => {
            expect(castable(def, 2)).toBe(false);
        });
    });

    it("'another target' (CR 115.3) needs distinct candidates: 1 creature no, 2 yes", () => {
        const def: CardDefinition = {
            ...base,
            id: "cast-gate-test:another-target",
            name: "Gate Another Target",
            targetRequirement: { type: "Creature", count: 1 },
            additionalTargetRequirements: [
                { type: "Creature", count: 1, excludePriorTargets: true },
            ],
            effects: [],
        };
        withTemporaryDefinition(def, () => {
            expect(castable(def, 1)).toBe(false);
            expect(castable(def, 2)).toBe(true);
        });
    });

    it("single-choice modal: castable only once some mode fills all its groups (CR 700.2a)", () => {
        const def: CardDefinition = {
            ...base,
            id: "cast-gate-test:modal",
            name: "Gate Modal",
            modes: [
                {
                    id: "needs-walker",
                    label: "Walker",
                    oracleText: "x",
                    targetRequirement: { type: "Creature", count: 1 },
                    additionalTargetRequirements: [
                        { type: "Planeswalker", count: 1 },
                    ],
                    effects: [],
                },
                {
                    id: "two-creatures",
                    label: "Two",
                    oracleText: "y",
                    targetRequirement: { type: "Creature", count: 1 },
                    additionalTargetRequirements: [
                        {
                            type: "Creature",
                            count: 1,
                            excludePriorTargets: true,
                        },
                    ],
                    effects: [],
                },
            ],
        };
        withTemporaryDefinition(def, () => {
            expect(castable(def, 1)).toBe(false);
            expect(castable(def, 2)).toBe(true);
        });
    });

    it("a kicker-gated group stays out of an unkicked cast (CR 702.33g)", () => {
        const def: CardDefinition = {
            ...base,
            id: "cast-gate-test:kicker-gated",
            name: "Gate Kicker Gated",
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {1}",
                    mana: { generic: 1 },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
            additionalTargetRequirements: [
                {
                    type: "Planeswalker",
                    count: 1,
                    announcedOnlyIfKicked: true,
                },
            ],
            effects: [],
        };
        withTemporaryDefinition(def, () => {
            expect(castable(def, 1)).toBe(true);
        });
    });

    it("the shared predicate reports the first short group", () => {
        const one = [{ id: "a" }];
        const groups = [
            { type: "Creature", count: 1 },
            { type: "Creature", count: 1, excludePriorTargets: true },
        ] as const;
        expect(
            firstUnfillableCastGroup(
                groups,
                () => one,
                () => 1
            )
        ).toEqual({ group: 1, kind: "short" });
    });
});
