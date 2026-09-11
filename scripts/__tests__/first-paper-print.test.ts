// The fail-closed first-printing resolver and the two row builders that call
// it (issue #3423).
//
// THE DEFECT THIS PINS. Both backfills used to resolve a card's earliest paper
// printing with a copy of `firstPaperPrint` that, when Scryfall did not
// answer, logged a `console.warn` and returned THE PRINT IN HAND. The caller
// wrote that guess into both `scryfallId` and `firstPrintId`, and
// `check-card-index.ts` checks precisely those two fields AGAINST EACH OTHER
// (`e.firstPrintId !== e.scryfallId`). A row poisoned by the fallback is
// self-consistent by construction, so `check:index` printed "every card on its
// first printing" over Shadowblood Ridge while it sat on `dsc` (Duskmourn
// Commander, 2024) instead of `ody` (Odyssey, 2001).
//
// So the contract under test is not "the resolver retries": it is that a
// failed lookup produces NO ROW AT ALL, and that the run carries the failure
// out in its exit code rather than in a warning nobody re-reads.

import { describe, expect, it, vi } from "vitest";
import {
    resolveFirstPaperPrint,
    NON_PRINT_SET_TYPES,
} from "../lib/first-paper-print";
import {
    buildEntriesForChunk,
    refreshEntries,
    selectRefreshRows,
    type Entry,
    type Resolved,
} from "../backfill-card-index";
import {
    buildCompiledEntriesForChunk,
    type Resolved as CompiledResolved,
} from "../oracle-index-backfill";

const ORACLE = "15687ee3-3cdb-4a8f-a726-46b73bceb792"; // Shadowblood Ridge
const ODY_ID = "69a5f84a-9e9b-42b6-a973-864409d6e564";
const DSC_ID = "d7af1d6b-ff13-4886-a212-4a6e09153475";

const noSleep = async () => {};

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: new Headers(),
    } as unknown as Response;
}

function print(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: ODY_ID,
        set: "ody",
        set_type: "expansion",
        digital: false,
        rarity: "rare",
        ...over,
    };
}

describe("resolveFirstPaperPrint (issue #3423)", () => {
    it("returns the earliest paper printing", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                data: [print(), print({ id: DSC_ID, set: "dsc" })],
            })
        );

        const first = await resolveFirstPaperPrint(ORACLE, {
            fetch: fetchImpl as unknown as typeof fetch,
            sleep: noSleep,
        });

        expect(first).toEqual({ id: ODY_ID, set: "ody", rarity: "rare" });
    });

    it("returns null — never the print in hand — when Scryfall keeps answering 429", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({}, 429));

        const first = await resolveFirstPaperPrint(ORACLE, {
            fetch: fetchImpl as unknown as typeof fetch,
            sleep: noSleep,
        });

        expect(first).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(4); // retried, then gave up
    });

    it("returns null on a non-retryable error response", async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({}, 404));

        expect(
            await resolveFirstPaperPrint(ORACLE, {
                fetch: fetchImpl as unknown as typeof fetch,
                sleep: noSleep,
            })
        ).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("returns null when every attempt throws (offline)", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error("getaddrinfo ENOTFOUND api.scryfall.com");
        });

        expect(
            await resolveFirstPaperPrint(ORACLE, {
                fetch: fetchImpl as unknown as typeof fetch,
                sleep: noSleep,
            })
        ).toBeNull();
    });

    it("returns null when nothing in the response is a paper printing", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                data: [
                    print({ digital: true, set: "mtgo" }),
                    print({ set_type: "token" }),
                    print({ set_type: "funny" }),
                ],
            })
        );

        expect(
            await resolveFirstPaperPrint(ORACLE, {
                fetch: fetchImpl as unknown as typeof fetch,
                sleep: noSleep,
            })
        ).toBeNull();
        // The four types the filter drops, pinned so a rename can't widen it.
        expect([...NON_PRINT_SET_TYPES].sort()).toEqual([
            "funny",
            "memorabilia",
            "minigame",
            "token",
        ]);
    });
});

describe("buildEntriesForChunk — hand-written backfill (issue #3423)", () => {
    const chunk = [{ id: DSC_ID, name: "Shadowblood Ridge" }];
    const batch: Resolved = new Map([
        [DSC_ID, { oracleId: ORACLE, set: "dsc", reprint: true }],
    ]);

    it("writes NO row when the prints lookup fails, and reports the card", async () => {
        const built = await buildEntriesForChunk(
            chunk,
            batch,
            async () => null
        );

        expect(built.entries).toEqual([]);
        expect(built.unresolvedPrints).toEqual([
            { id: DSC_ID, name: "Shadowblood Ridge" },
        ]);
        // The defect in one assertion: no emitted row may carry the print in
        // hand in BOTH fields, because that pair is what the guard compares.
        expect(built.entries.some((e) => e.scryfallId === e.firstPrintId)).toBe(
            false
        );
    });

    it("writes the resolved first printing when the lookup succeeds", async () => {
        const built = await buildEntriesForChunk(chunk, batch, async () => ({
            id: ODY_ID,
            set: "ody",
            rarity: "rare",
        }));

        expect(built.unresolvedPrints).toEqual([]);
        expect(built.entries[0]).toMatchObject({
            scryfallId: DSC_ID, // the CardDefinition's own id, unchanged
            firstPrintId: ODY_ID,
            firstPrintSet: "ody",
        });
    });

    it("never consults the resolver for a print that is not a reprint", async () => {
        const resolvePrint = vi.fn(async () => null);
        const ownPrint: Resolved = new Map([
            [ODY_ID, { oracleId: ORACLE, set: "ody", reprint: false }],
        ]);

        const built = await buildEntriesForChunk(
            [{ id: ODY_ID, name: "Shadowblood Ridge" }],
            ownPrint,
            resolvePrint
        );

        expect(resolvePrint).not.toHaveBeenCalled();
        expect(built.entries[0].firstPrintId).toBe(ODY_ID);
    });
});

