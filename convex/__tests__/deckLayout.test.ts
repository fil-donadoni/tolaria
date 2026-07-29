// Column Layout engine tests (ADR 0075, PRD #1617, issue #1618). One
// `describe` per acceptance criterion. Prior art:
// `convex/limited/__tests__/poolArrangement.test.ts`.
//
// The engine is generic over the caller's item shape, so the fixtures below
// are a tiny synthetic catalogue plus a `{ cardId }` item — no registry, no
// React, no Convex context. One dedicated block exercises the DEFAULT lookup
// against the real card registry, so the injected-lookup path can't drift
// away from the shipping one.
import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../cards/types";
import {
    CATCH_ALL_COLUMN_ID,
    MAX_MANA_VALUE_COLUMN,
    UNGROUPED_COLUMN_ID,
    addManualColumn,
    canDeleteColumn,
    createColumnLayout,
    createDeckColumnLayout,
    generateColumns,
    makeColumnId,
    normalizeLegacyColumn,
    parseColumnId,
    pinCardToColumn,
    pinNamespaceForGrouping,
    removeColumn,
    resolveColumnLayout,
    restoreColumn,
    setCardPin,
    setGrouping,
    setOrdering,
    type ColumnLayout,
    type ColumnLayoutAdapter,
    type GroupingKind,
    type ResolvedColumn,
} from "../deckLayout";

// ── fixtures ────────────────────────────────────────────────────────────────

interface Item {
    cardId: string;
}

const adapter: ColumnLayoutAdapter<Item> = {
    cardId: (i) => i.cardId,
    pinKey: (i) => i.cardId,
};

function def(
    id: string,
    overrides: Partial<CardDefinition> = {}
): CardDefinition {
    const base: CardDefinition = {
        id,
        name: id,
        rarity: "common",
        types: ["Creature"],
    };
    return { ...base, ...overrides };
}

const CATALOGUE: Record<string, CardDefinition> = {
    // Non-lands across the Mana-Value ladder.
    ornithopter: def("ornithopter", {
        name: "Ornithopter",
        types: ["Artifact", "Creature"],
        manaCost: { generic: 0 },
    }),
    bolt: def("bolt", {
        name: "Lightning Bolt",
        types: ["Instant"],
        manaCost: { R: 1 },
    }),
    counterspell: def("counterspell", {
        name: "Counterspell",
        types: ["Instant"],
        manaCost: { U: 2 },
        rarity: "uncommon",
    }),
    angel: def("angel", {
        name: "Serra Angel",
        types: ["Creature"],
        manaCost: { generic: 3, W: 2 },
        rarity: "uncommon",
    }),
    shivan: def("shivan", {
        name: "Shivan Dragon",
        types: ["Creature"],
        manaCost: { generic: 4, R: 2 },
        rarity: "rare",
    }),
    colossus: def("colossus", {
        name: "Colossus",
        types: ["Artifact", "Creature"],
        manaCost: { generic: 10 },
        rarity: "rare",
    }),
    behemoth: def("behemoth", {
        name: "Behemoth",
        types: ["Creature"],
        manaCost: { generic: 7 },
        rarity: "rare",
    }),
    // Gold.
    fires: def("fires", {
        name: "Fires of Yavimaya",
        types: ["Enchantment"],
        manaCost: { R: 1, G: 1 },
        rarity: "uncommon",
    }),
    // Colourless spell.
    ankh: def("ankh", {
        name: "Ankh of Mishra",
        types: ["Artifact"],
        manaCost: { generic: 2 },
        rarity: "rare",
    }),
    walker: def("walker", {
        name: "Jace Test",
        types: ["Planeswalker"],
        manaCost: { generic: 2, U: 2 },
        rarity: "mythic",
    }),
    // Lands — a basic and a DUAL, which must sit in Lands under `color`.
    mountain: def("mountain", {
        name: "Mountain",
        types: ["Land"],
        supertypes: ["Basic"],
        subtypes: ["Mountain"],
    }),
    taiga: def("taiga", {
        name: "Taiga",
        types: ["Land"],
        subtypes: ["Mountain", "Forest"],
        rarity: "rare",
    }),
};

const lookup = (cardId: string): CardDefinition | undefined =>
    CATALOGUE[cardId];

function items(...ids: string[]): Item[] {
    return ids.map((cardId) => ({ cardId }));
}

