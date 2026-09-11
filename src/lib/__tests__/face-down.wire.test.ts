// The face-down display census on the wire (issue #2904).
//
// Everything here runs through the REAL reducer (`projectPublicState`), per
// `.claude/rules/gre-development.md` § Frontend wiring analysis: the client's
// whole face-down behaviour is now driven by two PROJECTED fields (`faceDown`,
// `faceDownBy`), and a hand-built view would prove nothing about whether the
// projection actually carries them.
import { describe, it, expect } from "vitest";
import { makeState, makeInstance } from "@convex/cards/__tests__/setup";
import { getCardByName, FACE_DOWN_CARD_ID } from "@convex/cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { exileFaceDownCard, moveCard } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstance } from "~/types/game";
import { getCardImageDefId } from "~/lib/card-image-signature";
import {
    faceDownProducer,
    faceDownRealCardId,
    isFaceDownCard,
    resolveFaceDownFace,
    GENERIC_CARD_BACK_SRC,
} from "~/lib/face-down";
import { NO_BOARD_LAYER_VIEW } from "../../../convex/gre/layers";

const SERRA = getCardByName("Serra Angel");

function stateWith(over: {
    battlefield?: ReturnType<typeof makeInstance>[];
    library?: ReturnType<typeof makeInstance>[];
}) {
    const base = makeState();
    return makeState({
        players: [
            {
                ...base.players[0],
                id: "p1",
                battlefield: over.battlefield ?? [],
                library: over.library ?? [],
            },
            base.players[1],
        ],
    });
}

