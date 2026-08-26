// `graduateCompiledEntries` — the graduation path for a `source: "compiled"`
// card-index row (issue #2702 round 3, PR #2838).
//
// A compiled-only row is written by `oracle-index-backfill.ts` when the
// Oracle compiler reaches `ready` for a card with no hand-written
// `CardDefinition` yet. If a hand-written `CardDefinition` is later added for
// the SAME print id (ADR 0108 guarantees the compiled row's `scryfallId`
// equals the `firstPrintId` the hand-written card will use), the row's
// `source: "compiled"` tag goes stale: `backfill-card-index.ts` matches
// existing rows by `scryfallId` and skips anything already present, so
// nothing ever cleared it. Every consumer that filters on
// `source !== "compiled"` to mean "counts as implemented"
// (`oracle-compile.ts`'s `poolOracleIdsFromIndex`, `list-to-cards.mjs`'s
// `dedupByOracle`/`knownImplementedNames`) then treats an already-implemented
// card as still-compiled-only forever.

import { describe, expect, it } from "vitest";
import { graduateCompiledEntries, type Entry } from "../backfill-card-index";

function entry(overrides: Partial<Entry> = {}): Entry {
    return {
        name: "Test Card",
        scryfallId: "00000000-0000-0000-0000-000000000001",
        oracleId: "11111111-1111-1111-1111-111111111111",
        firstSet: "tst",
        firstPrintId: "00000000-0000-0000-0000-000000000001",
        firstPrintSet: "tst",
        ...overrides,
    };
}

describe("graduateCompiledEntries (issue #2702 round 3)", () => {
    it("clears the stale tag when a compiled row's id joins the hand-written registry", () => {
        const graduatedRow = entry({ source: "compiled" });
        const registryIds = new Set([graduatedRow.scryfallId]);

        const graduated = graduateCompiledEntries([graduatedRow], registryIds);

        expect(graduated).toBe(1);
        expect(graduatedRow.source).toBeUndefined();
    });

    it("leaves a still-compiled-only row (no hand-written definition yet) untouched", () => {
        const compiledRow = entry({ source: "compiled" });
        const registryIds = new Set<string>(); // no hand-written card for it

        const graduated = graduateCompiledEntries([compiledRow], registryIds);

        expect(graduated).toBe(0);
        expect(compiledRow.source).toBe("compiled");
    });

    it("leaves an already hand-written row (no `source` at all) untouched", () => {
        const handWrittenRow = entry(); // no `source` field
        const registryIds = new Set([handWrittenRow.scryfallId]);

        const graduated = graduateCompiledEntries(
            [handWrittenRow],
            registryIds
        );

        expect(graduated).toBe(0);
        expect(handWrittenRow.source).toBeUndefined();
    });

    it("only graduates the row whose id actually joined the registry, among several", () => {
        const stillCompiled = entry({
            scryfallId: "00000000-0000-0000-0000-000000000002",
            source: "compiled",
        });
        const graduates = entry({
            scryfallId: "00000000-0000-0000-0000-000000000003",
            source: "compiled",
        });
        const registryIds = new Set([graduates.scryfallId]);

        const graduated = graduateCompiledEntries(
            [stillCompiled, graduates],
            registryIds
        );

        expect(graduated).toBe(1);
        expect(stillCompiled.source).toBe("compiled");
        expect(graduates.source).toBeUndefined();
    });
});