function resolve(layout: ColumnLayout, ids: string[]): ResolvedColumn<Item>[] {
    return resolveColumnLayout({
        layout,
        items: items(...ids),
        adapter,
        lookup,
    });
}

function column<T>(
    columns: readonly ResolvedColumn<T>[],
    id: string
): ResolvedColumn<T> {
    const hit = columns.find((c) => c.id === id);
    if (!hit) throw new Error(`no column ${id} in ${columns.map((c) => c.id)}`);
    return hit;
}

function idsIn(columns: readonly ResolvedColumn<Item>[], id: string): string[] {
    return column(columns, id).items.map((i) => i.cardId);
}

/** The column a given card actually landed in. */
function columnOf(
    columns: readonly ResolvedColumn<Item>[],
    cardId: string
): string {
    const hit = columns.find((c) => c.items.some((i) => i.cardId === cardId));
    if (!hit) throw new Error(`${cardId} landed in no column`);
    return hit.id;
}

const ALL_GROUPINGS: GroupingKind[] = ["mv", "color", "type", "none"];

// ── column ids ──────────────────────────────────────────────────────────────

describe("namespaced column ids (ADR 0075 §3)", () => {
    it("round-trips a namespaced id", () => {
        expect(makeColumnId("mv", "5")).toBe("mv:5");
        expect(parseColumnId("mv:5")).toEqual({ namespace: "mv", key: "5" });
        expect(parseColumnId("custom:my-pile")).toEqual({
            namespace: "custom",
            key: "my-pile",
        });
    });

    it("refuses to parse the unnamespaced Catch-All and unknown namespaces", () => {
        expect(parseColumnId(CATCH_ALL_COLUMN_ID)).toBeNull();
        expect(parseColumnId(UNGROUPED_COLUMN_ID)).toBeNull();
        expect(parseColumnId("rarity:rare")).toBeNull();
    });

    it("maps each Grouping to its Pin namespace, `none` to none", () => {
        expect(pinNamespaceForGrouping("mv")).toBe("mv");
        expect(pinNamespaceForGrouping("color")).toBe("color");
        expect(pinNamespaceForGrouping("type")).toBe("type");
        expect(pinNamespaceForGrouping("none")).toBeNull();
    });
});

// ── AC: Grouping `mv` reproduces today's fixed ladder ───────────────────────

describe("Grouping `mv` reproduces today's fixed ladder (issue #1618)", () => {
    it("emits Lands then MV 0..7+, every column present even when empty", () => {
        const columns = generateColumns("mv", []);
        expect(columns.map((c) => c.id)).toEqual([
            "mv:lands",
            "mv:0",
            "mv:1",
            "mv:2",
            "mv:3",
            "mv:4",
            "mv:5",
            "mv:6",
            "mv:7",
        ]);
        expect(columns.map((c) => c.label)).toEqual([
            "Lands",
            "MV 0",
            "MV 1",
            "MV 2",
            "MV 3",
            "MV 4",
            "MV 5",
            "MV 6",
            "MV 7+",
        ]);
    });

    it("buckets each card by its own Mana Value, lands into Lands", () => {
        const columns = resolve(createColumnLayout(), [
            "mountain",
            "ornithopter",
            "bolt",
            "angel",
            "shivan",
        ]);
        expect(idsIn(columns, "mv:lands")).toEqual(["mountain"]);
        expect(idsIn(columns, "mv:0")).toEqual(["ornithopter"]);
        expect(idsIn(columns, "mv:1")).toEqual(["bolt"]);
        expect(idsIn(columns, "mv:5")).toEqual(["angel"]);
        expect(idsIn(columns, "mv:6")).toEqual(["shivan"]);
    });

    it("clamps every Mana Value >= 7 into the `7+` column", () => {
        const columns = resolve(createColumnLayout(), ["behemoth", "colossus"]);
        expect(idsIn(columns, `mv:${MAX_MANA_VALUE_COLUMN}`)).toEqual([
            "behemoth",
            "colossus",
        ]);
    });
});

// ── AC: Grouping `color` ────────────────────────────────────────────────────

