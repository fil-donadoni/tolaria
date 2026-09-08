// Full-path integration: a PLAYER-level mana grant is activatable inside its
// holder's own may-pay window, and the mana it makes then pays the may-pay
// (issue #2911, CR 608.2g / 605.3a).
//
// CR 608.2g — "If an effect gives a player the option to pay mana, they may
// activate mana abilities before taking that action." `tapUntap` and
// `activateManaAbility` already carry that exception; `activatePlayerAbility`
// passed NEITHER `allowManaForMayPay` flag and gated BEFORE resolving the grant
// instance, so a player holding a live Channel grant and an empty pool could
// not make the mana the question was asking for — while tapping a land for the
// same mana in the identical window was legal.
//
// The scenario is built from real card resolutions, not a hand-queued
// PendingChoice: Channel resolves for p1 (the grant), then p2's Mana Tithe
// ("Counter target spell unless its controller pays {1}.") resolves against
// p1's spell and suspends on the may-pay owed to p1. Both mutations are driven
// through their REGISTERED `_handler` over the stub `MutationCtx`
// (`gameMutationHarness.ts`), so the guard ordering under test is the deployed
// one — not a reimplementation of the loop body.

import { describe, it, expect } from "vitest";
import { activatePlayerAbility, submitMayPay } from "../game";
import { makeState, pushSpell } from "../cards/__tests__/setup";
import { resolveTopOfStack } from "../gre/state";
import { getCardByName } from "../cards";
import type { GameState, GrantedAbilityInstance } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const CHANNEL = getCardByName("Channel").id;
const MANA_TITHE = getCardByName("Mana Tithe").id;
const BOLT = getCardByName("Lightning Bolt").id;
const DEMONIC_TUTOR = getCardByName("Demonic Tutor").id;
const FOREST = getCardByName("Forest").id;
// A stack-USING activated ability that costs only mana — the negative control
// for the `useStack` branch. Nothing requires its source to be on the
// battlefield: a player-scoped grant is a `{ sourceCardId, abilityId }` pair.
const KAVU = getCardByName("Kavu Chameleon").id;
const KAVU_ABILITY = "kavu-chameleon-color";

type ActivateArgs = {
    gameId: Id<"games">;
    playerId: string;
    grantedAbilityInstanceId: string;
    keepPriority?: boolean;
};

const runActivate = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<ActivateArgs, "gameId">
) =>
    runMutation<ActivateArgs, void>(
        activatePlayerAbility as unknown as Handler<ActivateArgs, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

type MayPayArgs = {
    gameId: Id<"games">;
    playerId: string;
    accept: boolean;
};

const runSubmitMayPay = (
    ctx: Parameters<typeof runMutation>[1],
    args: Omit<MayPayArgs, "gameId">
) =>
    runMutation<MayPayArgs, void>(
        submitMayPay as unknown as Handler<MayPayArgs, void>,
        ctx,
        { gameId: GAME_ID, ...args }
    );

/** Channel resolves for `holder`, leaving the "Pay 1 life: Add {C}." grant on
 *  that player. Returns the id the ENGINE minted for it. */
function grantChannel(state: GameState, holder: "p1" | "p2"): string {
    pushSpell(state, CHANNEL, holder);
    resolveTopOfStack(state);
    const index = holder === "p1" ? 0 : 1;
    return state.players[index].grantedAbilities![0].id;
}

/** `victimController`'s Lightning Bolt on the stack, countered-unless-paid by
 *  the OTHER player's Mana Tithe. Resolving the Tithe suspends on the may-pay
 *  owed to `victimController`. */
function openMayPayAgainst(
    state: GameState,
    victimController: "p1" | "p2"
): void {
    const tithePlayer = victimController === "p1" ? "p2" : "p1";
    const victim = pushSpell(state, BOLT, victimController);
    pushSpell(state, MANA_TITHE, tithePlayer, [
        { type: "spell", id: victim.id },
    ]);
    resolveTopOfStack(state);
}

/** p1 holds a live Channel grant; p2's Mana Tithe has suspended on the may-pay
 *  owed to p1. Priority sits with p2 (its turn), so the ONLY thing that can
 *  license the activation is CR 608.2g's may-pay window. */
function mayPayWindowState(): { state: GameState; grantId: string } {
    const state = makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p2",
    });
    const grantId = grantChannel(state, "p1");
    openMayPayAgainst(state, "p1");
    return { state, grantId };
}

/** Same may-pay window, but with the `priorityPlayerId` field still pointing at
 *  p1 — the shape a may-pay opened on p1's OWN turn leaves behind (priority is
 *  frozen mid-resolution, CR 608.2, so the field keeps its pre-resolution
 *  value). Used by the stack-grant negative: with priority present, the
 *  `useStack: true` branch's own `!hasPriority` check can no longer be what
 *  rejects, so the test bites on the pending-choice gate it is aimed at. */
function ownTurnMayPayWindowState(): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    grantChannel(state, "p1");
    openMayPayAgainst(state, "p1");
    return state;
}

