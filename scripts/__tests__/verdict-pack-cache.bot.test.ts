// The Verdict pack's read path on a development machine (issue #3581, PRD
// #3574, ADR 0128 §9 / §10). Claims:
//
//  - a lock's corpus costs ONE object fetch — no per-verdict GET, no listing;
//  - a pack that is not exactly what the lock pins (another hash, another id
//    set, a payload not re-hashing to its id, not gzip, absent) is refused,
//    and nothing refused is ever cached;
//  - a warm cache makes no network call and builds no store client;
//  - the cache lives under the home directory, keyed by content: two locks
//    over one pack share a file, a cached file that fails the hash is not
//    believed;
//  - `verdicts:sync` warms it and is idempotent;
//  - `worktree:init` gains no step.
//
// A `.bot.test.ts` because it drives `convex/gre/ai/verdicts/` (the
// bot-suite boundary), and imports the lock's reader rather than the verdicts
// index for the reason `scripts/lib/verdict-pack-cache.ts` gives.

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    canonicalJson,
    verdictIdOf,
    type VerdictJudgement,
} from "../../convex/gre/ai/verdicts/identity";
import {
    VERDICT_LOCK_PATH,
    verdictsFromLock,
    type StoredVerdictPayload,
    type VerdictLock,
} from "../../convex/gre/ai/verdicts/lockSource";
import {
    encodeVerdictPack,
    verdictPackObjectName,
} from "../../convex/gre/ai/verdicts/pack";
import type { VerdictStoreReader } from "../../convex/verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../convex/verdictStoreMemory";
import {
    cachedVerdictPackPath,
    loadLockedVerdicts,
    packVerdicts,
    syncVerdictPack,
    verdictCacheDir,
    verdictPackHash,
} from "../lib/verdict-pack-cache";

const REPO = resolve(__dirname, "../..");

const judgementAnswering = (index: number): VerdictJudgement => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [index] },
});

const stored = (judgement: VerdictJudgement): StoredVerdictPayload => ({
    verdictId: verdictIdOf(judgement),
    payload: JSON.parse(canonicalJson(judgement)),
});

const [A, B, C] = [0, 1, 2].map((i) => stored(judgementAnswering(i)));

const tempDir = () => mkdtempSync(join(tmpdir(), "verdict-pack-"));

/** A bucket holding `entries` promoted into one pack, and a lock naming
 *  `lockIds` (the pack's own ids unless a test says otherwise). */
async function promoted(
    entries: StoredVerdictPayload[],
    lockIds: string[] = entries.map((e) => e.verdictId)
): Promise<{ bucket: MemoryVerdictStore; lock: VerdictLock }> {
    const bucket = createMemoryVerdictStore();
    const { packHash, bytes } = packVerdicts(entries);
    await bucket.put(
        verdictPackObjectName(packHash),
        bytes,
        "application/gzip"
    );
    return { bucket, lock: { verdictIds: lockIds, packHash } };
}

/** The bucket behind a factory that counts what it is asked. */
function counting(bucket: VerdictStoreReader) {
    const calls = { built: 0, get: [] as string[], list: 0 };
    const store = (): VerdictStoreReader => {
        calls.built++;
        return {
            get: (name) => {
                calls.get.push(name);
                return bucket.get(name);
            },
            list: (prefix) => {
                calls.list++;
                return bucket.list(prefix);
            },
        };
    };
    return { calls, store };
}

