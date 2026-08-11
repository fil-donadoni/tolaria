// CR 601.2c / 602.2b — the ACTIVATED-ABILITY half of the same bug class
// upToXTargetCastLegality.test.ts guards on the cast path. Issue #2369
// review round 2 (PR #2455): `activateAbilityOnState` (convex/game.ts, the
// body the `activateAbility` mutation calls) threw "No legal targets
// available" for a `{ min: 0, max }` target requirement ("up to one" / "up
// to N") whenever `getLegalTargets` came back empty, computing
// `abilityRequired` (`minTargetCount`) only AFTER that unconditional throw —
// exactly the ordering `announceCast` had before round 1's fix, one function
// below it.
//
// This is LIVE, not latent: three shipped cards define an activatedAbilities[]
// entry with an object-shaped min-0 count — Teferi, Time Raveler's -3
// ("Return up to one target artifact, creature, or enchantment to its
// owner's hand. Draw a card."), Sorin, Lord of Innistrad's -6, and Minsc &
// Boo's +1. Teferi is the sharpest case: the ability's OWN unconditional
// "Draw a card" clause was lost whenever no legal A/C/E target existed,
// because the whole activation was rejected before ever reaching the stack.
//
// Same harness discipline as upToXTargetCastLegality.test.ts: no convex-test
// harness in this project, so the established seam for `game.ts` integration
// coverage is a stub `MutationCtx` driving the REGISTERED mutations' own
// `_handler`s (`gameMutationHarness.ts`) — never a hand-rolled
// reimplementation of `activateAbilityOnState`'s loop body, and never the
// `activate()` helper in `sets/war/__tests__/multicolor.test.ts` that pushes
// straight onto `state.stack` — that helper bypasses `activateAbilityOnState`
// entirely (including the buggy `legal.length === 0` throw), which is
// precisely why its existing "up to one: resolves with no target" test never
// caught this: it never drove the real activation path.

import { describe, it, expect } from "vitest";
import { activateAbility, confirmTargets } from "../game";
import { teferiTimeRaveler } from "../cards/sets/war/multicolor";
import { registerTokenDefinition } from "../cards";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { resolveTopOfStack } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const MINUS3 = "teferi-time-raveler-minus3";

type ActivateAbilityArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
    chosenX?: number;
};

type ConfirmTargetsArgs = {
    gameId: Id<"games">;
    playerId: string;
};

const runActivateAbility = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<ActivateAbilityArgs, "gameId" | "playerId">
) =>
    runMutation<ActivateAbilityArgs, void>(
        activateAbility as unknown as Handler<ActivateAbilityArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );

const runConfirmTargets = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<ConfirmTargetsArgs, void>(
        confirmTargets as unknown as Handler<ConfirmTargetsArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

describe("activateAbility — a min-0 'up to one' target requirement stays legal with zero legal targets (CR 601.2c, issue #2369 review round 2)", () => {
    it("Teferi, Time Raveler's -3: empty board (no artifact/creature/enchantment anywhere) still reaches the stack and draws the unconditional card", async () => {
        const teferi = makeInstance(teferiTimeRaveler.id, {
            id: "teferi1",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 4 },
        });
        const topCard = makeInstance(teferiTimeRaveler.id, {
            id: "top1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [teferi], library: [topCard] }),
                makePlayer("p2"), // empty battlefield — zero legal A/C/E targets
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        // Does NOT throw despite zero legal targets — CR 601.2c: "up to one"
        // is legal to announce choosing none of them.
        await runActivateAbility(harness.ctx, {
            cardInstanceId: "teferi1",
            abilityId: MINUS3,
        });

        const afterActivate = harness.state();
        expect(afterActivate.pendingTarget).toBeDefined();
        expect(afterActivate.pendingTarget?.count).toEqual({ min: 0, max: 1 });
        expect(afterActivate.pendingTarget?.selected).toEqual([]);

        // Confirm with zero targets selected (min 0 permits it) — finalizes
        // onto the stack.
        await runConfirmTargets(harness.ctx);

        const afterConfirm = harness.state();
        expect(afterConfirm.pendingTarget).toBeUndefined();
        expect(afterConfirm.stack).toHaveLength(1);
        expect(afterConfirm.stack[0].abilityId).toBe(MINUS3);
        // CR 606.5 — the -3 loyalty cost is paid as the ability commits to
        // the stack.
        const teferiAfterConfirm = afterConfirm.players[0].battlefield.find(
            (c) => c.id === "teferi1"
        )!;
        expect(teferiAfterConfirm.counters?.loyalty).toBe(1);

        // Resolve the ability: the bounce is a no-op (no target), but "Draw a
        // card" is unconditional — this is the observable the bug destroys.
        resolveTopOfStack(afterConfirm);
        expect(afterConfirm.players[0].hand.map((c) => c.id)).toEqual(["top1"]);
    });
});

// CR 602.2b / 601.2c — the negative control: the fix must not loosen a
// GENUINELY mandatory activated-ability target requirement. A synthetic
// test-only card (never entering `getAllCards()` — `registerTokenDefinition`
// only feeds the `registry`/`getDefinition` lookup, not the catalogue-wide
// `allCards` array `getAllCards()` reads, so this cannot leak into any
// catalogue guard) with a plain `count: 1` requirement restricted to the
// OPPONENT's creatures (so the source itself, a creature the activator
// controls, can never satisfy its own requirement).
const MANDATORY_TARGET_TEST_ID =
    "test-2369-mandatory-single-target-activated-ability";
registerTokenDefinition({
    id: MANDATORY_TARGET_TEST_ID,
    name: MANDATORY_TARGET_TEST_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "mandatory-target-destroy",
            oracleText: "{1}: Destroy target creature an opponent controls.",
            cost: { mana: { generic: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
});

describe("activateAbility — a genuinely mandatory target requirement stays illegal with zero legal targets (negative control, issue #2369 review round 2)", () => {
    it("throws 'No legal targets available' on an empty opponent board — the fix does not make every ability activatable", async () => {
        const source = makeInstance(MANDATORY_TARGET_TEST_ID, {
            id: "mandatory-source",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2"), // empty battlefield — zero legal opponent creatures
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runActivateAbility(harness.ctx, {
                cardInstanceId: "mandatory-source",
                abilityId: "mandatory-target-destroy",
            })
        ).rejects.toThrow("No legal targets available");

        // Nothing was committed — no pendingTarget, no stack item.
        const after = harness.state();
        expect(after.pendingTarget).toBeUndefined();
        expect(after.stack).toHaveLength(0);
    });
});