describe("Grouping `color` (issue #1618)", () => {
    it("produces W/U/B/R/G + Multicolour + Colourless columns PLUS Lands", () => {
        const columns = generateColumns("color", []);
        expect(columns.map((c) => c.id)).toEqual([
            "color:lands",
            "color:W",
            "color:U",
            "color:B",
            "color:R",
            "color:G",
            "color:multicolor",
            "color:colorless",
        ]);
    });

    it("puts a DUAL land in Lands, not in Multicolour", () => {
        const layout = setGrouping(createColumnLayout(), "color");
        const columns = resolve(layout, ["taiga", "mountain"]);
        expect(idsIn(columns, "color:lands")).toEqual(["mountain", "taiga"]);
        expect(idsIn(columns, "color:multicolor")).toEqual([]);
    });

    it("routes mono, gold and colourless spells to their own columns", () => {
        const layout = setGrouping(createColumnLayout(), "color");
        const columns = resolve(layout, ["bolt", "angel", "fires", "ankh"]);
        expect(idsIn(columns, "color:R")).toEqual(["bolt"]);
        expect(idsIn(columns, "color:W")).toEqual(["angel"]);
        expect(idsIn(columns, "color:multicolor")).toEqual(["fires"]);
        expect(idsIn(columns, "color:colorless")).toEqual(["ankh"]);
    });
});

// ── AC: Grouping `type` ─────────────────────────────────────────────────────

describe("Grouping `type` (issue #1618)", () => {
    it("produces one column per card type PRESENT, plus Lands and the Catch-All", () => {
        const layout = setGrouping(createColumnLayout(), "type");
        const columns = resolve(layout, ["mountain", "bolt", "angel"]);
        expect(columns.map((c) => c.id)).toEqual([
            "type:lands",
            "type:creature",
            "type:instant",
            CATCH_ALL_COLUMN_ID,
        ]);
        expect(idsIn(columns, "type:lands")).toEqual(["mountain"]);
        expect(idsIn(columns, "type:creature")).toEqual(["angel"]);
        expect(idsIn(columns, "type:instant")).toEqual(["bolt"]);
    });

    it("claims a multi-type card by the FIRST matching column", () => {
        const layout = setGrouping(createColumnLayout(), "type");
        const columns = resolve(layout, ["ornithopter"]);
        // Artifact Creature: Creature comes first in claiming order.
        expect(columnOf(columns, "ornithopter")).toBe("type:creature");
        expect(idsIn(columns, "type:artifact")).toEqual([]);
    });

    it("emits no column for a type absent from the Zone", () => {
        const layout = setGrouping(createColumnLayout(), "type");
        const columns = resolve(layout, ["bolt"]);
        expect(columns.map((c) => c.id)).not.toContain("type:creature");
    });
});

// ── AC: Grouping `none` ─────────────────────────────────────────────────────

describe("Grouping `none` (issue #1618)", () => {
    it("produces a single column plus the Catch-All", () => {
        const layout = setGrouping(createColumnLayout(), "none");
        const columns = resolve(layout, ["mountain", "bolt", "fires"]);
        expect(columns.map((c) => c.id)).toEqual([
            UNGROUPED_COLUMN_ID,
            CATCH_ALL_COLUMN_ID,
        ]);
        expect(idsIn(columns, UNGROUPED_COLUMN_ID)).toEqual([
            "fires", // Fires of Yavimaya
            "bolt", // Lightning Bolt
            "mountain", // Mountain
        ]);
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual([]);
    });
});

// ── AC: manual columns ──────────────────────────────────────────────────────

describe("manual Columns (ADR 0075 §2, issue #1618)", () => {
    const manual = { id: "custom:combo", label: "Combo" };

    it("carries a label and no predicate — no card lands in it without a `custom` pin", () => {
        const layout = addManualColumn(createColumnLayout(), manual);
        const columns = resolve(layout, ["bolt", "angel", "mountain"]);
        expect(column(columns, manual.id).label).toBe("Combo");
        expect(column(columns, manual.id).kind).toBe("manual");
        expect(column(columns, manual.id).pinNamespace).toBe("custom");
        expect(idsIn(columns, manual.id)).toEqual([]);
    });

    it("accepts a card ONLY via a `custom` pin", () => {
        let layout = addManualColumn(createColumnLayout(), manual);
        layout = pinCardToColumn(layout, "bolt", manual.id);
        const columns = resolve(layout, ["bolt", "angel"]);
        expect(idsIn(columns, manual.id)).toEqual(["bolt"]);
        expect(idsIn(columns, "mv:1")).toEqual([]);
    });

    it("is present under EVERY Grouping of its Zone, right before the Catch-All", () => {
        let base = addManualColumn(createColumnLayout(), manual);
        base = pinCardToColumn(base, "bolt", manual.id);
        for (const grouping of ALL_GROUPINGS) {
            const columns = resolve(setGrouping(base, grouping), [
                "bolt",
                "angel",
            ]);
            expect(columns.map((c) => c.id)).toContain(manual.id);
            expect(columns[columns.length - 2].id).toBe(manual.id);
            expect(columns[columns.length - 1].id).toBe(CATCH_ALL_COLUMN_ID);
            expect(idsIn(columns, manual.id)).toEqual(["bolt"]);
        }
    });

    it("ignores a duplicate id", () => {
        const layout = addManualColumn(
            addManualColumn(createColumnLayout(), manual),
            { ...manual, label: "Other" }
        );
        expect(layout.manualColumns).toEqual([manual]);
    });
});

