// `upkeepDiscardOrElseTrigger` — permanent test for the "sacrifice this
// unless you discard a card" upkeep maintenance-cost family (CR 603.6a +
// CR 117.3a + CR 701.8, issue #1129, parent PRD #1058).
//
// No shipped card in the current catalogue prints exactly "sacrifice this
// unless you discard a card" (verified against MTGJSON DRK.json — the set
// the issue's target-file list points at has zero matches; Oath of Lim-Dûl,
// ice/black.ts, is the closest shipped precedent but its punisher clause is
// LIFE_LOST-triggered, not an upkeep trigger, and its own test never
// exercises the discard branch). Rather than fabricate a fake entry inside a
// real MTGJSON-backed set file (which would break the "every card in
// sets/<code>/<colour>.ts is a real printing" invariant those files
// document), this test registers a synthetic fixture definition via
// `registerTokenDefinition` — the same mechanism `fadingVanishing.test.ts`
// uses to test a shared ability factory directly, in isolation from any
// particular printed card.

import { describe, it, expect } from "vitest";
import { upkeepDiscardOrElseTrigger } from "../upkeepDiscardOrElse";
import { registerTokenDefinition, getDefinition } from "../..";
import { grizzlyBears } from "../../sets/lea";
import { necropotence } from "../../sets/ice";
import { resolveTopOfStack } from "../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";

const FIXTURE_ID = "test-fixture:upkeep-discard-ward-1129";

registerTokenDefinition({
    id: FIXTURE_ID,
    name: "Test Discard Ward",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    oracleText:
        "At the beginning of your upkeep, sacrifice Test Discard Ward unless you discard a card.",
    triggeredAbilities: [
        upkeepDiscardOrElseTrigger({
            id: "test-discard-ward-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice Test Discard Ward unless you discard a card.",
            prompt: "Discard a card, or sacrifice Test Discard Ward?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
});

/** Push the fixture's upkeep trigger onto the stack (mirroring the engine
 *  after `matches` fires it) and resolve it. */
function resolveUpkeepTrigger(
    state: GameState,
    source: CardInstanceState
): void {
    const triggerEvent = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: source.controllerId,
    } as StackItem["triggerEvent"];
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "test-discard-ward-upkeep",
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

function onBattlefield(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

function inGraveyard(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    return state.players.flatMap((p) => p.graveyard).find((c) => c.id === id);
}

describe("upkeepDiscardOrElseTrigger (CR 603.6a + 117.3a + 701.8, #1129)", () => {
    it("registers the fixture definition", () => {
        expect(getDefinition(FIXTURE_ID).name).toBe("Test Discard Ward");
    });

    it("prompts a may-pay, then a hand pick, when the hand is non-empty", () => {
        const source = makeInstance(FIXTURE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveUpkeepTrigger(state, source);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        // Cost-less may-pay: no `cost` field (this is NOT a ManaCost payment).
        expect(state.pendingChoices![0].cost).toBeUndefined();
    });

    it("discarding pays the cost: the source survives and CARD_DISCARDED fires (CR 701.9)", () => {
        const source = makeInstance(FIXTURE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // CR 701.9 witness: Necropotence's own "whenever you discard a card,
        // exile it from your graveyard" trigger (ice/black.ts,
        // `necropotence-discard-exile`, event: "CARD_DISCARDED"). `resolveTop
        // OfStack` flushes `state.pendingEvents` synchronously as part of the
        // same call that runs the discard (`processPendingActionTriggers`),
        // so a raw post-hoc read of `pendingEvents` always observes it
        // already drained. Asserting that an UNRELATED "whenever you
        // discard" listener actually fires is the stronger, externally
        // observable proof that `ctx.discardCard` really emitted
        // CARD_DISCARDED off the shared choke point (not a bespoke
        // graveyard move that bypasses it).
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source, necro],
                    hand: [handCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveUpkeepTrigger(state, source);

        // Step 1: accept the discard alternative.
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.pendingChoices).toHaveLength(1);
        const pickHead = state.pendingChoices![0];
        expect(pickHead.kind).toBe("choose-hand-card");
        expect(pickHead.zone).toBe("hand");

        // Step 2: pick the hand card to discard.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pickHead.stackItemId,
            step: pickHead.step,
            choiceId: pickHead.choiceId,
            cardInstanceIds: ["hand1"],
        });

        // The source was NOT sacrificed.
        expect(onBattlefield(state, "src")).toBeDefined();
        // The card left the hand and landed in the graveyard (CR 701.8).
        expect(
            state.players[0].hand.find((c) => c.id === "hand1")
        ).toBeUndefined();
        expect(inGraveyard(state, "hand1")).toBeDefined();
        // Necropotence's discard trigger landed on the stack — proof
        // CARD_DISCARDED fired off the shared choke point.
        const necroTrigger = state.stack.find(
            (item) => item.triggeredAbilityId === "necropotence-discard-exile"
        );
        expect(necroTrigger).toBeDefined();
    });

    it("declining sacrifices the source instead", () => {
        const source = makeInstance(FIXTURE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source], hand: [handCard] }),
                makePlayer("p2"),
            ],
        });
        resolveUpkeepTrigger(state, source);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        // No further pending choice — the decline branch (sacrifice) is final.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(onBattlefield(state, "src")).toBeUndefined();
        expect(inGraveyard(state, "src")).toBeDefined();
        // The card stayed in hand — it was never discarded.
        expect(
            state.players[0].hand.find((c) => c.id === "hand1")
        ).toBeDefined();
    });

    it("auto-resolves straight to sacrifice with an empty hand (no prompt shown)", () => {
        const source = makeInstance(FIXTURE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source], hand: [] }),
                makePlayer("p2"),
            ],
        });
        resolveUpkeepTrigger(state, source);

        // No may-pay (or any) prompt was raised — there is no real choice to
        // present with an empty hand (Arena UX auto-resolve).
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(onBattlefield(state, "src")).toBeUndefined();
        expect(inGraveyard(state, "src")).toBeDefined();
    });
});
