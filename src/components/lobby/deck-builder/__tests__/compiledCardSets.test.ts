import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllSetCodes, resolveDeckCardMeta } from "@convex/cards/catalogue";
import { FORMAT_RULES, checkSets, type FormatId } from "@convex/formats";
import { searchIndex } from "@/lib/searchIndex";
import { matchesFormatSets, matchesSets } from "../useCardSearch";

// Issue #4363: a compiled card used to reach the client with an EMPTY Set, so
// the Set filter could only ever match hand-written cards and the two
// allowed-Set Formats hid every compiled card. These run the REAL merged
// catalogue through the search pipeline's own predicates — never a hand-built
// row, which is how a dropped field goes unseen.

interface CardIndexRow {
    firstPrintId: string;
    firstPrintSet: string;
    source?: string;
}

const cardIndex = JSON.parse(
    readFileSync(
        resolve(__dirname, "../../../../../data/card-index.json"),
        "utf8"
    )
) as CardIndexRow[];

const rows = searchIndex();
const indexedIds = new Set(rows.map((r) => r.cardId));

/** Compiled cards the engine has, by the Set the card-index says they were
 *  first printed in — derived from the INDEX, not from the field under test. */
const compiledInCatalogue = cardIndex.filter(
    (e) => e.source === "compiled" && indexedIds.has(e.firstPrintId)
);

describe("the Set filter reaches compiled cards (issue #4363)", () => {
    it("Set APC lists every APC card the engine has, compiled and hand-written", () => {
        const found = new Set(
            rows
                .filter((r) => matchesSets(r.prints, ["apc"], "any"))
                .map((r) => r.cardId)
        );
        const compiledApc = compiledInCatalogue.filter(
            (e) => e.firstPrintSet === "apc"
        );
        expect(compiledApc.length).toBeGreaterThanOrEqual(93);
        for (const e of compiledApc)
            expect(found.has(e.firstPrintId)).toBe(true);
        // 93 compiled + 8 hand-written at the time of the issue; the catalogue
        // only grows.
        expect(found.size).toBeGreaterThanOrEqual(101);
    });

    it("no catalogue row reaches the client without a Set", () => {
        const setless = rows
            .filter((r) => r.prints.some((p) => p.setCode === ""))
            .map((r) => r.name);
        expect(setless).toEqual([]);
    });

    it("offers a Set that holds only compiled cards, and no Set without a card", () => {
        const offered = new Set(getAllSetCodes());
        const handWrittenSets = new Set(
            rows
                .filter(
                    (r) =>
                        !compiledInCatalogue.some(
                            (e) => e.firstPrintId === r.cardId
                        )
                )
                .flatMap((r) => r.prints.map((p) => p.setCode))
        );
        const compiledOnlySets = [
            ...new Set(compiledInCatalogue.map((e) => e.firstPrintSet)),
        ].filter((code) => !handWrittenSets.has(code));
        expect(compiledOnlySets.length).toBeGreaterThan(0);
        for (const code of compiledOnlySets)
            expect(offered.has(code)).toBe(true);

        const held = new Set(
            rows.flatMap((r) => r.prints.map((p) => p.setCode))
        );
        const orphans = [...offered].filter((code) => !held.has(code));
        expect(orphans).toEqual([]);
    });
});

describe("allowed-Set Formats: search offers a card iff validation accepts it (issue #4363)", () => {
    const compiledIds = new Set(compiledInCatalogue.map((e) => e.firstPrintId));
    const compiledRows = rows.filter((r) => compiledIds.has(r.cardId));

    for (const format of ["alpha-40", "old-school"] as FormatId[]) {
        const meta = FORMAT_RULES[format];

        it(`${format}: every compiled card is found exactly when checkSets accepts it`, () => {
            let found = 0;
            let rejected = 0;
            for (const row of compiledRows) {
                const offered = matchesFormatSets(
                    row.prints,
                    row.supertypes,
                    meta.allowedSets
                );
                const accepted =
                    checkSets(
                        { cards: [{ cardId: row.cardId, cardName: row.name }] },
                        meta,
                        resolveDeckCardMeta
                    ).length === 0;
                expect(offered, row.name).toBe(accepted);
                if (offered) found++;
                else rejected++;
            }
            // Non-vacuous: both branches are exercised by real cards.
            expect(found).toBeGreaterThan(0);
            expect(rejected).toBeGreaterThan(0);
        });

        it(`${format}: a compiled card first printed in an allowed Set is found, one printed outside is not`, () => {
            const allowedSets = new Set(meta.allowedSets);
            const inside = compiledInCatalogue.find((e) =>
                allowedSets.has(e.firstPrintSet)
            )!;
            const outside = compiledInCatalogue.find(
                (e) => !allowedSets.has(e.firstPrintSet)
            )!;
            const byId = (id: string) => rows.find((r) => r.cardId === id)!;
            for (const [entry, expected] of [
                [inside, true],
                [outside, false],
            ] as const) {
                const row = byId(entry.firstPrintId);
                expect(
                    matchesFormatSets(
                        row.prints,
                        row.supertypes,
                        meta.allowedSets
                    )
                ).toBe(expected);
            }
        });
    }
});
