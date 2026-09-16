// A resolution in the Verdict Store (issue #3582, ADR 0128 §5/§6): an immutable
// object named by its decision, verified on every read, uploaded by the outbox
// drain and marked stored only once it reads back.
//
// Against the in-memory store (`verdictStoreMemory.ts`). A `.bot.test.ts`
// because it derives ids through `convex/gre/ai/verdicts/identity`.

import { describe, expect, it } from "vitest";
import {
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import { resolutionIdOf } from "../gre/ai/verdicts/resolution";
import type { VerdictResolution } from "../gre/ai/verdicts/types";
import {
    VerdictStoreIntegrityError,
    decodeResolutionObject,
    encodeResolutionObject,
    putAttestation,
    putResolution,
    putVerdict,
    readResolution,
    readStoredCorpus,
    resolutionObjectName,
    type VerdictStoreWriter,
} from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";
import {
    directResolutionStore,
    drainResolutionOutbox,
    storeResolutionRow,
    type ResolutionOutboxRow,
} from "../verdictResolutionsOutbox";

const POSITION: Omit<VerdictJudgement, "answer"> = {
    spec: { cards: [{ name: "Mountain", owner: "me" }] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
};
const PASS: VerdictJudgement = {
    ...POSITION,
    answer: { kind: "right", rightIndexes: [0] },
};
const BOLT: VerdictJudgement = {
    ...POSITION,
    answer: { kind: "right", rightIndexes: [1] },
};
const KEY = positionKeyOf(PASS);
const AUTHOR = "jovial-guineapig-250:u-admin";

const RESOLUTION: VerdictResolution = {
    positionKey: KEY,
    acceptedVerdictId: verdictIdOf(BOLT),
    rejected: [{ verdictId: verdictIdOf(PASS), reason: "Bolt is lethal" }],
    author: AUTHOR,
    createdAt: 1_700,
    note: "checked the life totals",
    deployment: "jovial-guineapig-250",
    deploymentKind: "cloud",
};

const ROW: ResolutionOutboxRow = {
    _id: "r-1",
    positionKey: KEY,
    resolutionId: resolutionIdOf(RESOLUTION),
    acceptedVerdictId: RESOLUTION.acceptedVerdictId,
    rejected: RESOLUTION.rejected,
    resolverAuthor: AUTHOR,
    createdAt: 1_700,
    note: "checked the life totals",
    deployment: "jovial-guineapig-250",
    deploymentKind: "cloud",
};

describe("a resolution object", () => {
    it("round-trips under resolutions/<positionKey>/<resolutionId>, provenance kept", async () => {
        const store = createMemoryVerdictStore();
        const put = await putResolution(store, RESOLUTION);
        expect(put).toEqual({
            resolutionId: resolutionIdOf(RESOLUTION),
            name: `resolutions/${KEY}/${resolutionIdOf(RESOLUTION)}`,
            outcome: "created",
        });
        expect(await readResolution(store, KEY, put.resolutionId)).toEqual(
            RESOLUTION
        );
    });

    it("is never overwritten: the same decision at the same moment answers exists", async () => {
        const store = createMemoryVerdictStore();
        await putResolution(store, RESOLUTION);
        const again = await putResolution(store, {
            ...RESOLUTION,
            note: "a later note",
        });
        expect(again.outcome).toBe("exists");
        expect(
            (await readResolution(store, KEY, again.resolutionId))?.note
        ).toBe("checked the life totals");
    });

    it("refuses bytes stored under a name their decision does not hash to", () => {
        const { bytes } = encodeResolutionObject(RESOLUTION);
        const other = resolutionIdOf({ ...RESOLUTION, author: "x:y" });
        expect(() =>
            decodeResolutionObject(resolutionObjectName(KEY, other), bytes)
        ).toThrow(VerdictStoreIntegrityError);
    });

    it("refuses to encode a resolution that is not a decision, or an email author", () => {
        expect(() =>
            encodeResolutionObject({
                ...RESOLUTION,
                rejected: [{ verdictId: verdictIdOf(PASS), reason: " " }],
            })
        ).toThrow(/rejected without a reason/);
        expect(() =>
            encodeResolutionObject({ ...RESOLUTION, author: "a@b.example" })
        ).toThrow(/is not an author/);
    });
});

describe("the whole store, read for review", () => {
    it("returns every verdict, attestation and resolution, each verified", async () => {
        const store = createMemoryVerdictStore();
        await putVerdict(store, PASS);
        await putVerdict(store, BOLT);
        await putAttestation(store, {
            verdictId: verdictIdOf(PASS),
            author: "prod:alice",
            sourceAxis: "explicit",
        });
        await putResolution(store, RESOLUTION);
        const corpus = await readStoredCorpus(store);
        expect(corpus.verdicts.map(verdictIdOf).sort()).toEqual(
            [verdictIdOf(PASS), verdictIdOf(BOLT)].sort()
        );
        expect(corpus.attestations).toHaveLength(1);
        expect(corpus.resolutions).toEqual([RESOLUTION]);
    });

    it("fails loudly on a tampered object rather than skipping it", async () => {
        const store = createMemoryVerdictStore();
        const { name } = await putResolution(store, RESOLUTION);
        store.objects.set(name, new TextEncoder().encode('{"tampered":true}'));
        await expect(readStoredCorpus(store)).rejects.toThrow(
            VerdictStoreIntegrityError
        );
    });
});

/** A store whose uploads answer `created` and keep nothing. */
function forgetfulStore(): VerdictStoreWriter {
    const inner = createMemoryVerdictStore();
    return { ...inner, put: async () => "created" };
}

describe("the resolution outbox drain", () => {
    it("stores a row and marks it only after reading it back", async () => {
        const store = createMemoryVerdictStore();
        const marked: unknown[] = [];
        const report = await drainResolutionOutbox({
            storeRow: directResolutionStore(store),
            now: () => 42,
            pendingResolutions: async () => [ROW],
            markResolutionStored: async (args) => {
                marked.push(args);
            },
        });
        expect(report).toEqual({ stored: 1, pending: [] });
        expect(marked).toEqual([
            { rowId: "r-1", resolutionId: ROW.resolutionId, storedAt: 42 },
        ]);
        expect(
            await readResolution(store, KEY, ROW.resolutionId)
        ).not.toBeNull();
    });

    it("leaves a row pending when the upload never landed", async () => {
        const marked: unknown[] = [];
        const report = await drainResolutionOutbox({
            storeRow: directResolutionStore(forgetfulStore()),
            now: () => 42,
            pendingResolutions: async () => [ROW],
            markResolutionStored: async (args) => {
                marked.push(args);
            },
        });
        expect(report.stored).toBe(0);
        expect(report.pending).toEqual([
            {
                rowId: "r-1",
                reason: `${ROW.resolutionId} is not in the store after its upload`,
            },
        ]);
        expect(marked).toEqual([]);
    });

    it("leaves a row pending whose decision no longer hashes to its recorded id", async () => {
        const result = await storeResolutionRow(createMemoryVerdictStore(), {
            ...ROW,
            resolutionId: resolutionIdOf({ ...RESOLUTION, author: "x:y" }),
        });
        expect(result.status).toBe("pending");
    });
});
