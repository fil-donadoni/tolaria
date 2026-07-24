// Limited deckbuilder column-drag resolution (issue #1575) — column-level
// drag parity with the draft Pool. Pure resolver, unit-tested by constructing
// the drag source/target directly (the same convention as
// `limitedDraftDrag.test.ts`).
import { describe, it, expect } from "vitest";
import { columnDropId } from "~/components/limited/limitedDraftDrag";
import {
    DECKBUILDER_SIDEBOARD_DROP_ID,
    resolveDeckbuilderDragAction,
} from "../deckbuilderColumnDrag";

const mainCard = { kind: "main" as const, cardId: "bolt" };
const sideCard = { kind: "side" as const, cardId: "bolt" };

describe("resolveDeckbuilderDragAction (issue #1575)", () => {
    it("returns null for a cancelled/incomplete drop (missing source or target)", () => {
        expect(
            resolveDeckbuilderDragAction(undefined, columnDropId(1))
        ).toBeNull();
        expect(resolveDeckbuilderDragAction(mainCard, undefined)).toBeNull();
    });

    it("Maindeck card → Sideboard moves it out of the deck", () => {
        expect(
            resolveDeckbuilderDragAction(
                mainCard,
                DECKBUILDER_SIDEBOARD_DROP_ID
            )
        ).toEqual({ type: "toSideboard", cardId: "bolt" });
    });

    it("Maindeck card → another Mana-Value column records a manual override, staying in the deck", () => {
        expect(
            resolveDeckbuilderDragAction(mainCard, columnDropId(5))
        ).toEqual({ type: "setColumn", cardId: "bolt", column: 5 });
    });

    it("Maindeck card → the Lands column pins it into Lands (issue #1573 parity)", () => {
        expect(
            resolveDeckbuilderDragAction(mainCard, columnDropId("lands"))
        ).toEqual({ type: "setColumn", cardId: "bolt", column: "lands" });
    });

    it("Sideboard card → a Maindeck column moves it into the deck AND pins the column", () => {
        expect(
            resolveDeckbuilderDragAction(sideCard, columnDropId(2))
        ).toEqual({ type: "toMaindeck", cardId: "bolt", column: 2 });
    });

    it("Sideboard card → the Lands column moves it in and pins Lands", () => {
        expect(
            resolveDeckbuilderDragAction(sideCard, columnDropId("lands"))
        ).toEqual({ type: "toMaindeck", cardId: "bolt", column: "lands" });
    });

    it("Sideboard card → Sideboard is a no-op", () => {
        expect(
            resolveDeckbuilderDragAction(
                sideCard,
                DECKBUILDER_SIDEBOARD_DROP_ID
            )
        ).toBeNull();
    });

    it("an unrecognized drop-target id is a no-op", () => {
        expect(
            resolveDeckbuilderDragAction(mainCard, "some-unrelated-zone")
        ).toBeNull();
    });

    it("every fixed column id round-trips to a setColumn override for a Maindeck card", () => {
        for (let n = 0; n <= 7; n++) {
            expect(
                resolveDeckbuilderDragAction(mainCard, columnDropId(n))
            ).toEqual({ type: "setColumn", cardId: "bolt", column: n });
        }
    });
});
