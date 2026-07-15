// Madness (CR 702.35) — the discard→exile cast capability. Exercised once here
// for the mechanic itself (built once, reused by every madness card); the
// per-card behaviour lives in the parallel colour test files. Covers:
//   - CR 702.35c replacement: a discarded madness card is exiled, not binned
//   - CR 702.35d cast affordance: the exiled card is castable from exile for its
//     madness cost (getLegalActions + the real castRawManaCost cost seam)
//   - CR 702.35d decline: an uncast madness card is put into the graveyard at
//     the cleanup step
//   - the frontend-wiring SURFACE: projectPublicState carries the cast affordance
//     to the owner and hides it from the opponent
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../cards/__tests__/setup";
import {
    discardToGraveyard,
    getPlayer,
    removeFromZone,
    resolveTopOfStack,
} from "../state";
import type { StackItem } from "../state";
import { getLegalActions } from "../rules";
import { advancePhase, finalizeCleanup } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { locateCastSource, castRawManaCost } from "../../game";
import { getMadnessCost, hasMadness } from "../madness";
import { baskingRootwalla } from "../../cards/sets/tor/green";
import { anjesRavager } from "../../cards/sets/c19/red";
import { grizzlyBears } from "../../cards/sets/lea";

describe("Madness capability (CR 702.35)", () => {
    describe("discard replacement (CR 702.35c)", () => {
        it("exiles a discarded madness card instead of putting it into the graveyard", () => {
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
            // CR 702.35c / 702.35d — exiled, owner-castable, this-turn window.
            expect(exiled!.madnessExiled).toBe(true);
            expect(exiled!.castableFromExileBy).toBe("p1");
            expect(exiled!.castableFromExileUntilTurn).toBe(state.turn);
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

    describe("cast affordance from exile (CR 702.35d)", () => {
        it("offers a Madness {0} creature at instant speed on the opponent's turn", () => {
            // Basking Rootwalla (Madness {0}) is always affordable, so the
            // affordance surfaces even on the opponent's turn — CR 702.35d's
            // window is instant-speed regardless of the card's type.
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                activePlayerId: "p2",
                priorityPlayerId: "p1",
                phase: "PRECOMBAT_MAIN",
            });

            discardToGraveyard(state, "p1", card.id);
            const exiled = getPlayer(state, "p1").exile.find(
                (c) => c.id === card.id
            )!;
            expect(
                getLegalActions(state, getPlayer(state, "p1"), exiled)
            ).toContain("cast");
        });

        it("charges the madness cost, not the printed cost, on the exile cast", () => {
            // Anje's Ravager: printed {2}{R}, Madness {1}{R}.
            const card = makeInstance(anjesRavager.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardToGraveyard(state, "p1", card.id);

            // Real cast-source seam: exile zone, madness cost.
            const src = locateCastSource(state, getPlayer(state, "p1"), card.id);
            expect(src.zone).toBe("exile");
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                X: 1,
                R: 1,
            });
        });

        it("casts a Madness {0} creature from exile for free, and the resolved permanent drops the madness marker", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });

            discardToGraveyard(state, "p1", card.id);
            const src = locateCastSource(state, getPlayer(state, "p1"), card.id);
            expect(src.zone).toBe("exile");
            // Madness {0}: the empty cost is present (not undefined) and free.
            expect(castRawManaCost(state, src.card!, src.zone)).toEqual({});

            // Commit the cast: exile → stack (clears the madness/exile markers),
            // then resolve the creature onto the battlefield.
            const moved = removeFromZone(getPlayer(state, "p1"), card.id, "exile");
            expect(moved.madnessExiled).toBeUndefined();
            expect(moved.castableFromExileBy).toBeUndefined();
            const stackItem: StackItem = { ...moved, castById: "p1", targets: [] };
            state.stack.push(stackItem);
            resolveTopOfStack(state);

            const bf = getPlayer(state, "p1").battlefield.find(
                (c) => c.id === card.id
            );
            expect(bf).toBeDefined();
            expect(bf!.madnessExiled).toBeUndefined();
        });
    });

    describe("decline → graveyard at cleanup (CR 702.35d)", () => {
        it("puts an uncast madness card (discarded outside cleanup) into its owner's graveyard at the cleanup step", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                phase: "END_STEP",
            });

            // Discarded outside the cleanup step (window ends THIS turn's cleanup).
            discardToGraveyard(state, "p1", card.id);
            expect(
                getPlayer(state, "p1").exile.some((c) => c.id === card.id)
            ).toBe(true);

            // The owner declines to cast it: cleanup sweeps it to the graveyard.
            finalizeCleanup(state);

            const player = getPlayer(state, "p1");
            expect(player.exile.some((c) => c.id === card.id)).toBe(false);
            const gy = player.graveyard.find((c) => c.id === card.id);
            expect(gy).toBeDefined();
            expect(gy!.madnessExiled).toBeUndefined();
            expect(gy!.castableFromExileBy).toBeUndefined();
        });

        // Regression for the CR 514.1 cleanup hand-size discard (the iconic
        // "discard the extra Rootwalla to hand size, cast it for {0}" line):
        // drives the REAL tryEnqueueCleanupDiscard → finalizeCleanupDiscard path,
        // NOT a hand-built state. Without the windowExpiryTurn / sweep guard the
        // card would be exiled AND binned in the same synchronous pass.
        it("keeps a Rootwalla discarded to hand size at cleanup castable via madness (not binned), then bins it at the next cleanup if declined", () => {
            // 8-card hand (one over max) with a Basking Rootwalla to discard.
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

            // Bug #1 fix: the Rootwalla is NOT in the graveyard — it is exiled
            // and still castable for its madness cost (window extended past the
            // cleanup that just happened, since cleanup grants no priority).
            const p1After = getPlayer(state, "p1");
            expect(p1After.graveyard.some((c) => c.id === "walla")).toBe(false);
            const exiled = p1After.exile.find((c) => c.id === "walla");
            expect(exiled).toBeDefined();
            expect(exiled!.madnessExiled).toBe(true);
            expect(exiled!.castableFromExileBy).toBe("p1");
            // The turn advanced out of CLEANUP; the window reaches the next turn.
            expect(state.turn).toBe(2);
            expect(exiled!.castableFromExileUntilTurn).toBe(2);
            // When p1 next holds priority (non-active players get priority during
            // the opponent's turn), the madness cast is offered at instant speed.
            state.priorityPlayerId = "p1";
            expect(getLegalActions(state, p1After, exiled!)).toContain("cast");

            // Decline: at the NEXT cleanup (turn 2) the uncast copy is binned.
            finalizeCleanup(state);
            const p1Next = getPlayer(state, "p1");
            expect(p1Next.exile.some((c) => c.id === "walla")).toBe(false);
            expect(p1Next.graveyard.some((c) => c.id === "walla")).toBe(true);
        });
    });

    describe("serialization round-trip", () => {
        it("preserves the madnessExiled marker across compact/expand", () => {
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
            expect(exiled?.castableFromExileBy).toBe("p1");
        });
    });

    describe("frontend wiring — projectPublicState (CR 702.35d)", () => {
        it("carries the cast affordance to the owner and hides it from the opponent", () => {
            const card = makeInstance(baskingRootwalla.id, {
                zone: "hand",
                controllerId: "p1",
                ownerId: "p1",
            });
            const p1 = makePlayer("p1", { hand: [card] });
            const state = makeState({ players: [p1, makePlayer("p2")] });
            discardToGraveyard(state, "p1", card.id);

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
