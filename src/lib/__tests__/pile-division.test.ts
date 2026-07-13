// Resolving a pile-division choice's ids to face-up cards, INCLUDING through the
// real wire reducer (ADR 0053). The picker renders whatever this returns, so a
// dropped field here is a card that never shows up in the dialog.
import { describe, it, expect } from "vitest";
import { resolvePileDivisionCards } from "~/lib/pile-division";
import { projectPublicState } from "@convex/gameProjections";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "@convex/gre/state";
import type { CardInstance, PendingChoice } from "~/types/game";

function card(
    id: string,
    over: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: "def-" + id, name: id, manaCost: {} },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        ...over,
    };
}

function player(id: string, over: Partial<PlayerState> = {}): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: {},
        ...over,
    };
}

describe("resolvePileDivisionCards (ADR 0053)", () => {
    it("gathers divide candidates from any visible zone", () => {
        const players = [
            {
                battlefield: [
                    { id: "b1", card: { id: "def-b1" } } as CardInstance,
                ],
                libraryPeek: [
                    { id: "l1", card: { id: "def-l1" } } as CardInstance,
                    { id: "l2", card: { id: "def-l2" } } as CardInstance,
                ],
            },
        ];
        const choice = {
            kind: "divide-piles",
            candidateIds: ["l1", "l2", "b1"],
        } as unknown as PendingChoice;
        expect(
            resolvePileDivisionCards(players, choice).map((c) => c.id)
        ).toEqual(["l1", "l2", "b1"]);
    });

    it("gathers pick-pile cards as pileA∪pileB in order", () => {
        const players = [
            {
                libraryPeek: [
                    { id: "l1", card: { id: "def-l1" } } as CardInstance,
                    { id: "l2", card: { id: "def-l2" } } as CardInstance,
                    { id: "l3", card: { id: "def-l3" } } as CardInstance,
                ],
            },
        ];
        const choice = {
            kind: "pick-pile",
            pileA: ["l1"],
            pileB: ["l2", "l3"],
        } as unknown as PendingChoice;
        expect(
            resolvePileDivisionCards(players, choice).map((c) => c.id)
        ).toEqual(["l1", "l2", "l3"]);
    });

    // The SURFACE assertion through the real reducer: a library divide is hidden,
    // so the divider only sees the candidates because `projectPublicState`
    // exposes them as `libraryPeek`. A hand-built player would mask a dropped
    // exposure — this drives the actual wire projection.
    it("resolves divide candidates from the projected (wire) state", () => {
        const state: GameState = {
            players: [
                player("p1", {
                    library: [card("p1-l1"), card("p1-l2"), card("p1-l3")],
                }),
                player("p2"),
            ],
            stack: [],
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            phase: "PRECOMBAT_MAIN",
            rngSeed: 0,
            rngCounter: 0,
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 0,
                    choiceId: "fof:divide",
                    playerId: "p2",
                    zoneOwnerId: "p1",
                    kind: "divide-piles",
                    zone: "library",
                    count: { min: 0, max: 3 },
                    candidateIds: ["p1-l1", "p1-l2", "p1-l3"],
                    prompt: "Divide.",
                },
            ],
        };
        const projected = projectPublicState(state, 1, "p2");
        const cards = resolvePileDivisionCards(
            projected.players,
            projected.pendingChoices![0]
        );
        expect(cards.map((c) => c.card.id)).toEqual([
            "def-p1-l1",
            "def-p1-l2",
            "def-p1-l3",
        ]);
    });
});
