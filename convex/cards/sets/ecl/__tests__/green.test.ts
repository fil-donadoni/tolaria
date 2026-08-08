// ECL — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { formidableSpeaker } from "../green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    canPayMayPayCost,
    payMayPayCost,
    mayPayDiscardChoiceRequired,
    getMayPayDiscardCandidateIds,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { MayPayCost } from "../../../types";

// Grizzly Bears (LEA) — a plain vanilla Creature, reused across set tests as a
// generic "a creature card" body (mir/colorless.test.ts uses the same id).
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
// Ancestral Recall (LEA) — a plain Instant, reused as a generic non-creature
// hand-filler card so the discard leg has something to discard that ISN'T
// the searched-for creature type.
const ANCESTRAL_RECALL_ID = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";

/** Fires Formidable Speaker's self-ETB trigger via the stack, suspending at
 *  the `mayPay` discard offer (mirrors the engine putting the trigger on the
 *  stack). Mirrors `fireDreadnoughtEtb` (mir/colorless.test.ts). */
function fireFormidableSpeakerEtb(
    state: GameState,
    speaker: CardInstanceState
): void {
    state.stack.push({
        ...speaker,
        zone: "stack",
        castById: speaker.controllerId,
        triggeredAbilityId: "formidable-speaker-etb",
        triggerSourceId: speaker.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: speaker.id,
            controllerId: speaker.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Answers the head `pendingChoices` entry (the `search-library` suspension)
 *  with the given card instance ids (CR 608.2). Mirrors `submitChoice`
 *  (inv/__tests__/helpers.ts). */
function submitSearchChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

/** The ETB may-pay's cost (the discard leg). */
function speakerCost(): MayPayCost {
    const op = formidableSpeaker.triggeredAbilities![0].effects![0] as {
        cost: MayPayCost;
    };
    return op.cost;
}

describe("Formidable Speaker (mayPay discard leg, CR 701.9 / 118.3 / 608.2b, issue #899)", () => {
    it("decline: no card is discarded and no search happens (CR 608.2b)", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "hand-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libraryCreature = makeInstance(GRIZZLY_BEARS_ID, {
            id: "lib-bear",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [speaker],
                    hand: [handCard],
                    library: [libraryCreature],
                }),
                makePlayer("p2"),
            ],
        });
        fireFormidableSpeakerEtb(state, speaker);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        // No stack item / pending choice left; hand and library untouched.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].hand[0]!.id).toBe("hand-card");
        expect(state.players[0].library).toHaveLength(1);
    });

    it("auto-resolve accept (hand has exactly 1 card): discards it, searches, finds the creature", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "only-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libraryCreature = makeInstance(GRIZZLY_BEARS_ID, {
            id: "lib-bear",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [speaker],
                    hand: [handCard],
                    library: [libraryCreature],
                }),
                makePlayer("p2"),
            ],
        });
        fireFormidableSpeakerEtb(state, speaker);
        const head = state.pendingChoices![0];
        // Hand has exactly 1 card (== the discard leg's count) — nothing to
        // choose, no `zone`/`candidateIds` set (Arena UX auto-resolve).
        expect(head.zone).toBeUndefined();
        expect(mayPayDiscardChoiceRequired(state, "p1", head.cost!)).toBe(
            false
        );
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // The lone hand card was discarded (no discardIds needed).
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "only-card")
        ).toBe(true);
        // The search-library choice is now owed.
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        submitSearchChoice(state, ["lib-bear"]);
        // The creature was revealed, moved into hand, and the library
        // shuffled (empty here — only one card was in it).
        expect(state.players[0].hand.some((c) => c.id === "lib-bear")).toBe(
            true
        );
        expect(state.players[0].library).toHaveLength(0);
    });

    it("real choice required (hand has 2 cards): the payer picks which to discard", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cardA = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "card-a",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const cardB = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "card-b",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libraryCreature = makeInstance(GRIZZLY_BEARS_ID, {
            id: "lib-bear",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [speaker],
                    hand: [cardA, cardB],
                    library: [libraryCreature],
                }),
                makePlayer("p2"),
            ],
        });
        fireFormidableSpeakerEtb(state, speaker);
        const head = state.pendingChoices![0];
        // Two hand cards for a leg that discards one — a real choice is owed.
        expect(head.zone).toBe("hand");
        expect(head.candidateIds).toEqual(
            expect.arrayContaining(["card-a", "card-b"])
        );
        expect(mayPayDiscardChoiceRequired(state, "p1", head.cost!)).toBe(true);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            discardIds: ["card-b"],
        });
        // Only card-b was discarded; card-a remains in hand.
        expect(state.players[0].hand.some((c) => c.id === "card-a")).toBe(true);
        expect(state.players[0].hand.some((c) => c.id === "card-b")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "card-b")).toBe(
            true
        );
        submitSearchChoice(state, ["lib-bear"]);
        expect(state.players[0].hand.some((c) => c.id === "lib-bear")).toBe(
            true
        );
    });

    it("submit validation: duplicate / illegal / wrong-count discard picks are rejected", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const cardA = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "card-a",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const cardB = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "card-b",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [speaker],
                    hand: [cardA, cardB],
                    library: [
                        makeInstance(GRIZZLY_BEARS_ID, {
                            id: "lib-bear",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireFormidableSpeakerEtb(state, speaker);
        // Duplicate ids.
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                discardIds: ["card-a", "card-a"],
            })
        ).toThrow();
        // Illegal id (not in hand).
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                discardIds: ["not-a-real-card"],
            })
        ).toThrow();
        // Wrong count (leg discards exactly 1).
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                discardIds: ["card-a", "card-b"],
            })
        ).toThrow();
        // Legal single pick succeeds.
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            discardIds: ["card-a"],
        });
        expect(state.players[0].hand.some((c) => c.id === "card-a")).toBe(
            false
        );
    });

    it("wire format: the discarded card and the found creature survive projection", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "only-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libraryCreature = makeInstance(GRIZZLY_BEARS_ID, {
            id: "lib-bear",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [speaker],
                    hand: [handCard],
                    library: [libraryCreature],
                }),
                makePlayer("p2"),
            ],
        });
        fireFormidableSpeakerEtb(state, speaker);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        submitSearchChoice(state, ["lib-bear"]);
        const projected = projectPublicState(state, 1, "p1");
        const hand = projected.players[0].hand;
        expect(hand.some((c) => c?.id === "lib-bear")).toBe(true);
        expect(
            projected.players[0].graveyard.some((c) => c.id === "only-card")
        ).toBe(true);
    });

    it("canPay / payMayPayCost primitives honour the discard leg (bot minimal default)", () => {
        const handCard = makeInstance(ANCESTRAL_RECALL_ID, {
            id: "only-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [handCard] }), makePlayer("p2")],
        });
        const cost = speakerCost();
        expect(canPayMayPayCost(state, "p1", cost)).toBe(true);
        expect(getMayPayDiscardCandidateIds(state, "p1", cost)).toEqual([
            "only-card",
        ]);
        // No discardIds → bot minimal default: hand-order auto-selection.
        payMayPayCost(state, "p1", cost);
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "only-card")
        ).toBe(true);
    });

    it("canPay is false with an empty hand", () => {
        const state = makeState({
            players: [makePlayer("p1", { hand: [] }), makePlayer("p2")],
        });
        expect(canPayMayPayCost(state, "p1", speakerCost())).toBe(false);
    });
});

describe("Formidable Speaker — {1}, {T}: Untap another target permanent (CR 605 / 701.20b)", () => {
    it('getTargetRequirement excludes the source itself ("another")', () => {
        const req = formidableSpeaker.activatedAbilities![0]
            .getTargetRequirement!({ id: "speaker" } as never, {} as never);
        expect(req.excludeInstanceIds).toEqual(["speaker"]);
    });

    it("untaps a tapped target permanent on resolution", () => {
        const speaker = makeInstance(formidableSpeaker.id, {
            id: "speaker",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const other = makeInstance(GRIZZLY_BEARS_ID, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [speaker, other] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...speaker,
            zone: "stack",
            castById: "p1",
            abilityId: "formidable-speaker-untap",
            targets: [{ type: "permanent", id: "bears" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bears")!.isTapped
        ).toBe(false);
    });
});