describe("face-down permanent on the wire (CR 708.2 / 708.5)", () => {
    function project(viewerId: "p1" | "p2") {
        const morph = makeInstance(SERRA.id, {
            id: "fd-serra",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, morph, "morph");
        const projected = projectPublicState(
            stateWith({ battlefield: [morph] }),
            1,
            viewerId
        );
        return projected.players[0].battlefield[0] as CardInstance;
    }

    it("carries the producer marker to BOTH viewers, and the rules id stays the sentinel for both", () => {
        for (const viewer of ["p1", "p2"] as const) {
            const slim = project(viewer);
            expect(slim.card.id).toBe(FACE_DOWN_CARD_ID);
            expect(slim.faceDown).toBe(true);
            // Which MECHANIC hid it is public — an opponent watching a morph
            // cast saw it happen — and it is the sole input to the face.
            expect(faceDownProducer(slim)).toBe("morph");
            expect(isFaceDownCard(slim)).toBe(true);
            expect(getCardImageDefId(slim)).toBe(FACE_DOWN_CARD_ID);
        }
    });

    it("hands the real id ONLY to the entitled viewer, in no field for anyone else", () => {
        expect(faceDownRealCardId(project("p1"))).toBe(SERRA.id);

        const opponent = project("p2");
        expect(faceDownRealCardId(opponent)).toBeUndefined();
        // Stronger than the helper: the real id is nowhere in the payload.
        expect(JSON.stringify(opponent)).not.toContain(SERRA.id);
    });
});

describe("face-down exile on the wire (CR 406.3)", () => {
    function project(viewerId: "p1" | "p2") {
        const card = makeInstance(SERRA.id, {
            id: "fd-exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = stateWith({ library: [card] });
        exileFaceDownCard(
            state.players[0],
            "fd-exiled",
            "library",
            "p1",
            "face-down-exile"
        );
        const projected = projectPublicState(state, 1, viewerId);
        return projected.players[0].exile[0] as CardInstance;
    }

    it("gives the ENTITLED viewer an explicit face-down marker, not an inference from an absence", () => {
        const slim = project("p1");
        expect(slim.faceDown).toBe(true);
        expect(faceDownProducer(slim)).toBe("face-down-exile");
        // CR 406.3a lets the knower PLAY the card, so the real id stays on the
        // wire for them — the marker above is what stops it from painting.
        expect(slim.card.id).toBe(SERRA.id);
        expect(isFaceDownCard(slim)).toBe(true);
        expect(getCardImageDefId(slim)).toBe(FACE_DOWN_CARD_ID);
        expect(faceDownRealCardId(slim)).toBe(SERRA.id);
    });

    it("gives every other viewer the sentinel, the same marker, and no real id anywhere", () => {
        const slim = project("p2");
        expect(slim.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(slim.faceDown).toBe(true);
        expect(faceDownProducer(slim)).toBe("face-down-exile");
        expect(faceDownRealCardId(slim)).toBeUndefined();
        expect(JSON.stringify(slim)).not.toContain(SERRA.id);
    });

    it("a FACE-UP exiled card is untouched — no marker, real art", () => {
        const card = makeInstance(SERRA.id, {
            id: "up-exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
        });
        const base = makeState();
        const state = makeState({
            players: [
                { ...base.players[0], id: "p1", exile: [card] },
                base.players[1],
            ],
        });
        const slim = projectPublicState(state, 1, "p2").players[0]
            .exile[0] as CardInstance;
        expect(slim.faceDown).toBeUndefined();
        expect(isFaceDownCard(slim)).toBe(false);
        expect(getCardImageDefId(slim)).toBe(SERRA.id);
    });
});

// issue #3001 — the impulse idiom ("exile the top card of your library; you
// may play that card this turn") names no face-down exile, so CR 406.3's first
// sentence leaves the card FACE UP and examinable by ANY player. It no longer
// touches the face-down primitive at all: it reaches exile through the
// ordinary zone-mover, which clears per-viewer knowledge on entry to a public
// zone, so nothing stamps a producer and both viewers get the real card.
describe("an impulse exile is face up to BOTH players (CR 406.3, issue #3001)", () => {
    function project(viewerId: "p1" | "p2") {
        const card = makeInstance(SERRA.id, {
            id: "imp-exiled",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
            // A live look-grant from an earlier scry / surveil: the controller
            // alone knew this top card. Entering the public zone must clear
            // it, or the stale grant would re-create the bug.
            knownTo: ["p1"],
        });
        const state = stateWith({ library: [card] });
        moveCard(state.players[0], "imp-exiled", "library", "exile");
        const projected = projectPublicState(state, 1, viewerId);
        return projected.players[0].exile[0] as CardInstance;
    }

    it("shows the controller the real card, unmarked", () => {
        const slim = project("p1");
        expect(slim.faceDown).toBeUndefined();
        expect(faceDownProducer(slim)).toBeUndefined();
        expect(isFaceDownCard(slim)).toBe(false);
        expect(getCardImageDefId(slim)).toBe(SERRA.id);
    });

    it("shows the OPPONENT the real card too — no sentinel, no marker", () => {
        const slim = project("p2");
        expect(slim.card.id).toBe(SERRA.id);
        expect(slim.faceDown).toBeUndefined();
        expect(faceDownProducer(slim)).toBeUndefined();
        expect(isFaceDownCard(slim)).toBe(false);
        expect(getCardImageDefId(slim)).toBe(SERRA.id);
    });
});

// Review finding 2 — the Manual Board (ADR 0080) has its OWN face-down path
// with its own sentinel and sets the same `faceDown` flag. It is out of scope
// for #2904, so it must not be swept into the GRE's producer-keyed rendering:
// before the guard, `faceDownRealCardId` returned the manual sentinel itself
// and the preview grew a second face labelled "Actual card" naming `__faceDown`.
describe("a foreign face-down subsystem is not adopted (Manual Board, ADR 0080)", () => {
    const manualFaceDown = {
        id: "manual-1",
        card: { id: "__faceDown" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        faceDown: true,
    } as unknown as CardInstance;

    it("is not treated as face down, and yields no second preview face", () => {
        expect(isFaceDownCard(manualFaceDown)).toBe(false);
        expect(faceDownRealCardId(manualFaceDown)).toBeUndefined();
        expect(getCardImageDefId(manualFaceDown)).toBe("__faceDown");
    });
});

describe("producer → face resolver (issue #2904)", () => {
    it("resolves every censused producer, and falls back for an absent one", () => {
        // The table is a total Record over `FaceDownProducer`, so this list is
        // the census itself — a new producer that forgot its row would not
        // compile, and one that resolved to nothing would fail here.
        for (const producer of [
            "morph",
            "cast-face-down",
            "face-down-exile",
        ] as const) {
            expect(resolveFaceDownFace(producer)).toEqual({
                kind: "back",
                src: GENERIC_CARD_BACK_SRC,
            });
        }
        expect(resolveFaceDownFace(undefined)).toEqual({
            kind: "back",
            src: GENERIC_CARD_BACK_SRC,
        });
    });
});
