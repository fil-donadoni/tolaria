import { describe, it, expect } from "vitest";
import { buildHandModel, isSeenByOpponent } from "../hand-knowledge";
import type { CardInstance } from "~/types/game";

// ADR 0026 / PRD #338 (slice 3) — pure render-model helpers map a projected
// hand to per-card face-up + eye-flag state. No game logic; identity gating and
// the `seenByOpponent` flag are computed server-side.

function handCard(id: string, seenByOpponent?: boolean): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        isTapped: false,
        ...(seenByOpponent ? { seenByOpponent: true } : {}),
    };
}

describe("isSeenByOpponent", () => {
    it("is true only when the flag is set", () => {
        expect(isSeenByOpponent(handCard("a", true))).toBe(true);
        expect(isSeenByOpponent(handCard("a"))).toBe(false);
        expect(isSeenByOpponent(null)).toBe(false);
    });
});

describe("buildHandModel — own hand", () => {
    it("renders every own card face-up", () => {
        const model = buildHandModel([handCard("a"), handCard("b")], true);
        expect(model.map((s) => s.faceUp)).toEqual([true, true]);
        expect(model.map((s) => s.index)).toEqual([0, 1]);
    });

    it("flags the eye icon per-card, only on cards an opponent knows", () => {
        const model = buildHandModel(
            [handCard("a"), handCard("b", true), handCard("c")],
            true
        );
        // Eye flag set only on the specific known card — never the whole hand.
        expect(model.map((s) => s.seenByOpponent)).toEqual([
            false,
            true,
            false,
        ]);
    });
});

describe("buildHandModel — opponent hand", () => {
    it("renders known slots face-up and null slots as backs, length preserved", () => {
        // The projection gives the viewer a known card in slot 1, nulls elsewhere.
        const hand: (CardInstance | null)[] = [null, handCard("known"), null];
        const model = buildHandModel(hand, false);
        expect(model).toHaveLength(3);
        expect(model.map((s) => s.faceUp)).toEqual([false, true, false]);
        expect(model[1].card?.id).toBe("known");
        // The eye icon is an own-hand affordance — never set on the opponent's
        // hand even for a known card.
        expect(model.every((s) => s.seenByOpponent === false)).toBe(true);
    });

    it("renders an all-hidden opponent hand as all backs", () => {
        const model = buildHandModel([null, null], false);
        expect(model.map((s) => s.faceUp)).toEqual([false, false]);
        expect(model.map((s) => s.card)).toEqual([null, null]);
    });
});