// ── AC: claiming order ──────────────────────────────────────────────────────

describe("claiming order: `custom` pin > active-Grouping pin > predicate > Catch-All (issue #1618)", () => {
    const manual = { id: "custom:combo", label: "Combo" };

    it("a `custom` pin outranks the active-Grouping pin and the predicate", () => {
        let layout = addManualColumn(createColumnLayout(), manual);
        layout = setCardPin(layout, "bolt", "mv", "mv:4");
        layout = setCardPin(layout, "bolt", "custom", manual.id);
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe(manual.id);
    });

    it("the active-Grouping pin outranks the predicate", () => {
        const layout = setCardPin(createColumnLayout(), "bolt", "mv", "mv:4");
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe("mv:4");
    });

    it("the predicate applies when no pin does", () => {
        const layout = setCardPin(
            createColumnLayout(),
            "bolt",
            "color",
            "color:R"
        );
        // Grouping is `mv`; the `color` pin does not apply.
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe("mv:1");
    });

    it("a pin naming a column that does not exist falls through to the predicate", () => {
        const layout = setCardPin(createColumnLayout(), "bolt", "mv", "mv:99");
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe("mv:1");
    });

    it("a `custom` pin naming a deleted manual column falls through", () => {
        let layout = addManualColumn(createColumnLayout(), manual);
        layout = pinCardToColumn(layout, "bolt", manual.id);
        layout = removeColumn(layout, manual.id);
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe("mv:1");
    });
});

// ── AC: the Catch-All ───────────────────────────────────────────────────────

describe("the Catch-All Column (issue #1618)", () => {
    it("is always last, under every Grouping", () => {
        for (const grouping of ALL_GROUPINGS) {
            const columns = resolve(
                setGrouping(createColumnLayout(), grouping),
                ["bolt", "mountain"]
            );
            const last = columns[columns.length - 1];
            expect(last.id).toBe(CATCH_ALL_COLUMN_ID);
            expect(last.kind).toBe("catchAll");
            expect(last.pinNamespace).toBeNull();
        }
    });

    it("holds a card no column claims", () => {
        // An id absent from the catalogue matches no predicate.
        const columns = resolve(createColumnLayout(), ["unknown-card"]);
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual(["unknown-card"]);
    });
});

// ── AC: canDeleteColumn + delete/re-introduce ───────────────────────────────

describe("canDeleteColumn (issue #1618)", () => {
    it("is false for the Catch-All, even when empty", () => {
        const columns = resolve(createColumnLayout(), ["bolt"]);
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual([]);
        expect(canDeleteColumn(columns, CATCH_ALL_COLUMN_ID)).toBe(false);
    });

    it("is false for a column currently holding a card", () => {
        const columns = resolve(createColumnLayout(), ["bolt"]);
        expect(canDeleteColumn(columns, "mv:1")).toBe(false);
    });

    it("is true for any other empty column, generated or manual", () => {
        const layout = addManualColumn(createColumnLayout(), {
            id: "custom:combo",
            label: "Combo",
        });
        const columns = resolve(layout, ["bolt"]);
        expect(canDeleteColumn(columns, "mv:4")).toBe(true);
        expect(canDeleteColumn(columns, "custom:combo")).toBe(true);
    });

    it("is false for an unknown column id", () => {
        const columns = resolve(createColumnLayout(), ["bolt"]);
        expect(canDeleteColumn(columns, "mv:99")).toBe(false);
    });
});

