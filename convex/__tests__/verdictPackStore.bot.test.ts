// The deployment's pack writer (issue #3583, ADR 0128 §7 / §9). Claims:
//
//  - the pack a deployment stores for a list of ids is the pack a machine
//    derives from the same objects — same hash, and it loads under a lock
//    naming that hash;
//  - storing it again is idempotent;
//  - an id the store lacks, or names twice, writes nothing;
//  - a name already holding other bytes is refused on re-read, not believed.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { VerdictJudgement } from "../gre/ai/verdicts/identity";
import { verdictPackObjectName } from "../gre/ai/verdicts/pack";
import { storeVerdictPack, type VerdictPackCodec } from "../verdictPackStore";
import {
    VerdictStoreIntegrityError,
    putVerdict,
    readVerdict,
} from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";
import {
    loadLockedVerdicts,
    packVerdicts,
} from "../../scripts/lib/verdict-pack-cache";

const CODEC: VerdictPackCodec = {
    gzip: (text) => new Uint8Array(gzipSync(text)),
    gunzip: (bytes) => gunzipSync(bytes).toString("utf8"),
};

const judgement = (index: number): VerdictJudgement => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
    ],
    answer: { kind: "right", rightIndexes: [index] },
});

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const packNames = (store: ReturnType<typeof createMemoryVerdictStore>) =>
    [...store.objects.keys()].filter((n) => n.startsWith("packs/"));

describe("storeVerdictPack (issue #3583)", () => {
    it("stores the pack a machine derives from the same objects, and it loads", async () => {
        const store = createMemoryVerdictStore();
        const a = (await putVerdict(store, judgement(1))).verdictId;
        const b = (await putVerdict(store, judgement(0))).verdictId;

        const stored = await storeVerdictPack(store, [b, a], CODEC);

        const machine = packVerdicts(
            await Promise.all(
                [b, a].map(async (verdictId) => ({
                    verdictId,
                    payload: await readVerdict(store, verdictId),
                }))
            )
        );
        expect(stored).toMatchObject({
            packHash: machine.packHash,
            name: verdictPackObjectName(machine.packHash),
            verdicts: 2,
            outcome: "created",
        });
        const cacheDir = mkdtempSync(join(tmpdir(), "verdict-pack-store-"));
        dirs.push(cacheDir);
        const loaded = await loadLockedVerdicts(
            { verdictIds: [b, a], packHash: stored.packHash },
            { cacheDir, store: () => store }
        );
        expect(loaded.verdicts.map((v) => v.id)).toEqual([b, a]);
    });

    it("is idempotent: the same ids answer exists and leave the bytes alone", async () => {
        const store = createMemoryVerdictStore();
        const a = (await putVerdict(store, judgement(1))).verdictId;
        const first = await storeVerdictPack(store, [a], CODEC);
        const bytes = store.objects.get(first.name)!.slice();
        const second = await storeVerdictPack(store, [a], CODEC);
        expect(second).toEqual({ ...first, outcome: "exists" });
        expect(store.objects.get(first.name)).toEqual(bytes);
    });

    it("writes nothing for an id the store lacks, or one named twice", async () => {
        const store = createMemoryVerdictStore();
        const a = (await putVerdict(store, judgement(1))).verdictId;
        const absent = (
            await putVerdict(createMemoryVerdictStore(), judgement(0))
        ).verdictId;
        await expect(
            storeVerdictPack(store, [a, absent], CODEC)
        ).rejects.toThrow(/has no verdicts\//);
        await expect(storeVerdictPack(store, [a, a], CODEC)).rejects.toThrow(
            /named twice/
        );
        expect(packNames(store)).toEqual([]);
    });

    it("refuses a pack name that already holds other bytes", async () => {
        const store = createMemoryVerdictStore();
        const a = (await putVerdict(store, judgement(1))).verdictId;
        const { packHash } = packVerdicts([
            { verdictId: a, payload: await readVerdict(store, a) },
        ]);
        store.objects.set(
            verdictPackObjectName(packHash),
            gzipSync("not it\n")
        );
        await expect(
            storeVerdictPack(store, [a], CODEC)
        ).rejects.toBeInstanceOf(VerdictStoreIntegrityError);
    });
});