describe("buildCompiledEntriesForChunk — compiled backfill (issue #3423)", () => {
    const chunk = [{ oracleId: ORACLE, name: "Shadowblood Ridge" }];
    const batch: CompiledResolved = new Map([
        [ORACLE, { id: DSC_ID, set: "dsc", rarity: "rare", reprint: true }],
    ]);

    it("writes NO row when the prints lookup fails — this is the shipped instance", async () => {
        const built = await buildCompiledEntriesForChunk(
            chunk,
            batch,
            async () => null
        );

        expect(built.entries).toEqual([]);
        expect(built.unresolvedPrints).toEqual([
            { oracleId: ORACLE, name: "Shadowblood Ridge" },
        ]);
    });

    it("pins the compiled row's own id to the first printing when it resolves", async () => {
        const built = await buildCompiledEntriesForChunk(
            chunk,
            batch,
            async () => ({ id: ODY_ID, set: "ody", rarity: "rare" })
        );

        expect(built.entries[0]).toMatchObject({
            scryfallId: ODY_ID,
            firstPrintId: ODY_ID,
            firstPrintSet: "ody",
            rarity: "rare",
            source: "compiled",
        });
    });

    it("still skips an unmodelled rarity rather than coercing it", async () => {
        const built = await buildCompiledEntriesForChunk(
            chunk,
            batch,
            async () => ({ id: ODY_ID, set: "ody", rarity: "bonus" })
        );

        expect(built.entries).toEqual([]);
        expect(built.skippedRarity).toEqual([
            { name: "Shadowblood Ridge", rarity: "bonus" },
        ]);
        expect(built.unresolvedPrints).toEqual([]);
    });
});

describe("--refresh: re-resolving a row already in the lockfile (issue #3423)", () => {
    function compiledRow(): Entry {
        return {
            name: "Shadowblood Ridge",
            scryfallId: DSC_ID,
            oracleId: ORACLE,
            firstSet: "dsc",
            firstPrintId: DSC_ID,
            firstPrintSet: "dsc",
            source: "compiled",
        };
    }

    it("moves a compiled row's own id, because that id IS the first printing", async () => {
        const row = compiledRow();

        const { changed, unresolved } = await refreshEntries(
            [row],
            async () => ({ id: ODY_ID, set: "ody", rarity: "rare" })
        );

        expect(unresolved).toEqual([]);
        expect(changed).toHaveLength(1);
        expect(row).toMatchObject({
            scryfallId: ODY_ID,
            firstSet: "ody",
            firstPrintId: ODY_ID,
            firstPrintSet: "ody",
            rarity: "rare",
        });
    });

    it("leaves a hand-written row's scryfallId alone so ADR 0041 drift stays visible", async () => {
        const row: Entry = { ...compiledRow() };
        delete row.source;

        await refreshEntries([row], async () => ({
            id: ODY_ID,
            set: "ody",
            rarity: "rare",
        }));

        // The CardDefinition's id must not be rewritten under the guard's
        // feet: check:index compares it to firstPrintId and reds.
        expect(row.scryfallId).toBe(DSC_ID);
        expect(row.firstPrintId).toBe(ODY_ID);
    });

    it("changes nothing when the lookup fails", async () => {
        const row = compiledRow();
        const before = { ...row };

        const { changed, unresolved } = await refreshEntries(
            [row],
            async () => null
        );

        expect(changed).toEqual([]);
        expect(unresolved).toEqual([row]);
        expect(row).toEqual(before);
    });

    it("reports no change when the row is already on its first printing", async () => {
        const row = compiledRow();
        row.scryfallId = ODY_ID;
        row.firstSet = "ody";
        row.firstPrintId = ODY_ID;
        row.firstPrintSet = "ody";

        const { changed } = await refreshEntries([row], async () => ({
            id: ODY_ID,
            set: "ody",
            rarity: "",
        }));

        expect(changed).toEqual([]);
    });

    it("selects rows by name, oracle id or print id — and nothing else", () => {
        const rows = [
            compiledRow(),
            {
                ...compiledRow(),
                name: "Other Card",
                scryfallId: "x",
                oracleId: "y",
            },
        ];

        expect(selectRefreshRows(rows, "shadowblood ridge")).toHaveLength(1);
        expect(selectRefreshRows(rows, ORACLE)).toHaveLength(1);
        expect(selectRefreshRows(rows, DSC_ID)).toHaveLength(1);
        expect(selectRefreshRows(rows, "Shadowblood")).toEqual([]);
    });
});
