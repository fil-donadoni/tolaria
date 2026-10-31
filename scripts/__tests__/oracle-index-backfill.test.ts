// `oracle:index` appends the card-index rows of newly `ready` compiled cards.
// One oracle id may already carry TWO rows — a hand-written front face beside
// its compiled `A // B` row (Skycoach Conductor, issue #7221) — and the merge
// must keep both, or `check:index` reds on the hand-written card it dropped.
import { describe, expect, it } from "vitest";
import { mergeCardIndex, type Entry } from "../oracle-index-backfill";

const SKYCOACH_ORACLE = "788d3cfa-7706-4728-9c48-cf7bc963d002";

const handWritten: Entry = {
    name: "Skycoach Conductor",
    scryfallId: "f9092a09-78a8-421c-868b-115175f4c252",
    oracleId: SKYCOACH_ORACLE,
    firstSet: "sos",
    firstPrintId: "f9092a09-78a8-421c-868b-115175f4c252",
    firstPrintSet: "sos",
};
const compiled: Entry = {
    ...handWritten,
    name: "Skycoach Conductor // All Aboard",
    rarity: "uncommon",
    source: "compiled",
};
const graduate: Entry = {
    name: "Dead // Gone",
    scryfallId: "96fd8d8e-8f2a-4240-bcb7-18f73fd47bd5",
    oracleId: "4d3e6b7e-0000-4000-8000-000000000000",
    firstSet: "pls",
    firstPrintId: "96fd8d8e-8f2a-4240-bcb7-18f73fd47bd5",
    firstPrintSet: "pls",
    rarity: "common",
    source: "compiled",
};

describe("mergeCardIndex — oracle:index lockfile write", () => {
    it("keeps both rows of an oracle id that carries a hand-written and a compiled row", () => {
        const merged = mergeCardIndex([handWritten, compiled], [graduate]);

        expect(merged.filter((e) => e.oracleId === SKYCOACH_ORACLE)).toEqual([
            handWritten,
            compiled,
        ]);
    });

    it("appends the new rows and sorts the whole lockfile by name", () => {
        const merged = mergeCardIndex([handWritten, compiled], [graduate]);

        expect(merged.map((e) => e.name)).toEqual([
            "Dead // Gone",
            "Skycoach Conductor",
            "Skycoach Conductor // All Aboard",
        ]);
    });
});