describe("deleting a column then re-introducing a matching card (issue #1618)", () => {
    it("puts the newly-introduced card in the Catch-All", () => {
        const before = resolve(createColumnLayout(), ["bolt"]);
        expect(canDeleteColumn(before, "mv:5")).toBe(true);

        const layout = removeColumn(createColumnLayout(), "mv:5");
        const columns = resolve(layout, ["bolt", "angel"]);
        expect(columns.map((c) => c.id)).not.toContain("mv:5");
        // Serra Angel is MV 5 and would have matched the deleted column.
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual(["angel"]);
        expect(idsIn(columns, "mv:1")).toEqual(["bolt"]);
    });

    it("scopes the deletion to its own namespace", () => {
        const layout = setGrouping(
            removeColumn(createColumnLayout(), "mv:5"),
            "color"
        );
        const columns = resolve(layout, ["angel"]);
        expect(idsIn(columns, "color:W")).toEqual(["angel"]);
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual([]);
    });

    it("refuses to delete the Catch-All and restores a deleted generated column", () => {
        expect(
            removeColumn(createColumnLayout(), CATCH_ALL_COLUMN_ID)
                .removedColumnIds
        ).toEqual([]);

        const removed = removeColumn(createColumnLayout(), "mv:5");
        expect(removed.removedColumnIds).toEqual(["mv:5"]);
        const restored = restoreColumn(removed, "mv:5");
        expect(restored.removedColumnIds).toEqual([]);
        expect(columnOf(resolve(restored, ["angel"]), "angel")).toBe("mv:5");
    });
});

// ── AC: pins survive a Grouping round-trip ──────────────────────────────────

describe("Card Pins survive a Grouping round-trip (ADR 0075 §3, issue #1618)", () => {
    it("re-applies an `mv` pin unchanged after mv → color → mv", () => {
        const pinned = setCardPin(createColumnLayout(), "bolt", "mv", "mv:4");
        expect(columnOf(resolve(pinned, ["bolt"]), "bolt")).toBe("mv:4");

        const asColor = setGrouping(pinned, "color");
        expect(asColor.pins).toEqual(pinned.pins);
        // The `mv` pin does not apply while the Grouping is colour.
        expect(columnOf(resolve(asColor, ["bolt"]), "bolt")).toBe("color:R");

        const backToMv = setGrouping(asColor, "mv");
        expect(backToMv.pins).toEqual(pinned.pins);
        expect(columnOf(resolve(backToMv, ["bolt"]), "bolt")).toBe("mv:4");
    });

    it("keeps one pin per namespace independently", () => {
        let layout = setCardPin(createColumnLayout(), "bolt", "mv", "mv:4");
        layout = setCardPin(layout, "bolt", "color", "color:G");
        expect(layout.pins.bolt).toEqual({ mv: "mv:4", color: "color:G" });
        expect(columnOf(resolve(layout, ["bolt"]), "bolt")).toBe("mv:4");
        expect(
            columnOf(resolve(setGrouping(layout, "color"), ["bolt"]), "bolt")
        ).toBe("color:G");
    });

    it("clears one namespace without touching the others, dropping an empty entry", () => {
        let layout = setCardPin(createColumnLayout(), "bolt", "mv", "mv:4");
        layout = setCardPin(layout, "bolt", "color", "color:G");
        layout = setCardPin(layout, "bolt", "mv", null);
        expect(layout.pins.bolt).toEqual({ color: "color:G" });
        layout = setCardPin(layout, "bolt", "color", null);
        expect(layout.pins).toEqual({});
    });

    it("never mutates the layout it was handed", () => {
        const base = createColumnLayout();
        setCardPin(base, "bolt", "mv", "mv:4");
        addManualColumn(base, { id: "custom:x", label: "X" });
        removeColumn(base, "mv:5");
        setGrouping(base, "color");
        setOrdering(base, "rarity");
        expect(base).toEqual(createColumnLayout());
    });

    it("derives the namespace from the column id when pinning by drop", () => {
        const layout = pinCardToColumn(createColumnLayout(), "bolt", "color:G");
        expect(layout.pins.bolt).toEqual({ color: "color:G" });
        // The Catch-All is never a pin target.
        expect(
            pinCardToColumn(createColumnLayout(), "bolt", CATCH_ALL_COLUMN_ID)
                .pins
        ).toEqual({});
    });
});