const noStore = (): VerdictStoreReader => {
    throw new Error("a store client was built");
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("loadLockedVerdicts — one fetch per lock (issue #3581)", () => {
    it("reads a lock's whole corpus with ONE object fetch and no listing, and caches that object", async () => {
        const { bucket, lock } = await promoted([A, B, C]);
        const { calls, store } = counting(bucket);
        const cacheDir = tempDir();

        const out = await loadLockedVerdicts(lock, { cacheDir, store });

        const name = `packs/${lock.packHash}.jsonl.gz`;
        expect(calls.get).toEqual([name]);
        expect(calls.list).toBe(0);
        expect(out.fetched).toBe(true);
        expect(out.verdicts).toEqual(verdictsFromLock(lock, [A, B, C]));
        expect(out.path).toBe(join(cacheDir, name));
        expect(readFileSync(out.path)).toEqual(
            Buffer.from(bucket.objects.get(name)!)
        );
    });
});

describe("loadLockedVerdicts — the pack is unbelieved (issue #3581)", () => {
    /** Loading `lock` against `bucket` throws `why`, and caches nothing. */
    async function refuses(
        bucket: VerdictStoreReader,
        lock: VerdictLock,
        why: RegExp
    ) {
        const cacheDir = tempDir();
        await expect(
            loadLockedVerdicts(lock, { cacheDir, store: () => bucket })
        ).rejects.toThrow(why);
        expect(existsSync(cachedVerdictPackPath(cacheDir, lock.packHash))).toBe(
            false
        );
    }

    it("refuses a payload that does not re-hash to the id it is packed under", async () => {
        const { bucket, lock } = await promoted([
            { verdictId: A.verdictId, payload: B.payload },
        ]);
        await refuses(
            bucket,
            lock,
            new RegExp(`${A.verdictId}: content hashes to ${B.verdictId}`)
        );
    });

    it("refuses a pack carrying more than the lock names", async () => {
        const { bucket, lock } = await promoted([A, B], [A.verdictId]);
        await refuses(
            bucket,
            lock,
            new RegExp(`carries ${B.verdictId}, which the lock does not name`)
        );
    });

    it("refuses a pack carrying less than the lock names", async () => {
        const { bucket, lock } = await promoted(
            [A],
            [A.verdictId, B.verdictId]
        );
        await refuses(
            bucket,
            lock,
            new RegExp(`lacks ${B.verdictId}, which the lock names`)
        );
    });

    it("refuses an object whose content does not hash to the lock's packHash", async () => {
        const packHash = verdictPackHash(encodeVerdictPack([A, B]));
        const bucket = createMemoryVerdictStore();
        await bucket.put(
            verdictPackObjectName(packHash),
            packVerdicts([A]).bytes,
            "application/gzip"
        );
        await refuses(
            bucket,
            { verdictIds: [A.verdictId], packHash },
            /content hashes to [0-9a-f]{64}, not to the packHash/
        );
    });

    it("refuses an object that is not gzip, and a pack the store does not have", async () => {
        const lock: VerdictLock = {
            verdictIds: [A.verdictId],
            packHash: verdictPackHash(encodeVerdictPack([A])),
        };
        const raw = createMemoryVerdictStore();
        await raw.put(
            verdictPackObjectName(lock.packHash),
            new TextEncoder().encode(encodeVerdictPack([A])),
            "application/gzip"
        );
        await refuses(raw, lock, /not a gzip pack/);
        await refuses(
            createMemoryVerdictStore(),
            lock,
            /the Verdict Store has no packs\//
        );
    });
});

describe("the machine cache (issue #3581)", () => {
    it("a warm cache makes no network call at all, and builds no store client", async () => {
        const { bucket, lock } = await promoted([A, B]);
        const cacheDir = tempDir();
        await loadLockedVerdicts(lock, { cacheDir, store: () => bucket });

        const network = vi.fn(async () => {
            throw new Error("network call on a warm cache");
        });
        vi.stubGlobal("fetch", network);
        const out = await loadLockedVerdicts(lock, {
            cacheDir,
            store: noStore,
        });

        expect(out.fetched).toBe(false);
        expect(network).not.toHaveBeenCalled();
        expect(out.verdicts).toEqual(verdictsFromLock(lock, [A, B]));
    });

    it("is keyed by content: two locks over one pack share a file, a new pack is a new file", async () => {
        const { bucket, lock } = await promoted([A, B]);
        const cacheDir = tempDir();
        const first = await loadLockedVerdicts(lock, {
            cacheDir,
            store: () => bucket,
        });

        const reordered: VerdictLock = {
            verdictIds: [B.verdictId, A.verdictId],
            packHash: lock.packHash,
        };
        const shared = await loadLockedVerdicts(reordered, {
            cacheDir,
            store: noStore,
        });
        expect(shared.fetched).toBe(false);
        expect(shared.path).toBe(first.path);
        expect(shared.verdicts.map((v) => v.id)).toEqual(reordered.verdictIds);

        const next = packVerdicts([A, B, C]);
        await bucket.put(
            verdictPackObjectName(next.packHash),
            next.bytes,
            "application/gzip"
        );
        const widened = await loadLockedVerdicts(
            {
                verdictIds: [A.verdictId, B.verdictId, C.verdictId],
                packHash: next.packHash,
            },
            { cacheDir, store: () => bucket }
        );
        expect(widened.fetched).toBe(true);
        expect(widened.path).not.toBe(first.path);
        expect(existsSync(first.path)).toBe(true);
    });

    it("does not believe itself: a cached file failing the lock's hash is refetched and replaced", async () => {
        const { bucket, lock } = await promoted([A]);
        const cacheDir = tempDir();
        const path = cachedVerdictPackPath(cacheDir, lock.packHash);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, gzipSync(encodeVerdictPack([B])));

        const { calls, store } = counting(bucket);
        const out = await loadLockedVerdicts(lock, { cacheDir, store });

        expect(out.fetched).toBe(true);
        expect(calls.get).toHaveLength(1);
        expect(out.verdicts.map((v) => v.id)).toEqual([A.verdictId]);
        expect(readFileSync(path)).toEqual(
            Buffer.from(
                bucket.objects.get(verdictPackObjectName(lock.packHash))!
            )
        );
    });

    it("lives under ~/.cache/tolaria/verdicts, outside every checkout", () => {
        expect(verdictCacheDir("/home/tester")).toBe(
            join("/home/tester", ".cache", "tolaria", "verdicts")
        );
        expect(relative(REPO, verdictCacheDir()).startsWith("..")).toBe(true);
    });
});

