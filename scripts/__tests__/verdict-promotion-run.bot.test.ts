// `bun run verdicts:promote` — the order of its writes and its refusals
// (issue #3583, ADR 0128 §7). Claims:
//
//  - a promotion writes the pack (on the deployment), then the lock AND the
//    weights together, and the lock names the stored pack's hash;
//  - re-running with nothing new rewrites nothing and runs nothing;
//  - a deployment hash that is not this snapshot's, or a pack the store does
//    not hand back, writes neither file;
//  - a blade run that names no result is not a pass.
//
// The engine step is played by the pure pipeline with every position
// rebuilding and a marker for the refit — what it computes is asserted in
// `verdictPromotion.bot.test.ts` and `weightFit.bot.test.ts`; this file is
// about what the runner does with its answer.
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
    positionKeyOf,
    type VerdictJudgement,
} from "../../convex/gre/ai/verdicts/identity";
import {
    VERDICT_LOCK_PATH,
    parseVerdictLock,
    serializeVerdictLock,
} from "../../convex/gre/ai/verdicts/lockSource";
import { verdictPackObjectName } from "../../convex/gre/ai/verdicts/pack";
import {
    EVAL_WEIGHTS_PATH,
    planPromotion,
    validateStoreObjects,
    type VerdictPromotionInput,
    type VerdictPromotionOutput,
} from "../../convex/gre/ai/verdicts/promotion";
import { storeVerdictPack } from "../../convex/verdictPackStore";
import {
    putAttestation,
    putResolution,
    putVerdict,
} from "../../convex/verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../convex/verdictStoreMemory";
import {
    parseBladeMust,
    runVerdictsPromote,
    snapshotVerdictStore,
    type VerdictsPromotePorts,
} from "../lib/verdict-promotion-run";

const WEIGHTS = "export const DEFAULT_EVAL_WEIGHTS = {};\n";
const REFIT = "// refit\n";

const judgement = (turn: number): VerdictJudgement => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN", turn },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
    ],
    answer: { kind: "right", rightIndexes: [1] },
});

async function attested(store: MemoryVerdictStore, turn: number) {
    const { verdictId } = await putVerdict(store, judgement(turn));
    await putAttestation(store, {
        verdictId,
        author: "prod-a:alice",
        sourceAxis: "explicit",
    });
    return verdictId;
}

/** The pure pipeline, every position rebuilding, the refit a marker. */
async function engineStep(
    input: VerdictPromotionInput
): Promise<VerdictPromotionOutput> {
    const decode = (objects: VerdictPromotionInput["verdictObjects"]) =>
        objects.map(({ name, base64 }) => ({
            name,
            bytes: new Uint8Array(Buffer.from(base64, "base64")),
        }));
    const validation = validateStoreObjects(
        decode(input.verdictObjects),
        decode(input.attestationObjects),
        () => null,
        [],
        decode(input.resolutionObjects ?? [])
    );
    const plan = planPromotion(
        input.lock === null ? null : parseVerdictLock(input.lock),
        validation
    );
    if (plan.noop) return { mode: "promote", noop: true, text: "noop" };
    return {
        mode: "promote",
        noop: false,
        text: "promoted",
        lock: plan.lock,
        lockText: serializeVerdictLock(plan.lock),
        evalWeightsSource: input.evalWeightsSource + REFIT,
    };
}

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
    const d = mkdtempSync(join(tmpdir(), "verdict-promotion-run-"));
    dirs.push(d);
    return d;
};

function checkout(): string {
    const root = tempDir();
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "convex/gre/ai"), { recursive: true });
    writeFileSync(join(root, EVAL_WEIGHTS_PATH), WEIGHTS);
    return root;
}

function ports(
    root: string,
    store: MemoryVerdictStore,
    overrides: Partial<VerdictsPromotePorts> = {}
) {
    const calls = { writePack: 0, blade: 0 };
    const p: VerdictsPromotePorts = {
        root,
        reader: store,
        engineStep,
        cacheDir: tempDir(),
        writePack: async (ids) => {
            calls.writePack++;
            return storeVerdictPack(store, ids, {
                gzip: (text) => new Uint8Array(gzipSync(text)),
                gunzip: (bytes) => gunzipSync(bytes).toString("utf8"),
            });
        },
        runBladeMust: async () => {
            calls.blade++;
            return { passed: true, summary: "Tests  1 passed (1)" };
        },
        ...overrides,
    };
    return { ports: p, calls };
}

const read = (root: string, path: string) =>
    existsSync(join(root, path))
        ? readFileSync(join(root, path), "utf8")
        : null;

