import { describe, it, expect } from "vitest";
import { resolveCardExport } from "@convex/cards/defineCard";
import type { HandWrittenDefinitionIndex } from "@convex/cards/definitionIndex";
import { setModuleSource as serverSets } from "@convex/cards/setModules";
import { tryGetDefinition } from "@convex/cards/registry";
import { handWrittenSetCodeOf } from "@convex/cards/catalogue";
import { twinDefinitionId } from "@convex/cards/twinId";
import definitionIndexJson from "../../../../data/catalogue/definition-index.json";
import { setModuleSource as browserSets } from "../set-modules.browser";
import {
    allSetCodes,
    installShards,
    isKnownSetCode,
    isSetResident,
    shardNeededBy,
    shardsNeededFor,
} from "../definitionShards";

/** Every hand-written Set resident. */
const installAllSets = () => installShards(allSetCodes());

/**
 * Issue #5615 (PRD #5602, ADR 0113 Amendment V) — the per-Set path yields
 * the same definitions as the whole-catalogue path.
 *
 * EQUIVALENCE over the whole hand-written Definition Index: every entry's
 * Set installs through the browser seam (`set-chunk-loader`'s `import()`,
 * the real one — under vitest it resolves the Set's real module), and the
 * export the index locates there is the SAME object the server's static
 * list holds, which is what `catalogue.ts` resolves on the server. Identity,
 * not equality: a copy would be a second `defineCard` factory for one card.
 *
 * The loader's bookkeeping (which Sets a board needs, twins through their
 * parent, an unknown code refused) is pinned beside it. Its compiled half
 * (issue #5616) is pinned in a client graph: `compiledShards.test.ts`.
 */

const index = definitionIndexJson as unknown as HandWrittenDefinitionIndex;

describe("the browser seam against the server's Set list", () => {
    it("knows every Set the index names, in the server's order — a Set with no definition has nothing to install", () => {
        const named = new Set(index.entries.map(([, , setCode]) => setCode));
        const expected = serverSets.codes.filter((code) => named.has(code));
        expect([...browserSets.codes]).toEqual(expected);
        expect(allSetCodes()).toEqual(expected);
        expect(expected.length).toBeGreaterThan(100);
        for (const code of expected) {
            expect(isKnownSetCode(code), code).toBe(true);
        }
        expect(isKnownSetCode("nope")).toBe(false);
    });

    it("installs every Set, and each resolves every index entry to the server's own export", async () => {
        expect(isSetResident("lea")).toBe(false);
        await installAllSets();
        let checked = 0;
        for (const [id, name, setCode, exportName] of index.entries) {
            expect(isSetResident(setCode), setCode).toBe(true);
            const viaBrowser = resolveCardExport(
                browserSets.resident(setCode)![exportName]
            );
            const viaServer = resolveCardExport(
                serverSets.resident(setCode)![exportName]
            );
            expect(viaBrowser, `${name} (${id})`).toBeDefined();
            expect(viaBrowser!.id, `${name} (${id})`).toBe(id);
            expect(viaBrowser, `${name} (${id})`).toBe(viaServer);
            checked++;
        }
        expect(checked).toBe(index.entries.length);
        expect(checked).toBeGreaterThan(1000);
    });

    it("rejects a code no Set directory carries, and leaves nothing resident for it", async () => {
        await expect(installShards(["nope"])).rejects.toThrow(
            /Unknown Set module: nope/
        );
        expect(isSetResident("nope")).toBe(false);
    });
});

describe("which shards a set of definition ids needs", () => {
    const [handWritten, , handWrittenSet] = index.entries[0]!;

    it("a hand-written id needs its home Set; a token or a sentinel needs none", () => {
        expect(shardNeededBy(handWritten)).toBe(handWrittenSet);
        expect(shardNeededBy(handWritten)).toBe(
            handWrittenSetCodeOf(handWritten)
        );
        expect(shardNeededBy("face-down:2-2-vanilla")).toBeUndefined();
        expect(shardNeededBy("not-a-card")).toBeUndefined();
    });

    it("a twin needs its parent's Set", () => {
        expect(shardNeededBy(twinDefinitionId(handWritten, "adventure"))).toBe(
            handWrittenSet
        );
    });

    it("lists only the Sets not resident yet, each once, in first-seen order", async () => {
        // Every Set is resident after the equivalence test above ran in this
        // graph — so nothing is needed, whatever the ids.
        await installAllSets();
        expect(
            shardsNeededFor([handWritten, handWritten, "not-a-card"])
        ).toEqual([]);
        // The catalogue answers a resident hand-written card.
        expect(tryGetDefinition(handWritten)?.id).toBe(handWritten);
    });
});
