// `getDefinition` falls back to the PACKED corpus behind a switch, and over the
// whole pool it returns what the literal path returns (issue #4165, PRD #4161,
// ADR 0113 Amendment III).
//
// Two module graphs side by side in one file: the LITERAL one is this file's
// static imports (switch off, the compiled pool preloaded as it always was);
// the PACKED one is loaded fresh with `TOLARIA_PACKED_CORPUS_LOOKUP=on`, so its
// registry starts with no compiled row and every compiled id it is asked for
// goes through the lazy source. A definition carries closures (the keyword
// expanders' `resolve` hooks), and two graphs mint two copies of each, so
// "deep-equal" here is the canonical serialisation below — every data field
// compared, every function compared by its source.
//
// Test ORDER is load-bearing, and deliberate: the packed graph's memo grows as
// the file runs, so the cold-start claims come first and the whole-pool
// equivalence — which ends with every block inflated — comes last.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as literal from "../index";
import { compiledReadyDefinitions } from "../compiledPool";
import { blockFor, createPackedLookup } from "../packedCorpus";
import { packedServerCorpus } from "../compiledPool";
import { parentIdOfTwin } from "../twinId";
import { TREASURE_TOKEN } from "../sharedTokens";

type CardsModule = typeof literal;

let packed: CardsModule;

beforeAll(async () => {
    vi.stubEnv("TOLARIA_PACKED_CORPUS_LOOKUP", "on");
    vi.resetModules();
    try {
        packed = (await import("../index")) as CardsModule;
    } finally {
        vi.unstubAllEnvs();
        // The next file in this worker (`isolate: false`) must not inherit the
        // switched-on graph from the module cache.
        vi.resetModules();
    }
}, 120_000);

afterAll(() => {
    vi.resetModules();
});

const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, v: unknown) =>
        typeof v === "function" ? `fn:${String(v)}` : v
    );

const compiledIds = compiledReadyDefinitions.map((row) => row.id);
const compiledIdSet = new Set(compiledIds);
const corpus = packedServerCorpus!;

/** Every derived face (CR 715.2 / 709.3b / 712.8f) the literal path minted
 *  for a compiled row. */
const derivedFaceIds = (): string[] =>
    [...literal.registeredDefinitions()]
        .map((def) => def.id)
        .filter((id) => {
            const parent = parentIdOfTwin(id);
            return parent !== undefined && compiledIdSet.has(parent);
        });

describe("the switch (issue #4165)", () => {
    it("is off by default: the literal graph serves every compiled row and inflates nothing", () => {
        // Issue #4856: off, a compiled row is served from the literal pool on
        // first request (the Definition Index locates it) — no longer
        // preloaded at load, and still never from a packed block.
        const unresolved = compiledIds.filter(
            (id) => literal.tryGetDefinition(id)?.id !== id
        );
        expect(unresolved).toEqual([]);
        expect(literal.packedCorpusInflations()).toBe(0);
    });

    it("switched on, loading the catalogue preloads no compiled row and inflates no block", () => {
        expect(packed.packedCorpusInflations()).toBe(0);
        const preloaded = [...packed.residentDefinitionIds()].filter((id) =>
            compiledIdSet.has(id)
        );
        expect(preloaded).toEqual([]);
    });

    it("hand-written definitions and tokens resolve exactly as before and inflate nothing", () => {
        const handWritten = literal.getAllRawCards().map((def) => def.id);
        expect(handWritten.length).toBeGreaterThan(500);
        for (const id of handWritten) {
            expect(canonical(packed.getDefinition(id))).toBe(
                canonical(literal.getDefinition(id))
            );
        }
        const token = literal.tokenDefinitionId(TREASURE_TOKEN);
        expect(canonical(packed.getDefinition(token))).toBe(
            canonical(literal.getDefinition(token))
        );
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
            expect(literal.tryGetDefinition(id)).toBeNull();
        }
    });

    it("a fresh lookup inflates each block at most once across the whole pool", () => {
        const lookup = createPackedLookup(corpus);
        for (const id of compiledIds) expect(lookup.lookup(id)?.id).toBe(id);
        expect(lookup.inflations()).toBe(corpus.firstIds.length);
    });
});

describe("equivalence over the whole pool (issue #4165)", () => {
    it("every derived face and every compiled row resolves deep-equal to the literal path", () => {
        // Derived faces FIRST, so each resolves through a parent that is not
        // yet resident: the lazy derivation, not the eager one, is what runs.
        const faces = derivedFaceIds();
        expect(faces.length).toBeGreaterThan(0);
        const mismatches: string[] = [];
        const compare = (id: string): void => {
            const got = packed.tryGetDefinition(id);
            const want = literal.getDefinition(id);
            if (got === null || canonical(got) !== canonical(want)) {
                mismatches.push(`${want.name} (${id})`);
            }
        };
        for (const id of faces) compare(id);
        for (const id of compiledIds) compare(id);
        expect(mismatches.slice(0, 5)).toEqual([]);
        expect(packed.packedCorpusInflations()).toBe(corpus.firstIds.length);
    });
});
