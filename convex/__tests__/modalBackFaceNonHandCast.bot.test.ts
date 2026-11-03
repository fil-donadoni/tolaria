// The Bot's reach for a modal double-faced card's BACK face cast from a zone
// other than the hand (CR 712.11c, issue #7398): `enumerateMoves` offers the
// back face exactly where the licence reaches it — a generic permission —
// and never under an ability of the front face, which `announceCast` refuses
// (the #2283/#2284 freeze shape). Same boards as the engine suite
// (`modalBackFaceNonHandCast.test.ts`).

import { describe, expect, it } from "vitest";
import { tryGetDefinition } from "../cards";
import { modalBackCastAltCostId } from "../gre/modalBackCast";
import { enumerateMoves } from "../gre/moves";
import {
    FRONT_FACE,
    GENERIC,
    position,
} from "./modalBackNonHandPositions.fixture";

const backFaceMoves = (cardId: string, state: ReturnType<typeof position>) => {
    const backAlt = modalBackCastAltCostId(tryGetDefinition(cardId)!);
    return enumerateMoves(state, "p1").filter(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "mdfc" &&
            m.alternativeCostId === backAlt
    );
};

const frontFaceMoves = (state: ReturnType<typeof position>) =>
    enumerateMoves(state, "p1").filter(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "mdfc" &&
            m.alternativeCostId === undefined
    );

describe("CR 712.11c — the Bot enumerates a non-hand back-face cast", () => {
    it.each(GENERIC)("$name: the back face is a Move", ({ cardId, place }) => {
        expect(
            backFaceMoves(cardId, position(cardId, place)).length
        ).toBeGreaterThan(0);
    });

    it.each(FRONT_FACE)(
        "$name: the back face is never a Move, the front face is",
        ({ cardId, place }) => {
            const state = position(cardId, place, "p1");
            expect(backFaceMoves(cardId, state)).toEqual([]);
            // The discriminating half: the licence is enumerated at all.
            expect(frontFaceMoves(state).length).toBeGreaterThan(0);
        }
    );
});
