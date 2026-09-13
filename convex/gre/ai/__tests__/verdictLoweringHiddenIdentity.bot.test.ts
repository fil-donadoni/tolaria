// The verdict lowering on a board holding a face-down object (issue #3554,
// CR 406.3 / 708.2): captured under its real identity when the position
// carries it, refused as `lowering-threw` — never `rebuild-threw` — when it
// does not.

import { describe, expect, it } from "vitest";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import { describeMove } from "../../describeMove";
import { FACE_DOWN_CARD_ID } from "../../../cards";
import type { CardInstanceState, GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

const OPP_HIDEAWAY_EXILE: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        {
            name: "Grizzly Bears",
            owner: "opp",
            zone: "exile",
            faceDownExile: true,
        },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

function chosen(state: GameState, botId: string): string {
    return describeMove(candidateMoves(state, botId)[0], state);
}

describe("verdict lowering — a face-down card in exile (issue #3554, CR 406.3)", () => {
    it("lowers it under its real identity and rebuilds the same candidate list", () => {
        const state = buildVerdictPosition(OPP_HIDEAWAY_EXILE);
        const botId = state.players[0].id;
        expect(candidateMoves(state, botId).length).toBeGreaterThan(1);

        const outcome = lowerDecision(state, botId, chosen(state, botId));

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.lowered.spec.cards).toContainEqual(
            expect.objectContaining({
                name: "Grizzly Bears",
                owner: "opp",
                zone: "exile",
                faceDownExile: true,
            })
        );
        expect(outcome.lowered.candidates).toHaveLength(
            candidateMoves(state, botId).length
        );
    });

    it("refuses as lowering-threw, naming the object and its zone, when only the sentinel is left", () => {
        const state = buildVerdictPosition(OPP_HIDEAWAY_EXILE);
        const botId = state.players[0].id;
        const description = chosen(state, botId);
        // The seat that may not look — what `projectExileCard` gives it.
        const exiled = state.players[1].exile[0];
        exiled.card = { id: FACE_DOWN_CARD_ID } as CardInstanceState["card"];
        delete exiled.knownTo;

        const outcome = lowerDecision(state, botId, description);

        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("lowering-threw");
        expect(outcome.error).toContain("a face-down card (opp, exile)");
        expect(outcome.error).not.toContain("\n");
        expect(Array.isArray(outcome.dropped)).toBe(true);
        expect(
            outcome.dropped.some((note) => note.startsWith("hidden identity:"))
        ).toBe(true);
    });
});