describe("verdicts:sync (issue #3581)", () => {
    /** A checkout whose committed lock is `lock`. */
    function checkout(lock: VerdictLock): string {
        const root = tempDir();
        mkdirSync(join(root, dirname(VERDICT_LOCK_PATH)), { recursive: true });
        writeFileSync(join(root, VERDICT_LOCK_PATH), JSON.stringify(lock));
        return root;
    }

    it("is the package script", () => {
        const pkg = JSON.parse(
            readFileSync(join(REPO, "package.json"), "utf8")
        );
        expect(pkg.scripts["verdicts:sync"]).toBe(
            "bun scripts/verdicts-sync.ts"
        );
    });

    it("warms the cache for the committed lock, and a second run fetches nothing and rewrites nothing", async () => {
        const { bucket, lock } = await promoted([A, B]);
        const root = checkout(lock);
        const cacheDir = tempDir();
        const { calls, store } = counting(bucket);

        expect(await syncVerdictPack(root, { cacheDir, store })).toMatch(
            /^fetched and verified 2 verdicts → /
        );
        const path = cachedVerdictPackPath(cacheDir, lock.packHash);
        const bytes = readFileSync(path);

        expect(await syncVerdictPack(root, { cacheDir, store })).toMatch(
            /^already warm: 2 verdicts verified from .*, no network call$/
        );
        expect(calls.built).toBe(1);
        expect(calls.get).toHaveLength(1);
        expect(readFileSync(path)).toEqual(bytes);
        expect(readdirSync(dirname(path))).toEqual([
            `${lock.packHash}.jsonl.gz`,
        ]);
    });

    it("with no lock committed, has nothing to sync and touches nothing", async () => {
        const cacheDir = tempDir();
        expect(
            await syncVerdictPack(tempDir(), { cacheDir, store: noStore })
        ).toMatch(/nothing to sync$/);
        expect(readdirSync(cacheDir)).toEqual([]);
    });
});

describe("worktree:init (issue #3581)", () => {
    it("gains no step: bootstrapping a worktree never warms the verdict cache", () => {
        const pkg = JSON.parse(
            readFileSync(join(REPO, "package.json"), "utf8")
        );
        expect(pkg.scripts["worktree:init"]).toBe(
            "bun scripts/bootstrap-worktree.ts"
        );
        const bootstrap = readFileSync(
            join(REPO, "scripts/bootstrap-worktree.ts"),
            "utf8"
        );
        expect(bootstrap).not.toMatch(/verdict|\.cache[/\\]tolaria/i);
    });
});
