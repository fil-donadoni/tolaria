// Madness (CR 702.35) — the discard→exile reflexive-cast capability. Exercised
// once here for the mechanic itself (built once, reused by every madness card);
// the per-card behaviour lives in the parallel colour test files. Covers the
// full CR 702.35d timing, driven through the REAL engine path
// (processPendingActionTriggers → resolveTopOfStack → declineMadness):
//   - CR 702.35c replacement: a discarded madness card is exiled, not binned,
//     and is NOT yet castable (it awaits its reflexive trigger)
//   - CR 702.35d trigger: a reflexive triggered ability goes on the stack, and
//     resolving it opens the owner's single cast window (castableFromExileBy +
//     state.madnessCastWindow)
//   - CR 702.35d cast: the exiled card is castable from exile for its madness
//     cost only while the window is open (getLegalActions + castRawManaCost)
//   - CR 702.35d decline: passing priority in the window bins the card
//     IMMEDIATELY (not at cleanup)
//   - CR 514.3: a card discarded to hand size at cleanup gets a real cast window
//     during the discarding player's own end step
//   - the frontend-wiring SURFACE: projectPublicState carries the cast affordance
//     to the owner and hides it from the opponent
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    discardToGraveyard,
    getPlayer,
    removeFromZone,
    resolveTopOfStack,
    processPendingActionTriggers,
    type StackItem,
} from "../state";
import { getLegalActions } from "../rules";
import { advancePhase } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { locateCastSource, castRawManaCost } from "../../game";
import {
    getMadnessCost,
    hasMadness,
    declineMadness,
    consumeMadnessCastChoice,
    openMadnessWindowCard,
} from "../madness";
import { baskingRootwalla } from "../../cards/sets/tor/green";
import { anjesRavager } from "../../cards/sets/c19/red";
import { grizzlyBears } from "../../cards/sets/lea";

/** Discards `cardId` from `p1` and pushes the reflexive madness trigger onto the
 *  stack through the real post-action trigger scan (CR 702.35d). Returns the
 *  discarded card's exiled instance. Does NOT resolve the trigger — the caller
 *  drives that to open the cast window. */
function discardAndFireMadnessTrigger(
    state: ReturnType<typeof makeState>,
    playerId: string,
    cardId: string
) {
    discardToGraveyard(state, playerId, cardId);
    // The engine drains CARD_DISCARDED and scans triggers after every game
    // action; replicate that here (the discard above happened outside a
    // resolution).
    processPendingActionTriggers(state);
    return getPlayer(state, playerId).exile.find((c) => c.id === cardId);
}

