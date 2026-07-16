import { describe, it, expect } from "vitest";
import {
    columnDropId,
    resolveDraftDragAction,
    SIDEBOARD_DROP_ID,
    type BoosterDragData,
    type PoolDragData,
} from "../limitedDraftDrag";

const booster: BoosterDragData = {
    kind: "booster",
    pickId: "r0-p0-c1",
    cardId: "bolt",
    cardName: "Lightning Bolt",
};
const poolCard: PoolDragData = {
    kind: "pool",
    poolIndex: 3,
    cardId: "bolt",
    cardName: "Lightning Bolt",
};

describe("resolveDraftDragAction (ADR 0060, issue #1248)", () => {
    it("returns null for a cancelled/incomplete drop (missing data or target)", () => {
        expect(resolveDraftDragAction(undefined, SIDEBOARD_DROP_ID)).toBeNull();
        expect(resolveDraftDragAction(booster, undefined)).toBeNull();
    });

    it("Booster → Sideboard resolves to commitPick targeting the sideboard", () => {
        const action = resolveDraftDragAction(booster, SIDEBOARD_DROP_ID);
        expect(action).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            target: { kind: "sideboard" },
        });
    });

    it("Booster → a Pool column resolves to commitPick targeting that exact column", () => {
        const action = resolveDraftDragAction(booster, columnDropId(3));
        expect(action).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            target: { kind: "column", column: 3 },
        });
    });

    it("Booster → the Lands pile is a no-op (Lands is display-only, never a column-override target)", () => {
        expect(resolveDraftDragAction(booster, columnDropId(null))).toBeNull();
    });

    it("Pool card → Sideboard resolves to moveArrangement with sideboard: true", () => {
        const action = resolveDraftDragAction(poolCard, SIDEBOARD_DROP_ID);
        expect(action).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            target: { kind: "sideboard" },
        });
    });

    it("Pool card → a different Mana-Value column resolves to moveArrangement naming that column", () => {
        const action = resolveDraftDragAction(poolCard, columnDropId(5));
        expect(action).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            target: { kind: "column", column: 5 },
        });
    });

    it("an unrecognized drop-target id is a no-op", () => {
        expect(resolveDraftDragAction(booster, "some-unrelated-zone")).toBeNull();
    });
});

describe("columnDropId", () => {
    it("is stable and round-trips through the resolver for every fixed column", () => {
        for (let n = 0; n <= 7; n++) {
            const action = resolveDraftDragAction(poolCard, columnDropId(n));
            expect(action).toEqual({
                type: "moveArrangement",
                poolIndex: 3,
                target: { kind: "column", column: n },
            });
        }
    });

    it("the Lands column id is distinct from every numbered column id", () => {
        const ids = new Set([
            columnDropId(null),
            ...Array.from({ length: 8 }, (_, n) => columnDropId(n)),
        ]);
        expect(ids.size).toBe(9);
    });
});
