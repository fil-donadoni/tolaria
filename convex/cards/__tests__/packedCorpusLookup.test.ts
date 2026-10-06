// `getDefinition` reads a compiled row from the PACKED corpus, one block at a
// time, on first request (issue #4165; the only path since issue #4168, PRD
// #4161, ADR 0113 Amendment III).
//
// The catalogue is loaded FRESH here (`vi.resetModules` + a dynamic import),
// so its registry starts with no compiled row and its block memo empty,
// whatever an earlier file in this worker (`isolate: false`) resolved.
//
// That the packed rows ARE the catalogue's compiled rows is not asserted here:
// the generator's decode-equality guard (`packedCorpusDrift`,
// `scripts/lib/packed-corpus.ts`, run by `catalogue:check` and
// `scripts/__tests__/catalogue-artifact.test.ts`) is the standing proof — it
// decodes every block and compares it with the merge it was written from.
//
// Test ORDER is load-bearing, and deliberate: the memo grows as the file runs,
// so the cold-start claims come first.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as CardsIndex from "../index";
import { blockFor, createPackedLookup } from "../packedCorpus";
import { packedServerCorpus } from "../compiledPool";
import { TREASURE_TOKEN } from "../sharedTokens";

type CardsModule = typeof CardsIndex;

let packed: CardsModule;

beforeAll(async () => {
    vi.resetModules();
    try {
        packed = (await import("../index")) as CardsModule;
    } finally {
        // The next file in this worker must not inherit this graph's memo.
        vi.resetModules();
    }
}, 120_000);

afterAll(() => {
    vi.resetModules();
});

const corpus = packedServerCorpus!;
const compiledIds = corpus.ids;
const compiledIdSet = new Set(compiledIds);

describe("loading the catalogue (issue #4165)", () => {
    it("preloads no compiled row and inflates no block", () => {
        expect(compiledIds.length).toBeGreaterThan(1000);
        expect(packed.packedCorpusInflations()).toBe(0);
        const preloaded = [...packed.residentDefinitionIds()].filter((id) =>
            compiledIdSet.has(id)
        );
        expect(preloaded).toEqual([]);
    });

    it("hand-written definitions and tokens resolve without inflating a block", () => {
        const handWritten = packed.getAllRawCards().map((def) => def.id);
        expect(handWritten.length).toBeGreaterThan(500);
        for (const id of handWritten) {
            expect(packed.getDefinition(id).id).toBe(id);
        }
        const token = packed.tokenDefinitionId(TREASURE_TOKEN);
        expect(packed.getDefinition(token).id).toBe(token);
        expect(packed.packedCorpusInflations()).toBe(0);
    });
});

describe("the packed lookup's memo (issue #4165)", () => {
    it("looking the same id up twice inflates its block once, and a neighbour in that block inflates nothing", () => {
        const id = corpus.firstIds[1]!;
        const before = packed.packedCorpusInflations();
        const first = packed.getDefinition(id);
        expect(packed.packedCorpusInflations()).toBe(before + 1);
        expect(packed.getDefinition(id)).toBe(first);
        expect(packed.tryGetDefinition(id)).toBe(first);
        const neighbour = compiledIds.find(
            (other) => other !== id && blockFor(corpus, other) === 1
        )!;
        packed.getDefinition(neighbour);
        expect(packed.packedCorpusInflations()).toBe(before + 1);
    });

    it("an unknown id still throws from getDefinition and is null from tryGetDefinition", () => {
        const unknownUuid = "ffffffff-ffff-4fff-bfff-ffffffffffff";
        expect(compiledIdSet.has(unknownUuid)).toBe(false);
        for (const id of [
            unknownUuid,
            "00000000-0000-4000-8000-000000000000",
            "not-a-card",
            `${compiledIds[0]}#nonsense`,
        ]) {
            expect(() => packed.getDefinition(id)).toThrow(
                `Card not found: ${id}`
            );
            expect(packed.tryGetDefinition(id)).toBeNull();
        }
    });

    it("a fresh lookup serves every compiled row, inflating each block once", () => {
        const lookup = createPackedLookup(corpus);
        for (const id of compiledIds) expect(lookup.lookup(id)?.id).toBe(id);
        expect(lookup.inflations()).toBe(corpus.firstIds.length);
    });
});
