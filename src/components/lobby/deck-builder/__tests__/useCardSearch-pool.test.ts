import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
    fromSearchIndexWire,
    type SearchIndexWireRow,
} from "@convex/cards/searchIndex";

// Issue #5125: the search index is the deck builder's whole resident pool,
// so the hook must search the loaded rows THEMSELVES — a second object per
// card beside them (the old `indexRowToEntry` spread) cost ~9 MiB at 35,000
// cards on a phone.

const h = vi.hoisted(() => ({
    rows: undefined as unknown,
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("~/lib/searchIndex", () => ({
    useSearchIndex: () => ({ rows: h.rows, error: null }),
}));

import { DEFAULT_FILTERS, useCardSearch } from "../useCardSearch";

const WIRE: SearchIndexWireRow[] = [
    [
        "a",
        "Air Elemental",
        ["Creature"],
        ["Elemental"],
        [],
        ["U"],
        5,
        "flying",
        "lea",
    ],
    [
        "b",
        "Lightning Bolt",
        ["Instant"],
        [],
        [],
        ["R"],
        1,
        "deals 3 damage",
        "lea",
    ],
];

describe("the deck-builder search pool (issue #5125)", () => {
    it("returns the index's own rows, never a copy per card", () => {
        const rows = fromSearchIndexWire(WIRE);
        h.rows = rows;
        const { result } = renderHook(() =>
            useCardSearch({ ...DEFAULT_FILTERS, text: "elemental" })
        );
        expect(result.current.entries).toHaveLength(1);
        expect(result.current.entries[0]).toBe(rows[0]);
    });
});
