import { describe, expect, it, beforeEach } from "vitest";
import {
    comboScore,
    registerCombo,
    clearComboRegistry,
    type ComboAnnotation,
} from "../comboAnnotations";
import type { GameState, PlayerState, CardInstanceState } from "../../state";

function makeCard(
    id: string,
    controllerId: string,
    opts?: {
        tapped?: boolean;
        zone?: "battlefield" | "hand";
    }
): CardInstanceState {
    return {
        id: `instance-${id.slice(0, 8)}`,
        card: { id },
        controllerId,
        ownerId: controllerId,
        zone: opts?.zone ?? "battlefield",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: opts?.tapped ?? false,
    } as unknown as CardInstanceState;
}

function makePlayer(
    id: string,
    battlefield: CardInstanceState[],
    hand: CardInstanceState[]
): PlayerState {
    return {
        id,
        life: 20,
        battlefield,
        hand,
        library: [],
        graveyard: [],
        exile: [],
        manaPool: {},
        landsPlayedThisTurn: 0,
    } as unknown as PlayerState;
}

describe("comboScore", () => {
    const EXARCH_ID = "1f123ad6-fe84-4fed-9c0f-6b41921e9c26";
    const TWIN_ID = "2f8f22fb-7291-4517-9b15-e98501f2856b";

    beforeEach(() => {
        clearComboRegistry();
    });

    const testCombo: ComboAnnotation = {
        id: "test-twin",
        name: "Test Twin Combo",
        pieces: [
            {
                cardId: EXARCH_ID,
                zone: "battlefield",
                controller: "you",
                untapped: true,
            },
            { cardId: TWIN_ID, zone: "any" },
        ],
        stages: [
            { piecesOnBoard: 1, boost: 200 },
            { piecesOnBoard: 2, boost: 5000 },
        ],
    };

    it("returns 0 with no pieces", () => {
        registerCombo(testCombo);
        const state = {
            players: [makePlayer("p1", [], []), makePlayer("p2", [], [])],
        } as unknown as GameState;
        expect(comboScore(state, "p1")).toBe(0);
    });

    it("returns stage 1 boost with one piece on battlefield", () => {
        registerCombo(testCombo);
        const state = {
            players: [
                makePlayer("p1", [makeCard(EXARCH_ID, "p1")], []),
                makePlayer("p2", [], []),
            ],
        } as unknown as GameState;
        expect(comboScore(state, "p1")).toBe(200);
    });

    it("returns stage 1 boost with both pieces when one is in hand (not on board)", () => {
        registerCombo(testCombo);
        const state = {
            players: [
                makePlayer(
                    "p1",
                    [makeCard(EXARCH_ID, "p1")],
                    [makeCard(TWIN_ID, "p1", { zone: "hand" })]
                ),
                makePlayer("p2", [], []),
            ],
        } as unknown as GameState;
        expect(comboScore(state, "p1")).toBe(200);
    });

    it("returns stage 2 boost with both pieces on battlefield", () => {
        registerCombo(testCombo);
        const state = {
            players: [
                makePlayer(
                    "p1",
                    [makeCard(EXARCH_ID, "p1"), makeCard(TWIN_ID, "p1")],
                    []
                ),
                makePlayer("p2", [], []),
            ],
        } as unknown as GameState;
        expect(comboScore(state, "p1")).toBe(5000);
    });

    it("returns 0 when Exarch is tapped and Twin is in hand", () => {
        registerCombo(testCombo);
        const state = {
            players: [
                makePlayer(
                    "p1",
                    [makeCard(EXARCH_ID, "p1", { tapped: true })],
                    [makeCard(TWIN_ID, "p1", { zone: "hand" })]
                ),
                makePlayer("p2", [], []),
            ],
        } as unknown as GameState;
        expect(comboScore(state, "p1")).toBe(0);
    });
});
