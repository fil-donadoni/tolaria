// The pane SET (issue #2584). The one thing worth pinning here is that it is
// derived from WHICH SLOTS a variant supplied and from nothing else — the rule
// `deckBuilderVariant.ts` exists to keep ("no identity discriminant"). A
// regression would look like a `kind`/`isLimited` argument creeping into
// `deckPanes`, and the shape of these tests is what makes that impossible to
// add without rewriting them.
import { describe, it, expect } from "vitest";
import { deckPanes } from "../deckPanes";
import {
    SOURCE_TAB_DROP_ID,
    zoneTabDropId,
    parseDeckZoneDropId,
} from "../deckZoneDrag";

describe("deckPanes (issue #2584)", () => {
    it("gives a variant WITH a source panel three panes, source first", () => {
        expect(
            deckPanes({
                source: { label: "Search", count: 12 },
                mainLabel: "Main",
                mainCount: 60,
                sideLabel: "Side",
                sideCount: 15,
            }).map((p) => [p.id, p.label, p.count])
        ).toEqual([
            ["source", "Search", 12],
            ["maindeck", "Main", 60],
            ["sideboard", "Side", 15],
        ]);
    });

    it("gives a variant WITHOUT one two panes — the honest count for a builder whose zones are the only source", () => {
        expect(
            deckPanes({
                mainLabel: "Deck",
                mainCount: 40,
                sideLabel: "Pool",
                sideCount: 45,
            }).map((p) => p.id)
        ).toEqual(["maindeck", "sideboard"]);
    });

    it("gives every tab a drop id, and a ZONE tab's id resolves to that zone with no Column", () => {
        const panes = deckPanes({
            source: { label: "Search", count: 0 },
            mainLabel: "Main",
            mainCount: 0,
            sideLabel: "Side",
            sideCount: 0,
        });
        expect(panes.map((p) => p.dropId)).toEqual([
            SOURCE_TAB_DROP_ID,
            zoneTabDropId("maindeck"),
            zoneTabDropId("sideboard"),
        ]);
        // A tab drop MEANS a whole-pane drop of that zone — same parser, so
        // the two can never drift.
        expect(parseDeckZoneDropId(zoneTabDropId("sideboard"))).toEqual({
            zone: "sideboard",
            columnId: null,
        });
        // …and the source tab is deliberately NOT a zone.
        expect(parseDeckZoneDropId(SOURCE_TAB_DROP_ID)).toBeNull();
    });

    it("mints tab ids DISTINCT from the pane droppables the zones already register", () => {
        // Both are mounted at once on a phone; dnd-kit keys its droppable
        // registry by id, so a collision would silently drop one of them.
        expect(zoneTabDropId("maindeck")).not.toBe("deck-zone:maindeck");
        expect(zoneTabDropId("sideboard")).not.toBe("deck-zone:sideboard");
    });
});
