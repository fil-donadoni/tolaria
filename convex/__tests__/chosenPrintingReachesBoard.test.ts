// Card Prints (ADR 0140 §6, issue #4119): the printing a player chose is what
// the board shows. A deck entry's `cardId` is the chosen PRINTING; deck setup
// writes it into the cosmetic `imagePrintId` when it differs from the
// definition's own printing, the renderer prefers it, and the engine never
// reads it (`convex/gre/__tests__/enginePrintBlindness.test.ts`).
//
// Full path: deck → `buildInitialGameState` (the game.ts choke point every
// create/join path shares) → `projectPublicState` → the wire. Then the face-down
// legs: a print id is a Scryfall id, so it names the card underneath as surely
// as `faceDownOf` does, and must be hidden exactly where that is.
import { describe, it, expect } from "vitest";
import { buildInitialGameState, type PlayerInput } from "../game";
import { createInitialGameState } from "../gre/setup";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import { birdsOfParadise2ed } from "../cards/sets/2ed/green.cards";
import { turnFaceDown } from "../gre/faceDown";
import { NO_BOARD_LAYER_VIEW } from "../gre/layers";
import type { CardInstanceState, GameState, StackItem } from "../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";

const BIRDS = birdsOfParadise2ed.definitionId;
const BIRDS_2ED_PRINT = birdsOfParadise2ed.printId;
const MOUNTAIN = getCardByName("Mountain").id;

function seat(id: string, cardIds: string[]): PlayerInput {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: {
            id: `${id}-deck`,
            name: "Deck",
            format: "freeform",
            cards: cardIds.map((cardId) => ({ cardId, cardName: cardId })),
        },
    };
}

/** Every instance a player owns after setup, wherever the opening draw put it. */
function ownedInstances(state: GameState, playerId: string) {
    const p = state.players.find((x) => x.id === playerId)!;
    return [...p.hand, ...p.library];
}

/** Moves p1's Birds onto the battlefield so the projection shows it to both. */
function putBirdsOnBattlefield(state: GameState): CardInstanceState {
    const p1 = state.players[0];
    for (const zone of [p1.hand, p1.library]) {
        const i = zone.findIndex((c) => c.card.id === BIRDS);
        if (i < 0) continue;
        const [birds] = zone.splice(i, 1);
        birds.zone = "battlefield";
        p1.battlefield.push(birds);
        return birds;
    }
    throw new Error("Birds of Paradise not dealt to p1");
}

describe("chosen printing reaches the board (ADR 0140 §6, issue #4119)", () => {
    it("deck setup pins a non-default printing on the instance and nothing on a default one", () => {
        const state = buildInitialGameState([
            seat("p1", [BIRDS_2ED_PRINT, BIRDS, MOUNTAIN]),
            seat("p2", [MOUNTAIN]),
        ]);
        const pins = ownedInstances(state, "p1")
            .map((c) => [c.card.id, c.imagePrintId] as const)
            .sort();
        // The printing resolves to the card's own definition (the engine plays
        // Birds of Paradise), and only the non-default copy carries a pin.
        expect(pins).toEqual(
            [
                [BIRDS, BIRDS_2ED_PRINT],
                [BIRDS, undefined],
                [MOUNTAIN, undefined],
            ].sort()
        );
    });

    it("the self-play / blade setup (gre/setup.ts) pins the same way", () => {
        const state = createInitialGameState(
            [seat("p1", [BIRDS_2ED_PRINT]), seat("p2", [MOUNTAIN])],
            1
        );
        const [birds] = ownedInstances(state, "p1");
        expect(birds.card.id).toBe(BIRDS);
        expect(birds.imagePrintId).toBe(BIRDS_2ED_PRINT);
    });

    it("projectPublicState carries the chosen Print ID on the wire to both players", () => {
        const state = buildInitialGameState([
            seat("p1", [BIRDS_2ED_PRINT]),
            seat("p2", [MOUNTAIN]),
        ]);
        const birds = putBirdsOnBattlefield(state);
        for (const viewer of ["p1", "p2"]) {
            const wire = projectPublicState(state, 1, viewer).players[0]
                .battlefield;
            const slim = wire.find((c) => c.id === birds.id)!;
            expect(slim.card.id).toBe(BIRDS);
            expect(slim.imagePrintId).toBe(BIRDS_2ED_PRINT);
        }
    });
});

describe("a face-down object's printing is hidden like its identity (CR 708.5 / CR 406.3)", () => {
    function pinnedBirds(id: string): CardInstanceState {
        return makeInstance(BIRDS, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            imagePrintId: BIRDS_2ED_PRINT,
        });
    }

    // CR 708.5 — "you may look at ... a face-down permanent you control ...
    // You can't look at ... face-down spells or permanents controlled by
    // another player."
    it("battlefield: the controller sees the chosen printing, the opponent does not", () => {
        const card = pinnedBirds("fd");
        turnFaceDown(NO_BOARD_LAYER_VIEW, card, "morph");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });
        const mine = projectPublicState(state, 1, "p1").players[0]
            .battlefield[0];
        const theirs = projectPublicState(state, 1, "p2").players[0]
            .battlefield[0];
        expect(mine.knownCardId).toBe(BIRDS);
        expect(mine.imagePrintId).toBe(BIRDS_2ED_PRINT);
        expect(theirs.knownCardId).toBeUndefined();
        expect(theirs.imagePrintId).toBeUndefined();
    });

    it("stack: the caster sees the chosen printing, the opponent does not", () => {
        const spell: StackItem = { ...pinnedBirds("fd-spell"), castById: "p1" };
        turnFaceDown(NO_BOARD_LAYER_VIEW, spell, "morph");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            stack: [spell],
        });
        const mine = projectPublicState(state, 1, "p1").stack[0];
        const theirs = projectPublicState(state, 1, "p2").stack[0];
        expect(mine.imagePrintId).toBe(BIRDS_2ED_PRINT);
        expect(theirs.imagePrintId).toBeUndefined();
    });

    // CR 406.3 — a card exiled face down "can't be examined by any player
    // except when instructions allow it".
    it("exile: a player allowed to look sees the chosen printing, anyone else does not", () => {
        const card: CardInstanceState = {
            ...pinnedBirds("fd-exile"),
            zone: "exile",
            knownTo: ["p1"],
            faceDownBy: "face-down-exile",
        };
        const state = makeState({
            players: [makePlayer("p1", { exile: [card] }), makePlayer("p2")],
        });
        const mine = projectPublicState(state, 1, "p1").players[0].exile[0];
        const theirs = projectPublicState(state, 1, "p2").players[0].exile[0];
        expect(mine.imagePrintId).toBe(BIRDS_2ED_PRINT);
        expect(theirs.imagePrintId).toBeUndefined();
    });
});
