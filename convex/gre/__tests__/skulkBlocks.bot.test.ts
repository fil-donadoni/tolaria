// Bot reachability of skulk (CR 702.118b): the Bot's block declarations come from
// `enumerateMoves`, and its clock from `predictUnblockedDamage` /
// `predictCombatOutcome`, so both follow the evasion rule on EFFECTIVE power.

import { beforeAll, describe, expect, it } from "vitest";
import { predictCombatOutcome, predictUnblockedDamage } from "../dangerClock";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";

const body = (slug: string, power: number): CardDefinition => ({
    id: `test-skulk-bot-${slug}`,
    name: `Test Skulk Bot ${slug}`,
    rarity: "common",
    manaCost: { generic: 1, B: 1 },
    types: ["Creature"],
    power,
    toughness: 1,
});

const SKULKER: CardDefinition = {
    ...body("skulker", 2),
    staticAbilities: ["skulk"],
};
const TWO = body("two", 2);
const THREE = body("three", 3);

beforeAll(() => preloadDefinitions([SKULKER, TWO, THREE]));

/** `a` (with `attackerCounters` +1/+1 counters) attacks `opp`, who holds `x`. */
function combatState(
    blocker: CardDefinition,
    attackerCounters = 0
): ReturnType<typeof makeState> {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "me",
        priorityPlayerId: "opp",
        players: [
            makePlayer("me", {
                battlefield: [
                    makeInstance(SKULKER.id, {
                        id: "a",
                        controllerId: "me",
                        ownerId: "me",
                        isSummoningSick: false,
                        ...(attackerCounters > 0
                            ? { counters: { "+1/+1": attackerCounters } }
                            : {}),
                    }),
                ],
            }),
            makePlayer("opp", {
                battlefield: [
                    makeInstance(blocker.id, {
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
}

const blockedSomething = (state: ReturnType<typeof makeState>) =>
    enumerateMoves(state, "opp").some(
        (m) => m.kind === "declare-blockers" && m.assignments.length > 0
    );

describe("the Bot's block moves against skulk (CR 702.118b)", () => {
    it("offers no block for a creature with greater power", () => {
        expect(blockedSomething(combatState(THREE))).toBe(false);
    });

    it("offers the block for a creature with equal power", () => {
        expect(blockedSomething(combatState(TWO))).toBe(true);
    });

    it("offers the block once the attacker's effective power catches up", () => {
        expect(blockedSomething(combatState(THREE, 1))).toBe(true);
    });
});

describe("the Bot's clock against skulk (CR 702.118b)", () => {
    it("the unblocked prediction counts a skulker no greater-power body can stop", () => {
        expect(predictUnblockedDamage(combatState(THREE), "me", "opp")).toBe(2);
        expect(predictUnblockedDamage(combatState(TWO), "me", "opp")).toBe(0);
    });

    it("the unblocked prediction reads the skulker's EFFECTIVE power", () => {
        expect(predictUnblockedDamage(combatState(THREE, 1), "me", "opp")).toBe(
            0
        );
    });

    it("the combat prediction lets the skulker through a greater-power body", () => {
        expect(
            predictCombatOutcome(combatState(THREE), "me", "opp").faceDamage
        ).toBe(2);
        expect(
            predictCombatOutcome(combatState(THREE, 1), "me", "opp").faceDamage
        ).toBe(0);
    });
});