describe("verdicts:promote — writes (issue #3583)", () => {
    it("writes the pack, then the lock and the weights together; the lock names the pack", async () => {
        const store = createMemoryVerdictStore();
        const id = await attested(store, 1);
        const root = checkout();
        const { ports: p, calls } = ports(root, store);

        const outcome = await runVerdictsPromote(p);

        expect(outcome).toMatchObject({ wrote: true, bladePassed: true });
        const lock = parseVerdictLock(read(root, VERDICT_LOCK_PATH)!);
        expect(lock.verdictIds).toEqual([id]);
        expect(store.objects.has(verdictPackObjectName(lock.packHash))).toBe(
            true
        );
        expect(read(root, EVAL_WEIGHTS_PATH)).toBe(WEIGHTS + REFIT);
        expect(calls).toEqual({ writePack: 1, blade: 1 });
        expect(outcome.text).toContain("blade `must`");
        expect(outcome.text).toContain("PASSED — Tests  1 passed (1)");
    });

    it("rewrites nothing and runs nothing when re-run with no new verdicts", async () => {
        const store = createMemoryVerdictStore();
        await attested(store, 1);
        const root = checkout();
        await runVerdictsPromote(ports(root, store).ports);
        const lockBefore = read(root, VERDICT_LOCK_PATH);
        const weightsBefore = read(root, EVAL_WEIGHTS_PATH);

        const { ports: p, calls } = ports(root, store);
        const outcome = await runVerdictsPromote(p);

        expect(outcome).toEqual({
            text: "noop",
            wrote: false,
            bladePassed: null,
        });
        expect(read(root, VERDICT_LOCK_PATH)).toBe(lockBefore);
        expect(read(root, EVAL_WEIGHTS_PATH)).toBe(weightsBefore);
        expect(calls).toEqual({ writePack: 0, blade: 0 });
    });

    it("writes neither file when the deployment reports another pack", async () => {
        const store = createMemoryVerdictStore();
        await attested(store, 1);
        const root = checkout();
        const { ports: p, calls } = ports(root, store, {
            writePack: async () => ({ packHash: "c".repeat(64) }),
        });
        await expect(runVerdictsPromote(p)).rejects.toThrow(/nothing written/);
        expect(read(root, VERDICT_LOCK_PATH)).toBeNull();
        expect(read(root, EVAL_WEIGHTS_PATH)).toBe(WEIGHTS);
        expect(calls.blade).toBe(0);
    });

    it("writes neither file when the store does not hand the pack back", async () => {
        const store = createMemoryVerdictStore();
        await attested(store, 1);
        const root = checkout();
        // The right hash, reported by a deployment that stored nothing.
        const plan = await engineStep({
            mode: "promote",
            lock: null,
            evalWeightsSource: "",
            verdictObjects: await Promise.all(
                (await store.list("verdicts/")).map(async (name) => ({
                    name,
                    base64: Buffer.from((await store.get(name))!).toString(
                        "base64"
                    ),
                }))
            ),
            attestationObjects: await Promise.all(
                (await store.list("attestations/")).map(async (name) => ({
                    name,
                    base64: Buffer.from((await store.get(name))!).toString(
                        "base64"
                    ),
                }))
            ),
        });
        if (plan.mode !== "promote" || plan.noop)
            throw new Error("expected a plan");
        const { ports: p } = ports(root, store, {
            writePack: async () => ({ packHash: plan.lock.packHash }),
        });
        await expect(runVerdictsPromote(p)).rejects.toThrow(/has no packs\//);
        expect(read(root, VERDICT_LOCK_PATH)).toBeNull();
        expect(read(root, EVAL_WEIGHTS_PATH)).toBe(WEIGHTS);
    });
});

describe("the store snapshot (issue #3582)", () => {
    it("carries every resolution object beside the verdicts and attestations", async () => {
        // Without them a promotion never sees an admin's decision, and a
        // resolved position stays out of the lock forever.
        const store = createMemoryVerdictStore();
        const land = (await putVerdict(store, judgement(9))).verdictId;
        const pass = (
            await putVerdict(store, {
                ...judgement(9),
                answer: { kind: "right", rightIndexes: [0] },
            })
        ).verdictId;
        const { name } = await putResolution(store, {
            positionKey: positionKeyOf(judgement(9)),
            acceptedVerdictId: land,
            rejected: [{ verdictId: pass, reason: "the land drop wins" }],
            author: "prod-a:admin",
            createdAt: 1,
        });
        const input = await snapshotVerdictStore(store, checkout(), "validate");
        expect(input.resolutionObjects?.map((o) => o.name)).toEqual([name]);
    });
});

describe("parseBladeMust", () => {
    it("reads vitest's summary line through its colours", () => {
        expect(
            parseBladeMust(0, "\x1b[2m Tests \x1b[22m 3 passed (3)\n")
        ).toEqual({ passed: true, summary: "Tests  3 passed (3)" });
    });

    it("is not a pass on a failing exit, nor on a zero exit that names no result", () => {
        expect(
            parseBladeMust(1, " Tests  1 failed | 2 passed (3)\n").passed
        ).toBe(false);
        expect(parseBladeMust(0, "nothing ran\n")).toEqual({
            passed: false,
            summary: "no vitest summary line (exit 0)",
        });
    });
});