describe("activatePlayerAbility during a may-pay window (issue #2911, CR 608.2g)", () => {
    it("the scenario really suspends on a may-pay owed to the grant holder", () => {
        const { state } = mayPayWindowState();
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "may-pay",
            playerId: "p1",
            cost: { X: 1 },
        });
        // Nothing else licenses the activation: p1 holds neither priority nor a
        // payment window of their own.
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.pendingCast).toBeUndefined();
        expect(state.pendingActivation).toBeUndefined();
    });

    it("makes the mana the may-pay is asking for, then pays it with that mana", async () => {
        const { state, grantId } = mayPayWindowState();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await runActivate(stub.ctx, {
            playerId: "p1",
            grantedAbilityInstanceId: grantId,
        });

        const afterActivation = stub.state();
        // CR 605.3b — the mana ability resolved immediately: {C} in the pool,
        // one life paid, and the may-pay still open to be answered.
        expect(afterActivation.players[0].manaPool.C).toBe(1);
        expect(afterActivation.players[0].life).toBe(19);
        expect(afterActivation.pendingChoices?.[0]).toMatchObject({
            kind: "may-pay",
            playerId: "p1",
        });

        await runSubmitMayPay(stub.ctx, { playerId: "p1", accept: true });

        const afterPay = stub.state();
        // The {1} was paid out of the freshly made {C} …
        expect(afterPay.players[0].manaPool.C ?? 0).toBe(0);
        expect(afterPay.pendingChoices ?? []).toHaveLength(0);
        // … so CR 701.6a never fired: the Bolt is still on the stack, not in
        // the graveyard.
        expect(
            afterPay.stack.map((s) => (s.card as { id?: string }).id)
        ).toContain(BOLT);
        expect(
            afterPay.players[0].graveyard.map(
                (c) => (c.card as { id?: string }).id
            )
        ).not.toContain(BOLT);
    });

    it("REJECTS the same call when the may-pay is owed to the opponent", async () => {
        // p2's Channel grant, p1's Mana Tithe → the may-pay is p2's question,
        // and p2 answering it does NOT open a payment window for p1.
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const p1Grant = grantChannel(state, "p1");
        openMayPayAgainst(state, "p2");
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runActivate(stub.ctx, {
                playerId: "p1",
                grantedAbilityInstanceId: p1Grant,
            })
        ).rejects.toThrow();
        // CR 601.2 — a rejected activation pays nothing.
        expect(stub.state().players[0].life).toBe(20);
        expect(stub.state().players[0].manaPool.C ?? 0).toBe(0);
    });

    it("REJECTS the call while the pending choice is a different KIND", async () => {
        // A search-library choice is not a mana payment — CR 608.2g's exception
        // does not reach it, so priority stays frozen (CR 608.2).
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.players[0].library = [
            { ...pushSpell(state, FOREST, "p1"), zone: "library" as const },
        ];
        state.stack = [];
        const grantId = grantChannel(state, "p1");
        pushSpell(state, DEMONIC_TUTOR, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "search-library",
            playerId: "p1",
        });

        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runActivate(stub.ctx, {
                playerId: "p1",
                grantedAbilityInstanceId: grantId,
            })
        ).rejects.toThrow();
        expect(stub.state().players[0].life).toBe(20);
    });

    it("REJECTS a STACK-using grant in the same window — the exception is for mana abilities only", async () => {
        const state = ownTurnMayPayWindowState();
        // Fund the template's {G} leg: with an empty pool the activation would
        // reject for "Not enough mana" whatever the gates did, and the test
        // would prove nothing about `useStack`.
        state.players[0].manaPool.G = 1;
        const stackGrant: GrantedAbilityInstance = {
            id: "grant-stack",
            sourceCardId: KAVU,
            abilityId: KAVU_ABILITY,
            duration: { phase: "end-of-turn" },
            grantedAtTurn: state.turn,
        };
        state.players[0].grantedAbilities = [
            ...(state.players[0].grantedAbilities ?? []),
            stackGrant,
        ];
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runActivate(stub.ctx, {
                playerId: "p1",
                grantedAbilityInstanceId: "grant-stack",
            })
        ).rejects.toThrow();
        // Nothing reached the stack, and the may-pay is still the head choice.
        expect(stub.state().stack.map((s) => s.id)).not.toContain(
            "granted-grant-stack"
        );
        expect(stub.state().pendingChoices?.[0]).toMatchObject({
            kind: "may-pay",
            playerId: "p1",
        });
    });

    it("still REJECTS an unknown grant id inside the may-pay window", async () => {
        // The lookup moved AHEAD of the guards; it must not have become a path
        // that acts on an instance id the player does not hold.
        const { state } = mayPayWindowState();
        const stub = makeMutationCtx("p1", [gameStateSeed(state)]);

        await expect(
            runActivate(stub.ctx, {
                playerId: "p1",
                grantedAbilityInstanceId: "grant-does-not-exist",
            })
        ).rejects.toThrow(/Granted ability not found/);
        expect(stub.state().players[0].life).toBe(20);
        expect(stub.state().players[0].manaPool.C ?? 0).toBe(0);
    });
});
