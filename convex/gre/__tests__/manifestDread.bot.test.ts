// Manifest dread (CR 701.62, issue #2072) — the Bot seam: `enumerateMoves`
// reaches the CR 701.40b / 116.2b turn-face-up special action and Abhorrent
// Oculus's cast, and `applyMoveForSearch` pays them as the mutation would
// (CR 601.2f / 118.8 — the six graveyard exiles). The GRE, wire and
// serialization suites are `manifestDread.test.ts`.

import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import {
    BEARS,
    FOREST,
    manifestedBoard,
    oculusBoard,
} from "./manifestDread.helper";

describe("manifest dread — the Bot's moves (CR 701.40b / 116.2b, 601.2f)", () => {
    it("the Bot enumerates the special action and the search applies it", () => {
        const { state } = manifestedBoard(BEARS, FOREST, 2);
        state.priorityPlayerId = "p1";
        const moves = enumerateMoves(state, "p1");
        const move = moves.find((m) => m.kind === "turn-face-up");
        expect(move).toEqual({
            kind: "turn-face-up",
            cardInstanceId: "manifested",
        });
        const next = applyMoveForSearch(state, "p1", move!);
        const after = next.players[0].battlefield.find(
            (c) => c.id === "manifested"
        )!;
        expect(after.faceDown).toBeUndefined();
    });

    it("the Bot's cast Move charges the six exiles in the search", () => {
        const state = oculusBoard(7);
        state.priorityPlayerId = "p1";
        const cast = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "oculus"
        );
        expect(cast).toBeDefined();
        const next = applyMoveForSearch(state, "p1", cast!);
        expect(next.players[0].graveyard).toHaveLength(1);
        expect(next.players[0].exile).toHaveLength(6);
    });
});