// ── AC: Ordering is independent of Grouping ─────────────────────────────────

describe("Ordering sorts INSIDE each column, independently of Grouping (issue #1618)", () => {
    const ids = ["shivan", "bolt", "angel", "counterspell", "walker", "ankh"];

    it("`name` matches today's cardName-then-cardId convention", () => {
        const layout = setGrouping(createColumnLayout(), "none");
        expect(idsIn(resolve(layout, ids), UNGROUPED_COLUMN_ID)).toEqual([
            "ankh", // Ankh of Mishra
            "counterspell", // Counterspell
            "walker", // Jace Test
            "bolt", // Lightning Bolt
            "angel", // Serra Angel
            "shivan", // Shivan Dragon
        ]);
    });

    it("breaks a name tie on cardId", () => {
        const twins: Record<string, CardDefinition> = {
            ...CATALOGUE,
            "bolt-b": CATALOGUE.bolt,
        };
        const columns = resolveColumnLayout({
            layout: setGrouping(createColumnLayout(), "none"),
            items: items("bolt-b", "bolt"),
            adapter,
            lookup: (id) => twins[id],
        });
        expect(idsIn(columns, UNGROUPED_COLUMN_ID)).toEqual(["bolt", "bolt-b"]);
    });

    it("`mv` orders by Mana Value, falling back to name", () => {
        const layout = setOrdering(
            setGrouping(createColumnLayout(), "none"),
            "mv"
        );
        expect(idsIn(resolve(layout, ids), UNGROUPED_COLUMN_ID)).toEqual([
            "bolt", // 1
            "ankh", // 2 — "Ankh of Mishra"
            "counterspell", // 2 — "Counterspell"
            "walker", // 4
            "angel", // 5
            "shivan", // 6
        ]);
    });

    it("`color` orders WUBRG, then multicolour, then colourless", () => {
        const layout = setOrdering(
            setGrouping(createColumnLayout(), "none"),
            "color"
        );
        const columns = resolve(layout, [
            "ankh",
            "fires",
            "bolt",
            "angel",
            "counterspell",
        ]);
        expect(idsIn(columns, UNGROUPED_COLUMN_ID)).toEqual([
            "angel", // W
            "counterspell", // U
            "bolt", // R
            "fires", // multicolour
            "ankh", // colourless
        ]);
    });

    it("`rarity` orders rarest first, falling back to name", () => {
        const layout = setOrdering(
            setGrouping(createColumnLayout(), "none"),
            "rarity"
        );
        expect(idsIn(resolve(layout, ids), UNGROUPED_COLUMN_ID)).toEqual([
            "walker", // mythic
            "ankh", // rare — "Ankh of Mishra"
            "shivan", // rare — "Shivan Dragon"
            "counterspell", // uncommon — "Counterspell"
            "angel", // uncommon — "Serra Angel"
            "bolt", // common
        ]);
    });

    it("applies the SAME Ordering inside every column of a different Grouping", () => {
        const layout = setOrdering(
            setGrouping(createColumnLayout(), "color"),
            "mv"
        );
        const columns = resolve(layout, [
            "shivan",
            "bolt",
            "counterspell",
            "walker",
        ]);
        expect(idsIn(columns, "color:R")).toEqual(["bolt", "shivan"]);
        expect(idsIn(columns, "color:U")).toEqual(["counterspell", "walker"]);
    });
});

// ── the Limited per-copy adapter ────────────────────────────────────────────

interface Copy {
    cardId: string;
    poolIndex: number;
}

const copyAdapter: ColumnLayoutAdapter<Copy> = {
    cardId: (i) => i.cardId,
    pinKey: (i) => String(i.poolIndex),
    tiebreak: (a, b) => a.poolIndex - b.poolIndex,
};

