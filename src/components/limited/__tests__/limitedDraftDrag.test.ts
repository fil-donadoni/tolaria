// Pure drop resolution for the draft table (ADR 0060 issue #1248, re-based on
// the shared zone surface by issue #1632).
//
// Every drop-target id here is minted by the SHARED helpers
// (`zoneColumnDropId` / `zonePaneDropId`) rather than written by hand — that
// is what makes these assertions prove the draft and the deckbuilder agree on
// the id vocabulary, instead of proving this file agrees with itself. The
// pre-#1632 `pool-col-N` ids and their parser are gone; a leftover one must
// resolve to nothing.
import { describe, it, expect } from "vitest";
import {
    zoneColumnDropId,
    zonePaneDropId,
} from "~/components/deckbuilder/deckZoneDrag";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import {
    poolArrangementPatch,
    resolveDraftDragAction,
    type BoosterDragData,
} from "../limitedDraftDrag";

const booster: BoosterDragData = {
    kind: "booster",
    pickId: "r0-p0-c1",
    cardId: "bolt",
    cardName: "Lightning Bolt",
};
/** An already-picked Pool tile, exactly as `DeckZoneSurface` mints it: the
 *  shared `CardDragData`, whose `pinKey` is the Pool copy's `poolIndex`. */
const poolCard: CardDragData = {
    kind: "main",
    cardId: "bolt",
    cardName: "Lightning Bolt",
    pinKey: "3",
};

const SIDEBOARD = zonePaneDropId("sideboard");
const mvColumn = (n: number) => zoneColumnDropId("maindeck", `mv:${n}`);

describe("resolveDraftDragAction (ADR 0060 issue #1248; shared ids, issue #1632)", () => {
    it("returns null for a cancelled/incomplete drop (missing data or target)", () => {
        expect(resolveDraftDragAction(undefined, SIDEBOARD)).toBeNull();
        expect(resolveDraftDragAction(booster, undefined)).toBeNull();
    });

    it("Booster → Sideboard resolves to commitPick targeting the sideboard", () => {
        expect(resolveDraftDragAction(booster, SIDEBOARD)).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            sideboard: true,
            columnId: null,
        });
    });

    it("Booster → a Pool Column resolves to commitPick naming that exact Column", () => {
        expect(resolveDraftDragAction(booster, mvColumn(3))).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            sideboard: false,
            columnId: "mv:3",
        });
    });

    it("Booster → the Lands pile resolves to commitPick naming the Lands Column (issue #1573)", () => {
        const dest = zoneColumnDropId("maindeck", "mv:lands");
        expect(resolveDraftDragAction(booster, dest)).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            sideboard: false,
            columnId: "mv:lands",
        });
    });

    it("Booster → a colour Column resolves to that Column — the Grouping the draft bar offers is a real drop target (issue #1632)", () => {
        const dest = zoneColumnDropId("maindeck", "color:R");
        expect(resolveDraftDragAction(booster, dest)).toEqual({
            type: "commitPick",
            pickId: "r0-p0-c1",
            sideboard: false,
            columnId: "color:R",
        });
    });

    it("Pool card → Sideboard resolves to moveArrangement with sideboard: true", () => {
        expect(resolveDraftDragAction(poolCard, SIDEBOARD)).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            sideboard: true,
            columnId: null,
        });
    });

    it("Pool card → a different Column resolves to moveArrangement naming that Column", () => {
        expect(resolveDraftDragAction(poolCard, mvColumn(5))).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            sideboard: false,
            columnId: "mv:5",
        });
    });

    it("Pool card → back to a Mana-Value Column from Lands resolves symmetrically", () => {
        expect(resolveDraftDragAction(poolCard, mvColumn(2))).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            sideboard: false,
            columnId: "mv:2",
        });
    });

    it("a Sideboard tile dragged back into a Pool Column moves it AND names the Column", () => {
        const fromSideboard: CardDragData = { ...poolCard, kind: "side" };
        expect(resolveDraftDragAction(fromSideboard, mvColumn(1))).toEqual({
            type: "moveArrangement",
            poolIndex: 3,
            sideboard: false,
            columnId: "mv:1",
        });
    });

    it("a Pool tile carrying no per-copy pin key is a no-op — there is no Pool copy to arrange", () => {
        const keyless: CardDragData = {
            kind: "main",
            cardId: "bolt",
            cardName: "Lightning Bolt",
        };
        expect(resolveDraftDragAction(keyless, mvColumn(1))).toBeNull();
        const nonNumeric: CardDragData = { ...poolCard, pinKey: "bolt" };
        expect(resolveDraftDragAction(nonNumeric, mvColumn(1))).toBeNull();
    });

    it("an unrecognized drop-target id is a no-op", () => {
        expect(
            resolveDraftDragAction(booster, "some-unrelated-zone")
        ).toBeNull();
    });

    it("the retired pre-#1632 `pool-col-N` ids resolve to nothing", () => {
        expect(resolveDraftDragAction(booster, "pool-col-3")).toBeNull();
        expect(resolveDraftDragAction(poolCard, "pool-sideboard")).toBeNull();
    });

    it("every Mana-Value Column id round-trips through the resolver, and each is distinct", () => {
        const ids = new Set<string>();
        for (let n = 0; n <= 7; n++) {
            ids.add(mvColumn(n));
            expect(resolveDraftDragAction(poolCard, mvColumn(n))).toEqual({
                type: "moveArrangement",
                poolIndex: 3,
                sideboard: false,
                columnId: `mv:${n}`,
            });
        }
        ids.add(zoneColumnDropId("maindeck", "mv:lands"));
        expect(ids.size).toBe(9);
    });
});

describe("poolArrangementPatch (issue #1632)", () => {
    it("sends the Column id whole for a real pin target", () => {
        expect(poolArrangementPatch(2, false, "color:R")).toEqual({
            poolIndex: 2,
            sideboard: false,
            column: "color:R",
        });
    });

    it("omits `column` entirely for a Column that is not a pin target", () => {
        // The Catch-All and Grouping `none`'s single Column carry no
        // namespace; the engine records nothing for them, so nothing is sent.
        expect(poolArrangementPatch(2, false, "catch-all")).toEqual({
            poolIndex: 2,
            sideboard: false,
        });
        expect(poolArrangementPatch(2, false, "all")).toEqual({
            poolIndex: 2,
            sideboard: false,
        });
    });

    it("omits `column` for a whole-pane drop, and still carries the Zone", () => {
        expect(poolArrangementPatch(4, true, null)).toEqual({
            poolIndex: 4,
            sideboard: true,
        });
    });
});
