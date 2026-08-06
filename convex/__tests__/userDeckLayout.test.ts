// The deck-side Column Layout, at the STORAGE boundary (ADR 0075 §4/§5, PRD
// #1617, issue #1626).
//
// The project has no convex-test harness, so a document can't be written and
// read back through a real deployment here. What CAN be asserted — and is what
// the "round-trips without loss" acceptance criterion actually protects — is
// the pair of things that are silent when they break:
//
//   1. the STORED shape and the pure domain type agree field for field (a
//      field the type has and the schema lacks is dropped on write; a field
//      the schema has and the type lacks is invisible to every reader);
//   2. a layout survives the wire encoding and the read normaliser unchanged.
//
// The shape assertions run against `schema.tables.userDecks.validator.json` —
// the same description Convex itself validates documents with, not a
// hand-copied list. Prior art: `limitedPlayPhaseSchema.test.ts`.
import { describe, it, expect } from "vitest";
import schema from "../schema";
import {
    addManualColumn,
    createColumnLayout,
    fromStoredDeckColumnLayout,
    makeColumnId,
    pinCardToColumn,
    removeColumn,
    storeZoneLayout,
    type ColumnLayout,
    type StoredDeckColumnLayout,
} from "../deckLayout";

/** One field of an object validator, as Convex describes it. */
interface FieldJson {
    fieldType: ValidatorJson;
    optional: boolean;
}
type ValidatorJson =
    | { type: "object"; value: Record<string, FieldJson> }
    | { type: "array"; value: ValidatorJson }
    | {
          type: "record";
          keys: ValidatorJson;
          values: { fieldType: ValidatorJson };
      }
    | { type: string; value?: unknown };

/** `.json` is how Convex itself describes a validator, but it is not part of
 *  every variant's PUBLIC type — hence the one narrowing cast, made here and
 *  nowhere else. */
function tableFields(
    table: keyof typeof schema.tables
): Record<string, FieldJson> {
    const json = (
        schema.tables[table].validator as unknown as { json: ValidatorJson }
    ).json;
    if (json.type !== "object") throw new Error("not an object validator");
    return json.value as Record<string, FieldJson>;
}

function objectFields(json: ValidatorJson): Record<string, FieldJson> {
    if (json.type !== "object") throw new Error("not an object validator");
    return json.value as Record<string, FieldJson>;
}

const deckFields = tableFields("userDecks");

describe("userDecks.layout — storage shape (ADR 0075 §4, issue #1626)", () => {
    it("is OPTIONAL, so a deck saved before this slice validates untouched", () => {
        // The whole "no migration" claim rests on this one flag: every
        // existing row has no `layout` at all.
        expect(deckFields.layout).toBeDefined();
        expect(deckFields.layout.optional).toBe(true);
    });

    it("declares exactly the two Zones, both optional", () => {
        const zones = objectFields(deckFields.layout.fieldType);
        expect(Object.keys(zones).sort()).toEqual(["maindeck", "sideboard"]);
        expect(zones.maindeck.optional).toBe(true);
        expect(zones.sideboard.optional).toBe(true);
    });

    it("declares exactly the DECK half of a Column Layout — and never the view half", () => {
        // `grouping`/`ordering` are per-USER preferences (localStorage). A
        // deck row that stored them would make "I look at decks by colour"
        // a property of one deck, and would silently override the user's
        // choice on every open.
        const zone = objectFields(
            objectFields(deckFields.layout.fieldType).maindeck.fieldType
        );
        expect(Object.keys(zone).sort()).toEqual([
            "manualColumns",
            "pins",
            "removedColumnIds",
        ]);
        for (const field of Object.values(zone)) {
            expect(field.optional).toBe(true);
        }
    });

    it("stores Pins as a record keyed by the surface's own pin key", () => {
        const zone = objectFields(
            objectFields(deckFields.layout.fieldType).maindeck.fieldType
        );
        const pins = zone.pins.fieldType;
        expect(pins.type).toBe("record");
        // Every Pin namespace the engine can record, each optional — a Pin is
        // never erased across namespaces (ADR 0075 §3), so a card may carry
        // any subset.
        const namespaces = objectFields(
            (pins as { values: { fieldType: ValidatorJson } }).values.fieldType
        );
        expect(Object.keys(namespaces).sort()).toEqual([
            "color",
            "custom",
            "mv",
            "type",
        ]);
        for (const field of Object.values(namespaces)) {
            expect(field.optional).toBe(true);
        }
    });

    it("declares a manual Column as exactly an id and a label", () => {
        const zone = objectFields(
            objectFields(deckFields.layout.fieldType).maindeck.fieldType
        );
        const element = (
            zone.manualColumns.fieldType as { value: ValidatorJson }
        ).value;
        expect(Object.keys(objectFields(element)).sort()).toEqual([
            "id",
            "label",
        ]);
    });
});

