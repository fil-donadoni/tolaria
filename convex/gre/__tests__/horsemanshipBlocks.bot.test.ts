// Bot reachability of horsemanship (CR 702.31b): the Bot's block declarations
// come from `enumerateMoves`, so what it may offer follows the evasion rule.

import { beforeAll, describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";

const RIDER: CardDefinition = {
    id: "test-horsemanship-bot-rider",
    name: "Test Horsemanship Bot Rider",
    rarity: "common",
    manaCost: { generic: 1, R: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticAbilities: ["horsemanship"],
};

beforeAll(() => preloadDefinitions([RIDER]));

/** The assignments the Bot on `opp` may declare, `blockerDefId` against `a`. */
function blockDeclarations(attackerDefId: string, blockerDefId: string) {
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "me",
        priorityPlayerId: "opp",
        players: [
            makePlayer("me", {
                battlefield: [
                    makeInstance(attackerDefId, {
                        id: "a",
                        controllerId: "me",
                        ownerId: "me",
                        isSummoningSick: false,
                    }),
                ],
            }),
            makePlayer("opp", {
                battlefield: [
                    makeInstance(blockerDefId, {
                        id: "x",
                        controllerId: "opp",
                        ownerId: "opp",
                        isSummoningSick: false,
                    }),
                ],
            }),
        ],
        combat: {
            attackerIds: ["a"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return enumerateMoves(state, "opp").flatMap((m) =>
        m.kind === "declare-blockers" ? [m.assignments] : []
    );
}

const blockedSomething = (declarations: unknown[][]) =>
    declarations.some((assignments) => assignments.length > 0);

describe("the Bot's block moves against horsemanship (CR 702.31b)", () => {
    it("offers no block for a creature without it", () => {
        const declarations = blockDeclarations(RIDER.id, grizzlyBears().id);
        expect(declarations.length).toBeGreaterThan(0);
        expect(blockedSomething(declarations)).toBe(false);
    });

    it("offers the block for a creature with it", () => {
        expect(blockedSomething(blockDeclarations(RIDER.id, RIDER.id))).toBe(
            true
        );
    });

    it("offers a creature with it the block on a plain attacker", () => {
        expect(
            blockedSomething(blockDeclarations(grizzlyBears().id, RIDER.id))
        ).toBe(true);
    });
});
