// The strict setup-flow import in a CLIENT graph (issue #5616, PRD #5602):
// names resolve through the compiled Definition Index, and only the pasted
// deck's own shards are installed — never the catalogue. Unknown names are
// still reported line by line.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HandWrittenDefinitionIndex } from "@convex/cards/definitionIndex";
import definitionIndexJson from "../../../data/catalogue/definition-index.json";
import { installCompiledIndex } from "../catalogue/compiled-shards";
import {
    compiledIndexUrl,
    compiledShardUrl,
    shardDictionaryUrl,
} from "../catalogue/compiled-shards";
import {
    PACKED,
    fetchedUrls,
    serveCompiledAssets,
} from "../catalogue/__tests__/compiledShardFixtures";
import { strictImportWithPrintings } from "../matchSetupDeckImport";

// The client graph, as `catalogueArtifact.test.ts` asks for it.
vi.mock(
    "@convex/cards/compiledPool",
    () => import("../catalogue/compiled-pool.browser")
);
vi.mock(
    "@convex/cards/setModules",
    () => import("../catalogue/set-modules.browser")
);

const HAND = (definitionIndexJson as unknown as HandWrittenDefinitionIndex)
    .entries[0]!;
/** A compiled card, and its first-printing Set: the one shard it needs. */
const COMPILED = { name: PACKED.names[0]!, set: PACKED.setCodes[0]! };
const noPrintings = async () => new Map();

afterEach(() => vi.unstubAllGlobals());

describe("strictImportWithPrintings — a client graph", () => {
    it("reports an unknown name, having fetched the names index and the known cards' shards only", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        await installCompiledIndex();
        const result = await strictImportWithPrintings(
            "Mine",
            `4 ${COMPILED.name}\n1 ${HAND[1]}\n4 Not A Real Card`,
            "freeform",
            noPrintings
        );
        expect(result).toEqual({
            ok: false,
            errors: ["Unsupported line: 4 Not A Real Card"],
        });
        expect(fetchedUrls(fetchMock).sort()).toEqual(
            [
                compiledIndexUrl,
                shardDictionaryUrl,
                compiledShardUrl(COMPILED.set)!,
            ].sort()
        );
    });

    it("resolves every name — compiled and hand-written — to a validated deck", async () => {
        vi.stubGlobal("fetch", serveCompiledAssets());
        const result = await strictImportWithPrintings(
            "Mine",
            `4 ${COMPILED.name}\n1 ${HAND[1]}`,
            "freeform",
            noPrintings
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.payload.cards.map((c) => c.cardName)).toEqual([
                ...Array(4).fill(COMPILED.name),
                HAND[1],
            ]);
            expect(result.payload.cards.at(-1)!.cardId).toBe(HAND[0]);
        }
    });
});
