// Per-card behavior tests for red cards in `convex/cards/sets/dsk/red.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.
//
// Fear of Missing Out (issue #2421): the "when this creature enters, discard
// a card, then draw a card" clause was previously wired as CardDefinition-
// level `effects` — the spell-resolution slot, which the engine runs ONLY
// once, at cast-resolution time. Rebuilt as an `enteredTrigger` (a real CR
// 603.2 triggered ability), these tests prove it fires off the generic
// PERMANENT_ENTERED event on every entry path, not only a cast.

import { describe, it, expect } from "vitest";
import { fearOfMissingOut } from "..";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    putReanimatedSetOnBattlefield,
    exileWithAttachments,
    returnExiledForSource,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

function submitDiscard(
    state: ReturnType<typeof makeState>,
    cardInstanceId: string
): void {
    const pending = state.pendingChoices![0];
    expect(pending.kind).toBe("discard-hand");
    applyPendingChoiceSubmit(state, {
        playerId: pending.playerId,
        stackItemId: pending.stackItemId,
        step: pending.step,
        choiceId: pending.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

describe("Fear of Missing Out (CR 603.2 ETB — discard then draw, issue #2421)", () => {
    it("cast normally: the discard-then-draw fires exactly once (no regression)", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [hand1], library: [lib1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fearOfMissingOut.id, "p1");
        resolveTopOfStack(state); // resolves the spell: creature enters, ETB trigger goes on the stack
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
            )
        ).toBe(true);
        expect(resolveTopOfStack(state)).toBeNull(); // resolves the trigger, suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
        expect(p1.library).toHaveLength(0);
        // Fires exactly once — no leftover trigger for the same source.
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
            )
        ).toHaveLength(0);
    });

    it("reanimation (non-cast entry, #2421 regression target): the ETB fires when put onto the battlefield from the graveyard", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const grave = makeInstance(fearOfMissingOut.id, {
            id: "graveyard-fomo",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [hand1],
                    library: [lib1],
                    graveyard: [grave],
                }),
                makePlayer("p2"),
            ],
        });

        state.players[0].graveyard = [];
        putReanimatedSetOnBattlefield(state, [
            { card: grave, controllerId: "p1" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "graveyard-fomo")
        ).toBe(true);

        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("blink (second non-cast entry path, exile-and-return): the ETB fires again on the returning object", () => {
        const hand1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib1 = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const fomo = makeInstance(fearOfMissingOut.id, {
            id: "fomo",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [fomo],
                    hand: [hand1],
                    library: [lib1],
                }),
                makePlayer("p2"),
            ],
        });

        exileWithAttachments(state, "fomo", {
            sourceId: "blink-source",
            returnTapped: false,
        });
        expect(state.players[0].battlefield.some((c) => c.id === "fomo")).toBe(
            false
        );
        returnExiledForSource(state, "blink-source");
        expect(state.players[0].battlefield.some((c) => c.id === "fomo")).toBe(
            true
        );

        const triggers = collectTriggers(state, state.pendingEvents ?? []);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the discard choice
        submitDiscard(state, "h1");

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("the ETB ability is visible through the real client-facing projection (wire format)", () => {
        const fomo = makeInstance(fearOfMissingOut.id, {
            id: "fomo",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fomo] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "fomo",
                controllerId: "p1",
                cardId: fearOfMissingOut.id,
                types: ["Enchantment", "Creature"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);

        const projected = projectPublicState(state, 1, "p1");
        const slimStack = projected.stack.find(
            (s) => s.triggeredAbilityId === "fear-of-missing-out-etb"
        );
        expect(slimStack).toBeDefined();
        expect(slimStack!.triggerSourceId).toBe("fomo");
    });
});
