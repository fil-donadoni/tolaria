// CR 603.3c / 603.3d — the `cast-spell` leaf of `applyMoveForSearch` drains the
// stack back to its pre-cast depth, but a trigger the cast put on the stack that
// is still being announced is not resolvable yet. The drain stops on it, so the
// leaf hands back a position the real resolvers can still answer.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyMoveForSearch } from "../applyMove";
import { cloneGameState } from "../clone";
import { enumerateMoves } from "../moves";
import { applyMoveInSearch } from "../search";
import type { GameState } from "../state";

const BOT = "p1";
const OPP = "p2";

/** `cardName` in the Bot's hand with `lands` to pay for it, and a creature on
 *  each side so every mode and target requirement has a legal candidate. */
function poseCast(cardName: string, landName: string, lands: number) {
    const card = makeInstance(getCardByName(cardName).id, {
        id: "cast-me",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const land = getCardByName(landName).id;
    const bears = getCardByName("Grizzly Bears").id;
    const state = makeState({
        players: [
            makePlayer(BOT, {
                hand: [card],
                battlefield: [
                    ...Array.from({ length: lands }, (_, i) =>
                        makeInstance(land, {
                            id: `land${i}`,
                            controllerId: BOT,
                        })
                    ),
                    makeInstance(bears, { id: "own", controllerId: BOT }),
                ],
            }),
            makePlayer(OPP, {
                battlefield: [
                    makeInstance(bears, { id: "theirs", controllerId: OPP }),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
    });
    return state;
}

function castOpening(state: GameState): GameState {
    const move = enumerateMoves(state, BOT).find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "cast-me"
    );
    expect(move).toBeDefined();
    return applyMoveForSearch(state, BOT, move!);
}

describe("applyMoveForSearch — the cast drain stops on an announcement (CR 603.3c, 603.3d)", () => {
    it("leaves a modal enters trigger on the stack with its mode choice answerable", () => {
        const after = castOpening(poseCast("Deceiver Exarch", "Island", 3));

        const head = after.pendingChoices?.[0];
        expect(head?.kind).toBe("trigger-mode");
        expect(after.stack.map((item) => item.id)).toContain(head!.stackItemId);

        // The real resolver the ISMCTS applier drives: it used to throw on a
        // choice naming a stack item the drain had already resolved.
        const answer = enumerateMoves(after, BOT).find(
            (m) => m.kind === "resolution-choice"
        );
        expect(answer).toBeDefined();
        const answered = cloneGameState(after);
        applyMoveInSearch(answered, BOT, answer!);
        expect(answered.pendingChoices?.[0]?.kind).not.toBe("trigger-mode");
    });

    it("leaves a targeted enters trigger on the stack until its target is announced", () => {
        const after = castOpening(poseCast("Man-o'-War", "Island", 3));

        expect(after.pendingTarget?.kind).toBe("trigger");
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0]!.id).toBe(after.pendingTarget!.cardInstanceId);
    });
});
