// `cost.addCounter` — "Put a -1/-1 counter on this creature" as an ACTIVATION
// cost (CR 122.1 — counters are put on objects; CR 118.1 — a cost is an action
// necessary to take another action; CR 118.3 — a player can pay a cost only if
// able, and placing a counter needs nothing; CR 605.1a — a mana ability may
// carry such a cost; CR 704.5f — a creature with toughness 0 is put into its
// owner's graveyard; CR 704.5q — +1/+1 and -1/-1 counters annihilate).
//
// The leg is paid at every site that pays an activation cost: the inline
// commit (`activateAbilityOnState`), the deferred commit
// (`buildPendingActivation` + `tryAutoCommitPendingActivation`), the targeted
// commit (`finalizeTargetSelection`) and the tap-less mana ability
// (`activateManaAbility`, over the stub `MutationCtx`). Everything is driven
// through the real entry points; the projection is read through
// `projectPublicState`.

import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../cards";
import type { CardDefinition } from "../cards/types";
import {
    activateAbilityOnState,
    applyManaAbilityRemoveCounterCost,
    activateManaAbility,
    buildPendingActivation,
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
} from "../game";
import { getPlayer, resolveTopOfStack } from "../gre/state";
import { checkStateBasedActions } from "../gre/sba";
import { getEffectivePower, getEffectiveToughness } from "../gre/layers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const DRUID_ID = "00000000-0000-4000-8000-000064920001";
const DEFERRED_ID = "00000000-0000-4000-8000-000064920002";
const TARGETED_ID = "00000000-0000-4000-8000-000064920003";
const WALL_ID = "00000000-0000-4000-8000-000064920004";

preloadDefinitions([
    {
        // Devoted Druid's shape: the whole cost is the counter.
        id: DRUID_ID,
        name: "Synthetic Counter Payer",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        subtypes: ["Elf"],
        power: 0,
        toughness: 2,
        activatedAbilities: [
            {
                id: "counter-gain",
                oracleText:
                    "Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: { addCounter: { type: "-1/-1", count: 1 } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The DEFERRED commit: a mana component forces the payment phase.
        id: DEFERRED_ID,
        name: "Synthetic Deferred Counter Payer",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        power: 1,
        toughness: 3,
        activatedAbilities: [
            {
                id: "deferred-counter-gain",
                oracleText:
                    "{1}, Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: {
                    mana: { generic: 1 },
                    addCounter: { type: "-1/-1", count: 1 },
                },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The TARGETED commit: the cost is paid when the target is finalized.
        id: TARGETED_ID,
        name: "Synthetic Targeted Counter Payer",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        power: 1,
        toughness: 3,
        activatedAbilities: [
            {
                id: "targeted-counter-gain",
                oracleText:
                    "Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: { addCounter: { type: "-1/-1", count: 1 } },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // Wall of Roots' shape: a tap-less mana ability.
        id: WALL_ID,
        name: "Synthetic Counter Mana Wall",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        subtypes: ["Plant", "Wall"],
        power: 0,
        toughness: 5,
        activatedAbilities: [
            {
                id: "wall-mana",
                oracleText:
                    "Put a -0/-1 counter on this creature: Add {G}. Activate only once each turn.",
                cost: { addCounter: { type: "-0/-1", count: 1 } },
                useStack: false,
                oncePerTurn: true,
                manaProduced: { G: 1 },
                effects: [
                    { op: "addMana", player: "controller", mana: { G: 1 } },
                ],
            },
        ],
    } as CardDefinition,
]);

function creatureBoard(cardId: string): GameState {
    const src = makeInstance(cardId, {
        id: "src",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    return makeState({
        players: [makePlayer("p1", { battlefield: [src] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const counters = (state: GameState) =>
    getPlayer(state, "p1").battlefield.find((c) => c.id === "src")?.counters;

describe("cost.addCounter — the INLINE commit (CR 122.1 / 118.1)", () => {
    it("places the counter at announcement, not at resolution", () => {
        const state = creatureBoard(DRUID_ID);
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "counter-gain",
        });

        // On the stack, counter already on the source, effect not yet applied.
        expect(state.stack).toHaveLength(1);
        expect(counters(state)).toEqual({ "-1/-1": 1 });
        expect(getPlayer(state, "p1").life).toBe(lifeBefore);
        const src = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "src"
        )!;
        expect(getEffectiveToughness(state, src)).toBe(1);

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("annihilates against a +1/+1 counter through the SBA pass (CR 704.5q)", () => {
        const state = creatureBoard(DRUID_ID);
        getPlayer(state, "p1").battlefield[0].counters = { "+1/+1": 1 };

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "counter-gain",
        });
        expect(counters(state)).toEqual({ "+1/+1": 1, "-1/-1": 1 });
        checkStateBasedActions(state);

        expect(counters(state) ?? {}).toEqual({});
    });

    it("stays legal when the counter kills the source (CR 118.3 / 704.5f)", () => {
        const state = creatureBoard(DRUID_ID);
        // 0/2 with one -1/-1 counter already: the second one makes it 0/0.
        const src = getPlayer(state, "p1").battlefield[0];
        src.counters = { "-1/-1": 1 };
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "counter-gain",
        });
        checkStateBasedActions(state);

        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "src")
        ).toBe(false);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            "src"
        );
        // The ability is still on the stack and still resolves.
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });
});

describe("cost.addCounter — the DEFERRED commit (CR 601.2h)", () => {
    it("carries the intent on the pending activation and pays it at commit", () => {
        const state = creatureBoard(DEFERRED_ID);
        getPlayer(state, "p1").manaPool = { C: 1 } as never;

        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "deferred-counter-gain",
            ability: {
                id: "deferred-counter-gain",
                oracleText:
                    "{1}, Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: {
                    mana: { generic: 1 },
                    addCounter: { type: "-1/-1", count: 1 },
                },
                useStack: true,
            },
            manaCost: { generic: 1 },
        });
        expect(state.pendingActivation.addCounterCost).toEqual({
            type: "-1/-1",
            count: 1,
        });
        // Announcement is not payment.
        expect(counters(state)).toBeUndefined();

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(counters(state)).toEqual({ "-1/-1": 1 });
    });
});

describe("cost.addCounter — the TARGETED commit (CR 602.2b)", () => {
    it("places the counter when target selection finalizes", () => {
        const state = creatureBoard(TARGETED_ID);
        const target = makeInstance(DRUID_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        getPlayer(state, "p2").battlefield.push(target);

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "targeted-counter-gain",
        });
        const pt = state.pendingTarget;
        expect(pt, "a targeted ability parks a pendingTarget").toBeDefined();
        expect(counters(state)).toBeUndefined();

        pt!.selected = [{ type: "permanent", id: "target" }];
        finalizeTargetSelection(state, pt!, "p1");

        expect(state.stack).toHaveLength(1);
        expect(counters(state)).toEqual({ "-1/-1": 1 });
    });
});

type ManaArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};