describe("Madness capability (CR 702.35)", () => {
    describe("discard replacement (CR 702.35c)", () => {
        it("exiles a discarded madness card instead of putting it into the graveyard, NOT yet castable", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            expect(discardToGraveyard(state, "p1", card.id)).toBe(true);

            const player = getPlayer(state, "p1");
            expect(player.hand.some((c) => c.id === card.id)).toBe(false);
            expect(player.graveyard.some((c) => c.id === card.id)).toBe(false);
            const exiled = player.exile.find((c) => c.id === card.id);
            expect(exiled).toBeDefined();
            // CR 702.35c/d — exiled and pending its reflexive trigger, but the
            // cast window is NOT open yet (no castableFromExileBy).
            expect(exiled!.madnessExiled).toBe(true);
            expect(exiled!.madnessTriggerPending).toBe(true);
            expect(exiled!.castableFromExileBy).toBeUndefined();
            expect(getLegalActions(state, player, exiled!)).not.toContain(
                "cast"
            );
        });

        it("puts a NON-madness card into the graveyard as normal (control)", () => {
            const bear = makeInstance(grizzlyBears.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            expect(hasMadness(bear)).toBe(false);
            const p1 = makePlayer("p1", { hand: [bear] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            expect(discardToGraveyard(state, "p1", bear.id)).toBe(true);
            const player = getPlayer(state, "p1");
            expect(player.graveyard.some((c) => c.id === bear.id)).toBe(true);
            expect(player.exile.some((c) => c.id === bear.id)).toBe(false);
        });
    });

    describe("reflexive cast-trigger on the stack (CR 702.35d)", () => {
        it("puts a reflexive triggered ability on the stack, owner-controlled", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardToGraveyard(state, "p1", card.id);
            processPendingActionTriggers(state);

            expect(state.stack).toHaveLength(1);
            const trig = state.stack[0];
            expect(trig.madnessTrigger).toBe(card.id);
            expect(trig.controllerId).toBe("p1");
            // Still not castable while the trigger sits on the stack unresolved.
            const exiled = getPlayer(state, "p1").exile.find(
                (c) => c.id === card.id
            )!;
            expect(exiled.castableFromExileBy).toBeUndefined();
            expect(
                getLegalActions(state, getPlayer(state, "p1"), exiled)
            ).not.toContain("cast");
        });

        it("opens the owner's cast window when the reflexive trigger resolves", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            const exiled = discardAndFireMadnessTrigger(state, "p1", card.id)!;
            // Resolve the reflexive trigger → window opens.
            resolveTopOfStack(state);
            expect(state.stack).toHaveLength(0);
            expect(exiled.madnessTriggerPending).toBeUndefined();
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(state.madnessCastWindow).toEqual({
                cardId: card.id,
                ownerId: "p1",
            });
            expect(
                getLegalActions(state, getPlayer(state, "p1"), exiled)
            ).toContain("cast");
        });

        it("pushes a blocking madness-cast pending choice on the owner when the trigger resolves", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state);

            // A blocking Cast/Decline choice is pending on the owner — passing
            // priority is impossible while it is (so the cast can't be lost).
            const head = state.pendingChoices?.[0];
            expect(head?.kind).toBe("madness-cast");
            expect(head?.playerId).toBe("p1");
            expect(head?.cardInstanceId).toBe(card.id);
            expect(state.priorityPlayerId).toBe("p1");
        });
    });

    describe("cast for the madness cost (CR 702.35d)", () => {
        it("charges the madness cost, not the printed cost, on the exile cast", () => {
            // Anje's Ravager: printed {2}{R}, Madness {1}{R}.
            const card = makeInstance(anjesRavager.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // open the window

            // Real cast-source seam: exile zone, madness cost.
            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                card.id
            );
            expect(src.zone).toBe("exile");
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                X: 1,
                R: 1,
            });
        });

        it("casts a Madness {0} creature from exile for free; the resolved permanent drops the madness marker", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // open the window

            const src = locateCastSource(
                state,
                getPlayer(state, "p1"),
                card.id
            );
            expect(src.zone).toBe("exile");
            // Madness {0}: the empty cost is present (not undefined) and free.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({});

            // Accepting via announceCast consumes the madness-cast choice (the
            // window closes) before the card leaves exile for the stack.
            consumeMadnessCastChoice(state, "p1", card.id);
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.madnessCastWindow).toBeUndefined();

            // Commit the cast: exile → stack (clears the madness/exile markers),
            // then resolve the creature onto the battlefield.
            const moved = removeFromZone(
                getPlayer(state, "p1"),
                card.id,
                "exile"
            );
            expect(moved.madnessExiled).toBeUndefined();
            expect(moved.castableFromExileBy).toBeUndefined();
            const stackItem: StackItem = {
                ...moved,
                castById: "p1",
                targets: [],
            };
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            const bf = getPlayer(state, "p1").battlefield.find(
                (c) => c.id === card.id
            );
            expect(bf).toBeDefined();
            expect(bf!.madnessExiled).toBeUndefined();
        });
    });

    describe("decline → graveyard immediately (CR 702.35d)", () => {
        it("declineMadness bins the uncast card the instant the owner passes, not at cleanup", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // open the window
            expect(openMadnessWindowCard(state)).toBeDefined();

            // Owner declines: the card goes to the graveyard NOW.
            expect(declineMadness(state)).toBe(true);
            const player = getPlayer(state, "p1");
            expect(player.exile.some((c) => c.id === card.id)).toBe(false);
            const gy = player.graveyard.find((c) => c.id === card.id);
            expect(gy).toBeDefined();
            expect(gy!.madnessExiled).toBeUndefined();
            expect(gy!.castableFromExileBy).toBeUndefined();
            expect(state.madnessCastWindow).toBeUndefined();
        });

        it("declineMadness pops the head madness-cast choice as it bins the card", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // pushes the madness-cast choice
            expect(state.pendingChoices?.[0]?.kind).toBe("madness-cast");

            expect(declineMadness(state)).toBe(true);
            // The blocking choice is gone and the card is in the graveyard.
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(
                getPlayer(state, "p1").graveyard.some((c) => c.id === card.id)
            ).toBe(true);
        });
    });

    describe("cleanup hand-size discard → CR 514.3 window", () => {
        // The iconic "discard the extra Rootwalla to hand size, cast it for {0}"
        // line. Drives the REAL tryEnqueueCleanupDiscard → finalizeCleanupDiscard
        // path. CR 514.3: the reflexive trigger the cleanup discard creates gives
        // the active player priority and keeps the game in CLEANUP; the card is
        // NOT binned in the same synchronous pass.
        it("keeps a Rootwalla discarded to hand size castable via its reflexive trigger, then bins it on decline", () => {
            const rootwalla = makeInstance(baskingRootwalla.id, {
                id: "walla",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const filler = Array.from({ length: 7 }, (_, i) =>
                makeInstance(grizzlyBears.id, {
                    id: `f${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                })
            );
            const state = makeState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", { hand: [rootwalla, ...filler] }),
                    makePlayer("p2"),
                ],
            });

            // END_STEP → CLEANUP enqueues the CR 514.1 discard-hand choice.
            advancePhase(state);
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("discard-hand");
            expect(head.count).toBe(1);

            // Discard the Rootwalla to hand size via the REAL commit path.
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["walla"],
            });

            // CR 514.3 — the Rootwalla is NOT in the graveyard: it is exiled and
            // its reflexive trigger is on the stack (still CLEANUP, active player
            // has priority).
            const p1After = getPlayer(state, "p1");
            expect(p1After.graveyard.some((c) => c.id === "walla")).toBe(false);
            expect(p1After.exile.some((c) => c.id === "walla")).toBe(true);
            expect(state.phase).toBe("CLEANUP");
            expect(state.stack.some((s) => s.madnessTrigger === "walla")).toBe(
                true
            );
            expect(state.priorityPlayerId).toBe("p1");

            // Resolve the trigger → the cast window opens during p1's own end.
            resolveTopOfStack(state);
            const exiled = getPlayer(state, "p1").exile.find(
                (c) => c.id === "walla"
            )!;
            expect(exiled.castableFromExileBy).toBe("p1");
            expect(getLegalActions(state, p1After, exiled)).toContain("cast");

            // Decline: the uncast copy is binned immediately.
            expect(declineMadness(state)).toBe(true);
            const p1End = getPlayer(state, "p1");
            expect(p1End.exile.some((c) => c.id === "walla")).toBe(false);
            expect(p1End.graveyard.some((c) => c.id === "walla")).toBe(true);
        });
    });

    describe("serialization round-trip", () => {
        it("preserves the pending-trigger marker before the window opens", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            discardToGraveyard(state, "p1", card.id);

            const round = expandState(compactState(state));
            const exiled = getPlayer(round, "p1").exile.find(
                (c) => c.id === card.id
            );
            expect(exiled?.madnessExiled).toBe(true);
            expect(exiled?.madnessTriggerPending).toBe(true);
            expect(exiled?.castableFromExileBy).toBeUndefined();
        });

        it("preserves the open cast window (castableFromExileBy + madnessCastWindow)", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // open the window

            const round = expandState(compactState(state));
            const exiled = getPlayer(round, "p1").exile.find(
                (c) => c.id === card.id
            );
            expect(exiled?.madnessExiled).toBe(true);
            expect(exiled?.castableFromExileBy).toBe("p1");
            expect(round.madnessCastWindow).toEqual({
                cardId: card.id,
                ownerId: "p1",
            });
        });
    });

    describe("frontend wiring — projectPublicState (CR 702.35d)", () => {
        it("carries the cast affordance to the owner and hides it from the opponent while the window is open", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            discardAndFireMadnessTrigger(state, "p1", card.id);
            resolveTopOfStack(state); // open the window

            // Owner's view: the exiled card is castable and tagged with "cast".
            const ownView = projectPublicState(state, 1, "p1");
            const ownExile = ownView.players[0].exile.find(
                (c) => c.id === card.id
            )!;
            expect(ownExile.castableFromExileBy).toBe("p1");
            expect(ownExile.legalActions).toContain("cast");

            // Opponent's view: no "cast" affordance is attached to it.
            const oppView = projectPublicState(state, 1, "p2");
            const oppExile = oppView.players[0].exile.find(
                (c) => c.id === card.id
            )!;
            expect(oppExile.legalActions ?? []).not.toContain("cast");
        });
    });

    describe("card definitions", () => {
        it("Basking / Blazing Rootwalla carry Madness {0}", () => {
            const b = makeInstance(baskingRootwalla.id, { zone: "hand" });
            expect(getMadnessCost(b)).toEqual({});
        });
        it("Anje's Ravager carries Madness {1}{R}", () => {
            const a = makeInstance(anjesRavager.id, { zone: "hand" });
            expect(getMadnessCost(a)).toEqual({ X: 1, R: 1 });
        });
    });
});
