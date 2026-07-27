// MOC white — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Guardian Scalelord composes `backupTrigger` (already proven by Consuming
// Aetherborn, `mom/black.ts`, and Death-Greeter's Champion, `moc/red.ts`)
// plus the ALREADY-EXERCISED `moveZone` target-shape Op (Raise Dead-style
// reanimation, e.g. `ulg/black.ts`). This file pins the CARD's own new
// combination: a graveyard-zone `targetRequirement` restricted to a POSITIVE
// nonland-permanent type list AND the NEW `mvFilter.max: "sourcePower"`
// dynamic cap (issue #1378) — proving the requirement embedded on the real
// card definition (not a hand-rolled copy) offers/excludes the right
// graveyard cards at a given source power, and that the cap tracks a power
// change.

import { describe, it, expect } from "vitest";
import { guardianScalelord } from "../white";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalTargets } from "../../../../gre/rules";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";

const ATTACK_TRIGGER = guardianScalelord.triggeredAbilities!.find(
    (a) => a.id === "guardian-scalelord-attack"
)!;

function attackersDeclaredState(
    sourceOverrides: Partial<CardInstanceState> = {}
) {
    const grizzlyBears = getCardByName("Grizzly Bears"); // {1}{G}, mv 2
    const crawWurm = getCardByName("Craw Wurm"); // {4}{G}{G}, mv 6
    const island = getCardByName("Island");

    const source = makeInstance(guardianScalelord.id, {
        id: "scalelord",
        controllerId: "p1",
        ownerId: "p1",
        power: 3,
        ...sourceOverrides,
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "gy-bear",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const wurm = makeInstance(crawWurm.id, {
        id: "gy-wurm",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const land = makeInstance(island.id, {
        id: "gy-island",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source],
                graveyard: [bear, wurm, land],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, source, bear, wurm, land };
}

describe("Guardian Scalelord (Backup 1 + Flying + dynamic power-capped reanimation, CR 702.165/613/603.3d, issue #1378)", () => {
    it("is a {4}{W} 3/4 Creature — Dragon with Backup 1 and Flying, and exactly two triggered abilities", () => {
        expect(guardianScalelord.manaCost).toEqual({ X: 4, W: 1 });
        expect(guardianScalelord.power).toBe(3);
        expect(guardianScalelord.toughness).toBe(4);
        expect(guardianScalelord.staticAbilities).toEqual([
            "backup 1",
            "flying",
        ]);
        expect(guardianScalelord.triggeredAbilities).toHaveLength(2);
        expect(guardianScalelord.triggeredAbilities!.map((a) => a.id)).toEqual([
            "backup-1",
            "guardian-scalelord-attack",
        ]);
    });

    it("attack trigger's targetRequirement: nonland permanent card, mana value at most the source's power", () => {
        expect(ATTACK_TRIGGER.event).toBe("ATTACKERS_DECLARED");
        expect(ATTACK_TRIGGER.targetRequirement?.zone).toBe("graveyard");
        expect(ATTACK_TRIGGER.targetRequirement?.controller).toBe("you");
        expect(ATTACK_TRIGGER.targetRequirement?.type).not.toContain("Land");
        expect(ATTACK_TRIGGER.targetRequirement?.mvFilter).toEqual({
            max: "sourcePower",
        });
    });

    it("legal targets at power 3: the mv-2 creature qualifies, the mv-6 creature and the land do not", () => {
        const { state } = attackersDeclaredState({ power: 3 });
        const legal = getLegalTargets(
            state,
            ATTACK_TRIGGER.targetRequirement!,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            3 // sourcePower — Guardian Scalelord's own power
        );
        expect(legal).toEqual([
            { type: "graveyard-card", id: "gy-bear", playerId: "p1" },
        ]);
    });

    it("the cap TRACKS a power change: at power 6, the mv-6 creature is also legal, the land still is not", () => {
        const { state } = attackersDeclaredState({ power: 3 });
        const legal = getLegalTargets(
            state,
            ATTACK_TRIGGER.targetRequirement!,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            6 // buffed sourcePower
        );
        expect(legal).toHaveLength(2);
        expect(legal).toEqual(
            expect.arrayContaining([
                { type: "graveyard-card", id: "gy-bear", playerId: "p1" },
                { type: "graveyard-card", id: "gy-wurm", playerId: "p1" },
            ])
        );
        expect(legal.some((t) => t.id === "gy-island")).toBe(false);
    });

    it("resolving the attack trigger reanimates the chosen graveyard card to the battlefield under its owner's control", () => {
        const { state, source, bear } = attackersDeclaredState({ power: 3 });
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "guardian-scalelord-attack",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: [source.id],
            } as StackItem["triggerEvent"],
            targets: [{ type: "graveyard-card", id: bear.id, playerId: "p1" }],
        });
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === bear.id)).toBe(false);
        const reanimated = p1.battlefield.find((c) => c.id === bear.id);
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
    });
});