// ── the round trip ──────────────────────────────────────────────────────────

function arranged(): ColumnLayout {
    let layout = createColumnLayout({ grouping: "mv", ordering: "name" });
    layout = addManualColumn(layout, {
        id: "custom:removal",
        label: "Removal",
    });
    layout = removeColumn(layout, makeColumnId("mv", "3"));
    layout = pinCardToColumn(layout, "bolt", "custom:removal");
    layout = pinCardToColumn(layout, "serra", makeColumnId("mv", "6"));
    return layout;
}

/** What actually crosses the wire and the DB: Convex values are JSON, so
 *  anything that doesn't survive `JSON` doesn't survive persistence. */
function throughTheWire(
    stored: StoredDeckColumnLayout
): StoredDeckColumnLayout {
    return JSON.parse(JSON.stringify(stored)) as StoredDeckColumnLayout;
}

describe("userDecks.layout — round trip (issue #1626)", () => {
    const view = { grouping: "mv" as const, ordering: "name" as const };

    it("survives the write → wire → read path with the arrangement intact", () => {
        const written = storeZoneLayout(undefined, "maindeck", arranged());
        const read = fromStoredDeckColumnLayout(throughTheWire(written), {
            maindeck: view,
            sideboard: view,
        });
        expect(read.maindeck.manualColumns).toEqual([
            { id: "custom:removal", label: "Removal" },
        ]);
        expect(read.maindeck.removedColumnIds).toEqual(["mv:3"]);
        expect(read.maindeck.pins).toEqual({
            bolt: { custom: "custom:removal" },
            serra: { mv: "mv:6" },
        });
        // The untouched Zone comes back as the plain default, not as a
        // half-filled object.
        expect(read.sideboard).toEqual(createColumnLayout(view));
    });

    it("is stable under a second round trip — reading then re-writing changes nothing", () => {
        const once = storeZoneLayout(undefined, "maindeck", arranged());
        const read = fromStoredDeckColumnLayout(throughTheWire(once), {
            maindeck: view,
            sideboard: view,
        });
        const twice = storeZoneLayout(
            throughTheWire(once),
            "maindeck",
            read.maindeck
        );
        expect(twice).toEqual(once);
    });

    it("a deck row with NO layout loads as the default and stores nothing back", () => {
        const read = fromStoredDeckColumnLayout(undefined, {
            maindeck: view,
            sideboard: view,
        });
        expect(read.maindeck).toEqual(createColumnLayout(view));
        // Re-writing an untouched Layout produces an empty stored shape, so a
        // pre-#1626 deck whose CARDS are edited never grows a layout.
        expect(storeZoneLayout(undefined, "maindeck", read.maindeck)).toEqual(
            {}
        );
    });

    it("saving a layout never touches deck CONTENTS or legality", () => {
        // `storeZoneLayout` returns only the layout, and the mutation patches
        // only the `layout` field — so this is a shape assertion, but it is
        // the one the AC names: nothing card-shaped may leak into the stored
        // arrangement.
        const stored = storeZoneLayout(undefined, "maindeck", arranged());
        const keys = new Set<string>();
        const walk = (value: unknown) => {
            if (value === null || typeof value !== "object") return;
            if (Array.isArray(value)) return value.forEach(walk);
            for (const [k, v] of Object.entries(value)) {
                keys.add(k);
                walk(v);
            }
        };
        walk(stored);
        expect(keys.has("cards")).toBe(false);
        expect(keys.has("sideboard")).toBe(false);
        expect(keys.has("cardName")).toBe(false);
        expect(keys.has("format")).toBe(false);
    });
});