describe("the adapter seam — per-copy keys and tiebreaks (Limited, ADR 0075 §4)", () => {
    it("honours the adapter's own tiebreak", () => {
        const columns = resolveColumnLayout({
            layout: setGrouping(createColumnLayout(), "none"),
            items: [
                { cardId: "bolt", poolIndex: 9 },
                { cardId: "bolt", poolIndex: 2 },
            ],
            adapter: copyAdapter,
            lookup,
        });
        expect(
            column(columns, UNGROUPED_COLUMN_ID).items.map((i) => i.poolIndex)
        ).toEqual([2, 9]);
    });

    it("pins one copy without moving the other", () => {
        const columns = resolveColumnLayout({
            layout: setCardPin(createColumnLayout(), "2", "mv", "mv:4"),
            items: [
                { cardId: "bolt", poolIndex: 1 },
                { cardId: "bolt", poolIndex: 2 },
            ],
            adapter: copyAdapter,
            lookup,
        });
        expect(column(columns, "mv:4").items.map((i) => i.poolIndex)).toEqual([
            2,
        ]);
        expect(column(columns, "mv:1").items.map((i) => i.poolIndex)).toEqual([
            1,
        ]);
    });
});

// ── legacy read + layout construction ───────────────────────────────────────

describe("normalizeLegacyColumn — tolerant read of the deprecated `column` (ADR 0075 §5)", () => {
    it("maps a numeric column into the `mv` namespace", () => {
        expect(normalizeLegacyColumn(5)).toEqual({ mv: "mv:5" });
        expect(normalizeLegacyColumn(0)).toEqual({ mv: "mv:0" });
    });

    it("maps `lands` into the `mv` Lands column", () => {
        expect(normalizeLegacyColumn("lands")).toEqual({ mv: "mv:lands" });
    });

    it("clamps out-of-range values into the fixed ladder", () => {
        expect(normalizeLegacyColumn(42)).toEqual({ mv: "mv:7" });
        expect(normalizeLegacyColumn(-3)).toEqual({ mv: "mv:0" });
    });

    it("yields no pin at all for an absent override", () => {
        expect(normalizeLegacyColumn(undefined)).toEqual({});
        expect(normalizeLegacyColumn(null)).toEqual({});
    });
});

describe("layout construction", () => {
    it("defaults to the Mana-Value ladder ordered by name, with no manual columns or pins", () => {
        expect(createColumnLayout()).toEqual({
            grouping: "mv",
            ordering: "name",
            manualColumns: [],
            removedColumnIds: [],
            pins: {},
        });
    });

    it("gives each Zone its own independent Layout", () => {
        const deck = createDeckColumnLayout();
        deck.maindeck = setGrouping(deck.maindeck, "color");
        expect(deck.maindeck.grouping).toBe("color");
        expect(deck.sideboard.grouping).toBe("mv");
    });
});

// ── purity + the default (registry) lookup ──────────────────────────────────

const REAL_MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const REAL_LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const REAL_SERRA_ANGEL = "f8ac5006-91bd-4803-93da-f87cf196dd2f";

describe("purity and the default catalogue lookup (issue #1618)", () => {
    it("is deterministic — the same inputs give the same columns twice", () => {
        const layout = setGrouping(createColumnLayout(), "color");
        const first = resolve(layout, ["bolt", "taiga", "fires"]);
        const second = resolve(layout, ["bolt", "taiga", "fires"]);
        expect(first.map((c) => [c.id, c.items.map((i) => i.cardId)])).toEqual(
            second.map((c) => [c.id, c.items.map((i) => i.cardId)])
        );
    });

    it("never mutates the items array it was handed", () => {
        const list = items("shivan", "bolt");
        resolveColumnLayout({
            layout: setGrouping(createColumnLayout(), "none"),
            items: list,
            adapter,
            lookup,
        });
        expect(list.map((i) => i.cardId)).toEqual(["shivan", "bolt"]);
    });

    it("resolves real registry cards through the DEFAULT lookup", () => {
        const columns = resolveColumnLayout({
            layout: createColumnLayout(),
            items: items(REAL_MOUNTAIN, REAL_LIGHTNING_BOLT, REAL_SERRA_ANGEL),
            adapter,
        });
        expect(idsIn(columns, "mv:lands")).toEqual([REAL_MOUNTAIN]);
        expect(idsIn(columns, "mv:1")).toEqual([REAL_LIGHTNING_BOLT]);
        expect(idsIn(columns, "mv:5")).toEqual([REAL_SERRA_ANGEL]);
        expect(idsIn(columns, CATCH_ALL_COLUMN_ID)).toEqual([]);
    });

    it("puts an unknown card in the Catch-All rather than throwing", () => {
        expect(() =>
            resolveColumnLayout({
                layout: createColumnLayout(),
                items: items("definitely-not-a-card"),
                adapter,
            })
        ).not.toThrow();
    });
});
