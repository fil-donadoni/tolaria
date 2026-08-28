// Face-down permanents (CR 708.2, ADR 0013) — pieces 1 & 2.
//
// A face-down creature reads as a 2/2 colourless nameless vanilla creature with
// no abilities on fat state, and its true identity is hidden from
// non-controllers across the network projection while the controller keeps it.

import { describe, it, expect } from "vitest";
import { turnFaceDown } from "../faceDown";
import { FACE_DOWN_CARD_ID } from "../../cards";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../layers";
import { effectiveTriggeredAbilities } from "../copy";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { mahamotiDjinn } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

describe("face-down characteristics (CR 708.2)", () => {
    it("reads as a 2/2 colourless creature with no abilities on fat state", () => {
        // Mahamoti Djinn — a blue 5/6 flyer — turned face down.
        const card = makeInstance(mahamotiDjinn.id, {
            id: "fd",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(STATIC_EFFECT_CTX.getColors(card)).toContain("U");

        turnFaceDown(card, "morph");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });

        expect(card.faceDown).toBe(true);
        expect(card.faceDownOf).toBe(mahamotiDjinn.id);
        expect((card.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(getEffectivePower(state, card)).toBe(2);
        expect(getEffectiveToughness(state, card)).toBe(2);
        expect(STATIC_EFFECT_CTX.getColors(card)).toEqual([]); // colourless
        expect(card.types).toEqual(["Creature"]);
        expect(card.subtypes).toEqual([]);
        expect(card.staticAbilities).toEqual([]); // no flying
        expect(effectiveTriggeredAbilities(card)).toEqual([]);
    });
});

describe("face-down hidden identity in projection (ADR 0013)", () => {
    function faceDownState() {
        const mine = makeInstance(mahamotiDjinn.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(mahamotiDjinn.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        turnFaceDown(mine, "morph");
        turnFaceDown(theirs, "morph");
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
    }

    it("card.card.id stays the sentinel for EVERY viewer; knownCardId carries the controller's identification affordance (issue #1735)", () => {
        const state = faceDownState();

        // p1's view: `card.card.id` is the sentinel even for p1's OWN
        // face-down permanent (CR 708.2 — the game object has no real
        // identity while face down, for id-derived rules reads). p1 still
        // gets `knownCardId` on their own permanent, purely for the UI
        // affordance; p2's permanent carries neither for p1.
        const p1View = projectPublicState(state, 1, "p1");
        const p1Own = p1View.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        const p1Opp = p1View.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(p1Own.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(p1Own.knownCardId).toBe(mahamotiDjinn.id);
        expect(p1Opp.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(p1Opp.knownCardId).toBeUndefined();
        // The real id must NOT leak through faceDownOf on the opponent's card.
        expect((p1Opp as { faceDownOf?: string }).faceDownOf).toBeUndefined();

        // p2's view: mirror image.
        const p2View = projectPublicState(state, 1, "p2");
        const p2Own = p2View.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        const p2Opp = p2View.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(p2Own.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(p2Own.knownCardId).toBe(mahamotiDjinn.id);
        expect(p2Opp.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(p2Opp.knownCardId).toBeUndefined();
        expect((p2Opp as { faceDownOf?: string }).faceDownOf).toBeUndefined();
    });

    it("hides nothing else — non-identity fields survive for both viewers", () => {
        const state = faceDownState();
        state.players[1].battlefield[0].isTapped = true;

        const p1View = projectPublicState(state, 1, "p1");
        const oppCard = p1View.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(oppCard.isTapped).toBe(true);
        expect(oppCard.faceDown).toBe(true);
        expect(oppCard.power).toBe(2);
        expect(oppCard.toughness).toBe(2);
    });
});

describe("face-down serialize round-trip", () => {
    it("preserves faceDown, faceDownOf and the sentinel id", () => {
        const card = makeInstance(mahamotiDjinn.id, {
            id: "fd",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(card, "morph");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });

        const restored = expandState(compactState(state));
        const got = restored.players[0].battlefield.find((c) => c.id === "fd")!;
        expect(got.faceDown).toBe(true);
        expect(got.faceDownOf).toBe(mahamotiDjinn.id);
        expect((got.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(got.power).toBe(2);
        expect(got.toughness).toBe(2);
    });
});
