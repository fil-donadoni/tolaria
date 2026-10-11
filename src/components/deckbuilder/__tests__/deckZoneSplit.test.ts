// Split creatures pure layout (PRD #5384, issue #5399).
import { describe, it, expect } from "vitest";
import {
    createColumnLayout,
    resolveColumnLayout,
    setGrouping,
} from "@convex/deckLayout";
import { isCreatureCard } from "../deckZoneFilter";
import { layoutZonePiles } from "../deckZoneSplit";
import {
    bandPaneDropId,
    parseDeckZoneDropId,
    splitBelowDropId,
    zoneColumnDropId,
    zonePaneDropId,
    zoneTabDropId,
} from "../deckZoneDrag";

const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // MV 1 instant, red
const SERRA = "f8ac5006-91bd-4803-93da-f87cf196dd2f"; // MV 5 creature, white
const MOX = "8ebe4be7-e12a-4596-a899-fbd5b152e879"; // MV 0 artifact

type Tile = { cardId: string };
const resolve = (grouping: "mv" | "color", ids: string[]) =>
    resolveColumnLayout<Tile>({
        layout: setGrouping(createColumnLayout(), grouping),
        items: ids.map((cardId) => ({ cardId })),
        adapter: {
            cardId: (t) => t.cardId,
            pinKey: (t) => t.cardId,
            tiebreak: (a, b) => a.cardId.localeCompare(b.cardId),
        },
    }).map((c) => ({ id: c.id, tiles: c.items }));

const desktop = (split: boolean) => ({
    split,
    viewport: "desktop" as const,
    isCreature: (id: string) => isCreatureCard(id),
});

describe("layoutZonePiles", () => {
    for (const grouping of ["mv", "color"] as const) {
        it(`split off = one pile per column (${grouping})`, () => {
            const cols = resolve(grouping, [BOLT, SERRA, MOX]);
            const out = layoutZonePiles(cols, desktop(false));
            expect(out).toEqual({ kind: "piles", columns: cols });
        });

        it(`split on cuts every column in two, same columns (${grouping})`, () => {
            const cols = resolve(grouping, [BOLT, SERRA, MOX]);
            const out = layoutZonePiles(cols, desktop(true));
            if (out.kind !== "split") throw new Error("expected split");
            expect(out.columns.map((c) => c.column.id)).toEqual(
                cols.map((c) => c.id)
            );
            const creatures = out.columns.flatMap((c) =>
                c.creatures.map((t) => t.cardId)
            );
            const others = out.columns.flatMap((c) =>
                c.others.map((t) => t.cardId)
            );
            expect(creatures).toEqual([SERRA]);
            expect(others.sort()).toEqual([BOLT, MOX].sort());
            expect(out.creatureCount).toBe(1);
            expect(out.otherCount).toBe(2);
            expect(out.creatureSlots).toBe(1);
        });
    }

    it("keeps empty mana-value columns and sizes the band to the tallest stack", () => {
        const cols = resolve("mv", [SERRA, SERRA, BOLT]);
        const out = layoutZonePiles(cols, desktop(true));
        if (out.kind !== "split") throw new Error("expected split");
        expect(out.columns.length).toBe(cols.length);
        expect(
            out.columns.some(
                (c) => c.creatures.length === 0 && c.others.length === 0
            )
        ).toBe(true);
        expect(out.creatureSlots).toBe(2);
    });

    it("the creature filter (applied before) stays independent of the split", () => {
        const cols = resolve("mv", [BOLT, SERRA]).map((c) => ({
            ...c,
            tiles: c.tiles.filter((t) => isCreatureCard(t.cardId)),
        }));
        const out = layoutZonePiles(cols, desktop(true));
        if (out.kind !== "split") throw new Error("expected split");
        expect(out.columns.length).toBe(cols.length);
        expect(out.otherCount).toBe(0);
        expect(out.creatureCount).toBe(1);
    });

    const phone = (
        split: boolean,
        viewport: "phone-portrait" | "phone-landscape"
    ) => ({ ...desktop(split), viewport });

    for (const grouping of ["mv", "color"] as const) {
        it(`phone portrait, split off: the same columns, wrapping (${grouping})`, () => {
            const cols = resolve(grouping, [BOLT, SERRA, MOX]);
            expect(
                layoutZonePiles(cols, phone(false, "phone-portrait"))
            ).toEqual({ kind: "wrap", columns: cols });
        });

        it(`phone landscape, split off: the same columns, one sideways row (${grouping})`, () => {
            const cols = resolve(grouping, [BOLT, SERRA, MOX]);
            expect(
                layoutZonePiles(cols, phone(false, "phone-landscape"))
            ).toEqual({ kind: "row", columns: cols });
        });
    }

    it("phone, split on: two bands holding each card exactly once", () => {
        const cols = resolve("mv", [BOLT, SERRA, MOX]);
        for (const [viewport, arrangement] of [
            ["phone-portrait", "tabs"],
            ["phone-landscape", "side-by-side"],
        ] as const) {
            const out = layoutZonePiles(cols, phone(true, viewport));
            if (out.kind !== "bands") throw new Error("expected bands");
            expect(out.arrangement).toBe(arrangement);
            const ids = (b: typeof out.creatures) =>
                b.columns.flatMap((c) => c.tiles.map((t) => t.cardId));
            expect(ids(out.creatures)).toEqual([SERRA]);
            expect(ids(out.others).sort()).toEqual([BOLT, MOX].sort());
            expect(out.creatures.count).toBe(1);
            expect(out.others.count).toBe(2);
        }
    });

    it("phone bands keep only columns that hold a card of that band, in column order", () => {
        const cols = resolve("mv", [BOLT, SERRA, MOX]);
        const out = layoutZonePiles(cols, phone(true, "phone-portrait"));
        if (out.kind !== "bands") throw new Error("expected bands");
        expect(out.creatures.columns.map((c) => c.id)).toEqual(
            cols
                .filter((c) => c.tiles.some((t) => t.cardId === SERRA))
                .map((c) => c.id)
        );
        for (const band of [out.creatures, out.others]) {
            expect(band.columns.every((c) => c.tiles.length > 0)).toBe(true);
        }
    });
});

describe("band drop ids", () => {
    it("a band's tab and pane ids resolve to the whole Maindeck, each id distinct", () => {
        const ids = [
            zoneTabDropId("maindeck"),
            zoneTabDropId("maindeck", "creatures"),
            zoneTabDropId("maindeck", "others"),
            bandPaneDropId("maindeck", "creatures"),
            bandPaneDropId("maindeck", "others"),
            zonePaneDropId("maindeck"),
        ];
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(parseDeckZoneDropId(id)).toEqual({
                zone: "maindeck",
                columnId: null,
            });
        }
    });
});

describe("split below drop id", () => {
    it("resolves to the same column as the creature half", () => {
        const id = zoneColumnDropId("maindeck", "mv:5");
        expect(parseDeckZoneDropId(splitBelowDropId(id))).toEqual(
            parseDeckZoneDropId(id)
        );
    });
});
