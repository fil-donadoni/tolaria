// Bot-side morph (CR 702.37, issue #2705): the Bot can SEE both halves of the
// mechanic and both halves change the position it evaluates.
//
//   - `enumerateMoves` offers the {3} face-down cast (a `cast-spell` variant
//     carrying the synthesized `alternativeCostId`) and one `turn-face-up`
//     special action per unmorphable permanent.
//   - Both search appliers — the greedy 1-ply sandbox `applyMoveForSearch`
//     (applyMove.ts) and the ISMCTS in-tree `applyMoveInSearch` (search.ts) —
//     put a FACE-DOWN 2/2 on the battlefield for the cast and the REAL card
//     for the turn-up. That is the whole of "Bot valuation" for morph: the
//     evaluator scores the resulting board, so a cast applied as the printed
//     4/5 would price a hidden 2/2 as a 4/5 flier, and a turn-up that did
//     nothing would make the unmorph line invisible.
//   - `PRIORITY_MOVE_KINDS` classifies the new special action, so
//     `getLegalActions` surfaces it in a priority window (ADR 0047) rather
//     than silently dropping it.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName, FACE_DOWN_CARD_ID } from "../../cards";
import { enumerateMoves, SPECIAL_ACTION_MOVE_KINDS } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { legalActions } from "../legalActions";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import { turnFaceDown } from "../faceDown";
import { getEffectivePower } from "../layers";
import type { CardInstanceState, GameState } from "../state";
import type { Move } from "../moves";

const ANGEL = getCardByName("Exalted Angel").id;
const PLAINS = getCardByName("Plains").id;

function plains(n: number, tapped = false): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(PLAINS, {
            id: `plains${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: tapped,
        })
    );
}

/** p1 holds Exalted Angel with `lands` untapped Plains. */
function handBoard(lands: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(ANGEL, {
                        id: "angel",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: plains(lands),
            }),
            makePlayer("p2"),
        ],
    });
}

/** p1 controls a face-down Exalted Angel with `lands` untapped Plains. */
function faceDownBoard(lands: number): GameState {
    const permanent = makeInstance(ANGEL, {
        id: "morphed",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(permanent, "morph");
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [permanent, ...plains(lands)] }),
            makePlayer("p2"),
        ],
    });
}

describe("morph — Bot move enumeration (CR 702.37)", () => {
    it("offers the {3} face-down cast with only three lands (the printed cost is {4}{W}{W})", () => {
        const state = handBoard(3);
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        expect(casts).toHaveLength(1);
        expect(casts[0].alternativeCostId).toBe(MORPH_CAST_ALT_COST_ID);
        expect(casts[0].tapPlan).toHaveLength(3);
        // CR 702.37c — a face-down spell has no text, hence no targets.
        expect(casts[0].targets).toEqual([]);
    });

    it("plans the morph tap against the FACE-DOWN characteristics — Gloom does not tax a colourless face-down spell (CR 702.37c morph / 707.2, issue #2970 review)", () => {
        // Gloom ("White spells cost {3} more to cast") keys on COLOUR, which a
        // face-down spell loses (CR 707.2 — no name, no colour, no subtypes).
        // The enumerator reads the instance, which is still FACE UP in hand at
        // enumeration time, so it must price against the face-down view or it
        // plans a tap for {6} — which three Plains cannot cover, so the Bot
        // stops offering the morph cast at all, exactly when it most wants it.
        const state = handBoard(3);
        state.players[1].battlefield.push(
            makeInstance(getCardByName("Gloom").id, {
                id: "gloom",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        expect(casts).toHaveLength(1);
        expect(casts[0].alternativeCostId).toBe(MORPH_CAST_ALT_COST_ID);
        expect(casts[0].tapPlan).toHaveLength(3);
    });

    it("offers BOTH the printed cast and the face-down cast when both are affordable", () => {
        const state = handBoard(6);
        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        expect(casts.map((c) => c.alternativeCostId).sort()).toEqual([
            MORPH_CAST_ALT_COST_ID,
            undefined,
        ]);
    });

    it("offers one turn-face-up special action per unmorphable permanent", () => {
        const state = faceDownBoard(4);
        const moves = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "turn-face-up"
        );
        expect(moves).toEqual([
            { kind: "turn-face-up", cardInstanceId: "morphed" },
        ]);
    });

    it("offers NO turn-face-up when the morph cost is unaffordable", () => {
        const state = faceDownBoard(3);
        expect(
            enumerateMoves(state, "p1").filter((m) => m.kind === "turn-face-up")
        ).toEqual([]);
    });

    it("is classified as a priority-window action (ADR 0047)", () => {
        expect(SPECIAL_ACTION_MOVE_KINDS.has("turn-face-up")).toBe(true);
        const state = faceDownBoard(4);
        const actions = legalActions(state);
        expect(
            actions.some(
                (a) =>
                    a.expect === "priority" &&
                    a.action.kind === "turn-face-up" &&
                    a.playerId === "p1"
            )
        ).toBe(true);
    });
});

describe("morph — Bot search appliers put the right object on the board", () => {
    const cast: Move = {
        kind: "cast-spell",
        cardInstanceId: "angel",
        alternativeCostId: MORPH_CAST_ALT_COST_ID,
        targets: [],
        confirmTargets: false,
        tapPlan: [],
    };

    it("greedy sandbox (applyMoveForSearch): the morph cast resolves into a FACE-DOWN 2/2", () => {
        const next = applyMoveForSearch(handBoard(3), "p1", cast);
        const permanent = next.players[0].battlefield.find(
            (c) => c.id === "angel"
        )!;
        expect(permanent.faceDown).toBe(true);
        expect((permanent.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(getEffectivePower(next, permanent)).toBe(2);
    });

    it("ISMCTS tree (applyMoveInSearch): the morph cast puts a FACE-DOWN spell on the stack", () => {
        const state = handBoard(3);
        applyMoveInSearch(state, "p1", cast);
        // The spell may already have resolved through the auto-pass drain; find
        // it wherever it is and assert it is face down in either zone.
        const object =
            state.stack.find((s) => s.id === "angel") ??
            state.players[0].battlefield.find((c) => c.id === "angel")!;
        expect(object.faceDown).toBe(true);
        expect((object.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
    });

    it("greedy sandbox: turn-face-up reveals the REAL creature and taps the cost", () => {
        const next = applyMoveForSearch(faceDownBoard(4), "p1", {
            kind: "turn-face-up",
            cardInstanceId: "morphed",
        });
        const permanent = next.players[0].battlefield.find(
            (c) => c.id === "morphed"
        )!;
        expect(permanent.faceDown).toBeUndefined();
        expect(getEffectivePower(next, permanent)).toBe(4);
        expect(
            next.players[0].battlefield.filter(
                (c) => c.id.startsWith("plains") && c.isTapped
            ).length
        ).toBeGreaterThan(0);
        // CR 116 — a special action puts nothing on the stack.
        expect(next.stack).toHaveLength(0);
    });

    it("ISMCTS tree: turn-face-up reveals the REAL creature and keeps priority", () => {
        const state = faceDownBoard(4);
        applyMoveInSearch(state, "p1", {
            kind: "turn-face-up",
            cardInstanceId: "morphed",
        });
        const permanent = state.players[0].battlefield.find(
            (c) => c.id === "morphed"
        )!;
        expect(permanent.faceDown).toBeUndefined();
        expect(getEffectivePower(state, permanent)).toBe(4);
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });
});
