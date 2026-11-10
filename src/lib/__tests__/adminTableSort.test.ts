// Sort and filter algebra shared by the admin tool tables (issue #8903).
import { describe, it, expect } from "vitest";
import { matchesAny, nextSort, sortRows } from "../adminTableSort";

describe("nextSort", () => {
    it("starts a new column ascending and flips the active one", () => {
        const start = { key: "card", direction: "asc" } as const;
        expect(nextSort(start, "status")).toEqual({
            key: "status",
            direction: "asc",
        });
        expect(nextSort(start, "card")).toEqual({
            key: "card",
            direction: "desc",
        });
    });
});

describe("sortRows", () => {
    const rows = [
        { name: "b", n: 2 },
        { name: "a", n: 2 },
        { name: "c", n: 1 },
    ];
    const valueOf = (row: (typeof rows)[number], key: "name" | "n") => row[key];

    it("sorts numbers numerically and strings by locale, either way", () => {
        expect(
            sortRows(rows, { key: "n", direction: "asc" }, valueOf).map(
                (r) => r.name
            )
        ).toEqual(["c", "b", "a"]);
        expect(
            sortRows(rows, { key: "name", direction: "desc" }, valueOf).map(
                (r) => r.name
            )
        ).toEqual(["c", "b", "a"]);
    });

    it("keeps input order on ties and never mutates the input", () => {
        const sorted = sortRows(rows, { key: "n", direction: "desc" }, valueOf);
        expect(sorted.map((r) => r.name)).toEqual(["b", "a", "c"]);
        expect(rows.map((r) => r.name)).toEqual(["b", "a", "c"]);
    });
});

describe("matchesAny", () => {
    it("admits everything on an empty selection, else any one match", () => {
        expect(matchesAny([], ["x"])).toBe(true);
        expect(matchesAny(["x", "y"], ["y", "z"])).toBe(true);
        expect(matchesAny(["x"], [])).toBe(false);
    });
});