describe("cost.addCounter — the tap-less MANA ability (CR 605.1a / 605.3b)", () => {
    const run = async (state: GameState) => {
        const ctx = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<ManaArgs, void>(
            activateManaAbility as unknown as Handler<ManaArgs, void>,
            ctx.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "wall-mana",
            }
        );
        return ctx.state();
    };

    it("places the counter and adds the mana without using the stack", async () => {
        const after = await run(creatureBoard(WALL_ID));

        expect(after.stack).toHaveLength(0);
        expect(getPlayer(after, "p1").manaPool.G).toBe(1);
        expect(counters(after)).toEqual({ "-0/-1": 1 });
    });

    it("is visible to the client through projectPublicState (wire format)", async () => {
        const after = await run(creatureBoard(WALL_ID));

        const projected = projectPublicState(after, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "src"
        )!;
        expect(slim.counters).toEqual({ "-0/-1": 1 });
        expect(getEffectivePower(projected as never, slim as never)).toBe(0);
        expect(getEffectiveToughness(projected as never, slim as never)).toBe(
            4
        );
    });

    it("honours 'activate only once each turn' before paying the leg", async () => {
        const first = await run(creatureBoard(WALL_ID));
        await expect(run(first)).rejects.toThrow();
        expect(counters(first)).toEqual({ "-0/-1": 1 });
    });
});

describe("cost.addCounter — a {T} mana ability pays it on the tap path", () => {
    it("places the counter when the source is tapped for mana (CR 605.1a / 122.1)", () => {
        const state = creatureBoard(WALL_ID);
        const src = getPlayer(state, "p1").battlefield[0];
        applyManaAbilityRemoveCounterCost(
            state,
            {
                cost: { tap: true, addCounter: { type: "-0/-1", count: 1 } },
            } as never,
            src
        );
        expect(counters(state)).toEqual({ "-0/-1": 1 });
    });
});
