// The Verdict Store port, against the in-memory fake (issue #3576, ADR 0128
// §1/§3). Every claim here is a property of the PORT's contract or of the
// decisions above it — the GCS transport honours the same contract and is not
// exercised here (its request shape is pinned in
// `scripts/__tests__/verdict-store-credentials.test.ts`).
//
// A `.bot.test.ts` because it builds verdicts through `convex/gre/ai/verdicts`
// (`bot-suite-boundary.test.ts`).

import { describe, expect, it } from "vitest";
import type { VerdictJudgement } from "../gre/ai/verdicts/identity";
import { verdictIdOf } from "../gre/ai/verdicts/identity";
import {
    ALIAS_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    VerdictStoreIntegrityError,
    decodeAliasObject,
    encodeAliasObject,
    putAlias,
    encodeVerdictObject,
    putVerdict,
    readVerdict,
    verdictObjectName,
} from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";

const JUDGEMENT: VerdictJudgement = {
    spec: {
        cards: [],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 7 },
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [1] },
};

/** The same position judged the other way: a different verdict id. */
const OTHER: VerdictJudgement = {
    ...JUDGEMENT,
    answer: { kind: "right", rightIndexes: [0] },
};

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array | null) =>
    bytes === null ? null : new TextDecoder().decode(bytes);

describe("Verdict Store port contract (in-memory fake)", () => {
    it("put of an existing name answers 'exists' and leaves the stored bytes untouched", async () => {
        const store = createMemoryVerdictStore();
        expect(await store.put("a", bytesOf("first"), "text/plain")).toBe(
            "created"
        );
        expect(await store.put("a", bytesOf("second"), "text/plain")).toBe(
            "exists"
        );
        expect(textOf(await store.get("a"))).toBe("first");
    });

    it("get of a missing name is null, not a throw", async () => {
        expect(await createMemoryVerdictStore().get("nope")).toBeNull();
    });

    it("list returns sorted names under the prefix only", async () => {
        const store = createMemoryVerdictStore();
        for (const name of ["verdicts/b", "attestations/x", "verdicts/a"]) {
            await store.put(name, bytesOf(name), "text/plain");
        }
        expect(await store.list("verdicts/")).toEqual([
            "verdicts/a",
            "verdicts/b",
        ]);
    });

    it("a caller mutating a buffer it passed or received cannot reach the stored bytes", async () => {
        const store = createMemoryVerdictStore();
        const sent = bytesOf("abc");
        await store.put("a", sent, "text/plain");
        sent[0] = 0x7a;
        const got = (await store.get("a"))!;
        got[1] = 0x7a;
        expect(textOf(await store.get("a"))).toBe("abc");
    });
});

describe("putVerdict / readVerdict", () => {
    it("names the object by the verdict id and reads the judgement back", async () => {
        const store = createMemoryVerdictStore();
        const { verdictId, name, outcome } = await putVerdict(store, JUDGEMENT);
        expect(outcome).toBe("created");
        expect(verdictId).toBe(verdictIdOf(JUDGEMENT));
        expect(name).toBe(`${VERDICT_OBJECT_PREFIX}${verdictId}.json`);
        expect(await readVerdict(store, verdictId)).toEqual(JUDGEMENT);
    });

    it("stores the judgement only — no author, note, timestamp or origin", () => {
        const withAttestationFields = {
            ...JUDGEMENT,
            author: "dev:user123",
            note: "burn face",
            createdAt: "2026-09-15T10:00:00.000Z",
            origin: { gameId: "g42", seq: 17 },
        } as VerdictJudgement;
        const text = textOf(encodeVerdictObject(withAttestationFields).bytes)!;
        expect(Object.keys(JSON.parse(text)).sort()).toEqual([
            "answer",
            "candidates",
            "seat",
            "spec",
        ]);
    });

    it("the same judgement recorded again — reordered keys, another author — is one object", async () => {
        const store = createMemoryVerdictStore();
        await putVerdict(store, JUDGEMENT);
        const reordered = {
            answer: JUDGEMENT.answer,
            candidates: JUDGEMENT.candidates,
            seat: JUDGEMENT.seat,
            spec: { ...JUDGEMENT.spec },
            author: "prod:someone-else",
        } as VerdictJudgement;
        expect((await putVerdict(store, reordered)).outcome).toBe("exists");
        expect(store.objects.size).toBe(1);
    });

    it("an empty setup is one encoding with an absent one — whoever writes first", () => {
        const withEmpty = encodeVerdictObject({
            ...JUDGEMENT,
            setup: [],
            deckKnowledge: [],
        });
        expect(withEmpty.bytes).toEqual(encodeVerdictObject(JUDGEMENT).bytes);
    });

    it("reading an id the store does not hold is null", async () => {
        expect(
            await readVerdict(createMemoryVerdictStore(), verdictIdOf(OTHER))
        ).toBeNull();
    });

    it("refuses to name an object after something that is not a verdict id", () => {
        expect(() => verdictObjectName("../escape")).toThrow(
            /Not a verdict id/
        );
    });
});

describe("a read whose bytes do not match the requested hash fails loudly", () => {
    it("another judgement's bytes under this id's name", async () => {
        const store = createMemoryVerdictStore();
        const wanted = encodeVerdictObject(JUDGEMENT);
        store.objects.set(wanted.name, encodeVerdictObject(OTHER).bytes);
        const read = readVerdict(store, wanted.verdictId);
        await expect(read).rejects.toBeInstanceOf(VerdictStoreIntegrityError);
        await expect(read).rejects.toThrow(
            new RegExp(`hashes to ${verdictIdOf(OTHER)}`)
        );
    });

    it("bytes that are not JSON", async () => {
        const store = createMemoryVerdictStore();
        const { name, verdictId } = encodeVerdictObject(JUDGEMENT);
        store.objects.set(name, bytesOf("{not json"));
        await expect(readVerdict(store, verdictId)).rejects.toThrow(
            /unreadable/
        );
    });

    it("a field outside the judgement, even though the hash does not see it", async () => {
        const store = createMemoryVerdictStore();
        const { name, verdictId } = encodeVerdictObject(JUDGEMENT);
        const smuggled = { ...JUDGEMENT, author: "evil" };
        store.objects.set(name, bytesOf(JSON.stringify(smuggled)));
        await expect(readVerdict(store, verdictId)).rejects.toThrow(
            /not the canonical encoding/
        );
    });

    it("the right judgement in non-canonical bytes (reformatted)", async () => {
        const store = createMemoryVerdictStore();
        const { name, verdictId } = encodeVerdictObject(JUDGEMENT);
        store.objects.set(name, bytesOf(JSON.stringify(JUDGEMENT, null, 2)));
        await expect(readVerdict(store, verdictId)).rejects.toThrow(
            /not the canonical encoding/
        );
    });

    it("bytes that are not UTF-8", async () => {
        const store = createMemoryVerdictStore();
        const { name, verdictId } = encodeVerdictObject(JUDGEMENT);
        store.objects.set(name, new Uint8Array([0x7b, 0xff, 0x7d]));
        await expect(readVerdict(store, verdictId)).rejects.toThrow(
            /unreadable/
        );
    });
});

describe("author aliases (issue #3585)", () => {
    const DEV = "dev-a:owner1";
    const PROD = "prod-b:owner2";

    it("names one fact once, whichever order the authors come in", async () => {
        const store = createMemoryVerdictStore();
        const first = await putAlias(store, { authors: [PROD, DEV] });
        const second = await putAlias(store, { authors: [DEV, PROD] });
        expect(first).toEqual({
            name: `${ALIAS_OBJECT_PREFIX}${DEV}/${PROD}`,
            outcome: "created",
        });
        expect(second.outcome).toBe("exists");
        expect(
            decodeAliasObject(first.name, (await store.get(first.name))!)
        ).toEqual({ authors: [DEV, PROD] });
    });

    it("refuses an alias joining an author to itself, or naming an email", () => {
        expect(() => encodeAliasObject({ authors: [DEV, DEV] })).toThrow(
            /to itself/
        );
        expect(() =>
            encodeAliasObject({ authors: [DEV, "someone@example.com"] })
        ).toThrow(/Not a verdict author/);
    });

    it("refuses an object that joins other authors than its name promises, or is not canonical", () => {
        const { name, bytes } = encodeAliasObject({ authors: [DEV, PROD] });
        const elsewhere = `${ALIAS_OBJECT_PREFIX}${DEV}/prod-b:someone`;
        expect(() => decodeAliasObject(elsewhere, bytes)).toThrow(
            VerdictStoreIntegrityError
        );
        const spaced = bytesOf(
            JSON.stringify({ authors: [DEV, PROD] }, null, 2)
        );
        expect(() => decodeAliasObject(name, spaced)).toThrow(/canonical/);
    });
});
