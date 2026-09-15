// `verdicts:validate` and `verdicts:promote` — what enters the Verdict Lock
// (issue #3583, PRD #3574, ADR 0128 §4 / §6 / §7).
//
// Claims, each a property of what a promotion would write:
//
//  - validation names, per object, exactly why it is not promotable: not what
//    its name promises, unloadable (an index outside the candidate list), a
//    position that no longer rebuilds, unattested, implicit-only, contested;
//  - an unattested verdict and every member of a quarantined group stay out;
//  - the lock names the hash of the pack its verdicts are read from, and that
//    pack loads under it;
//  - re-planning over the plan's own lock is a no-op;
//  - the lock grows by appending, and a locked verdict later contested is
//    dropped with its reason.
//
// The guard half — a lock without its weights is red — is in
// `weightFit.bot.test.ts`, beside the guard.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import { runVerdictPromotionStep } from "../blade/verdictPromotion";
import {
    ATTESTATION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    encodeVerdictObject,
    putAttestation,
    putVerdict,
    verdictObjectName,
} from "../../../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../../verdictStoreMemory";
import {
    encodeVerdictPack,
    formatStoreValidation,
    parseVerdictLock,
    parseVerdictPack,
    planPromotion,
    serializeVerdictLock,
    validateStoreObjects,
    verdictIdOf,
    verdictsFromLock,
    verdictsFromRegistry,
    type StoreObject,
    type Verdict,
    type VerdictJudgement,
    type VerdictRebuildCheck,
    type VerdictSourceAxis,
} from "../verdicts";
import { sha256Hex } from "../verdicts/sha256";

/** A judgement on board `turn`, answering candidate `index`. Two judgements
 *  share a position key exactly when they share a turn. */
const judgement = (turn: number, index: number): VerdictJudgement => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN", turn },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [index] },
});

const rebuildsAll: VerdictRebuildCheck = () => null;

async function stored(
    store: MemoryVerdictStore,
    j: VerdictJudgement,
    attestations: [string, VerdictSourceAxis][] = [["prod-a:alice", "explicit"]]
): Promise<string> {
    const { verdictId } = await putVerdict(store, j);
    for (const [author, sourceAxis] of attestations) {
        await putAttestation(store, { verdictId, author, sourceAxis });
    }
    return verdictId;
}

async function listing(store: MemoryVerdictStore, prefix: string) {
    return Promise.all(
        (await store.list(prefix)).map(
            async (name): Promise<StoreObject> => ({
                name,
                bytes: (await store.get(name))!,
            })
        )
    );
}

async function validate(
    store: MemoryVerdictStore,
    rebuild: VerdictRebuildCheck = rebuildsAll
) {
    return validateStoreObjects(
        await listing(store, VERDICT_OBJECT_PREFIX),
        await listing(store, ATTESTATION_OBJECT_PREFIX),
        rebuild
    );
}

const rowOf = (
    validation: Awaited<ReturnType<typeof validate>>,
    verdictId: string
) => validation.rows.find((r) => r.verdictId === verdictId)!;

describe("verdicts:validate — per object, exactly why it is not promotable", () => {
    it("names each failure on the object that has it, and only there", async () => {
        const store = createMemoryVerdictStore();
        const good = await stored(store, judgement(1, 1));
        const unattested = await stored(store, judgement(2, 1), []);
        const implicit = await stored(store, judgement(3, 1), [
            ["prod-a:bob", "implicit"],
        ]);
        const contestedA = await stored(store, judgement(4, 1));
        const contestedB = await stored(store, judgement(4, 2), [
            ["prod-a:carol", "explicit"],
        ]);
        const outOfRange = await stored(store, judgement(5, 7));
        const stale = await stored(store, judgement(6, 0));
        // Another judgement's bytes under this one's name.
        const tampered = verdictIdOf(judgement(7, 1));
        store.objects.set(
            verdictObjectName(tampered),
            encodeVerdictObject(judgement(7, 2)).bytes
        );
        await putAttestation(store, {
            verdictId: tampered,
            author: "prod-a:alice",
            sourceAxis: "explicit",
        });
        // An attestation of a verdict the store never received.
        const ghost = verdictIdOf(judgement(8, 0));
        await putAttestation(store, {
            verdictId: ghost,
            author: "prod-a:alice",
            sourceAxis: "explicit",
        });

        const validation = await validate(store, (v) =>
            v.id === stale
                ? "position could not be rebuilt: no such card"
                : null
        );

        expect(rowOf(validation, good)).toMatchObject({
            status: "promotable",
            reasons: [],
        });
        expect(rowOf(validation, unattested).status).toBe("unattested");
        expect(rowOf(validation, unattested).reasons[0]).toMatch(
            /no attestation/
        );
        expect(rowOf(validation, implicit).status).toBe("implicit-only");
        expect(rowOf(validation, contestedA).status).toBe("contested");
        expect(rowOf(validation, contestedA).reasons[0]).toContain(contestedB);
        expect(rowOf(validation, contestedB).reasons[0]).toContain(contestedA);
        expect(rowOf(validation, outOfRange)).toMatchObject({
            status: "invalid",
        });
        expect(rowOf(validation, outOfRange).reasons[0]).toMatch(
            /outside the 3-candidate list/
        );
        expect(rowOf(validation, stale).reasons).toEqual([
            "position could not be rebuilt: no such card",
        ]);
        expect(rowOf(validation, tampered).status).toBe("invalid");
        expect(rowOf(validation, tampered).reasons[0]).toMatch(/hashes to/);
        expect(validation.attestationProblems).toEqual([
            expect.objectContaining({
                reason: expect.stringContaining(`attests ${ghost}`),
            }),
        ]);
        expect(validation.promotable.map((p) => p.verdictId)).toEqual([good]);

        const text = formatStoreValidation(validation);
        for (const row of validation.rows.filter(
            (r) => r.status !== "promotable"
        )) {
            expect(text).toContain(row.name);
            expect(text).toContain(row.reasons[0]);
        }
    });

    it("judges the store against the real blade registry", async () => {
        // The engine step, not a hand-passed list: a blade entry's own
        // judgement, submitted again, is already in the corpus.
        const [entry] = verdictsFromRegistry(BLADE_SCENARIOS).verdicts;
        const store = createMemoryVerdictStore();
        const id = await stored(store, entry);
        const b64 = async (prefix: string) =>
            (await listing(store, prefix)).map(({ name, bytes }) => ({
                name,
                base64: Buffer.from(bytes).toString("base64"),
            }));
        const out = runVerdictPromotionStep({
            mode: "validate",
            lock: null,
            evalWeightsSource: "",
            verdictObjects: await b64(VERDICT_OBJECT_PREFIX),
            attestationObjects: await b64(ATTESTATION_OBJECT_PREFIX),
        });
        expect(out.text).toContain(`${verdictObjectName(id)}  [in-registry]`);
        expect(out.text).toContain(entry.id);
    });

    it("asks the real engine whether a position rebuilds", async () => {
        const store = createMemoryVerdictStore();
        // The candidates name moves an empty board never offers.
        const id = await stored(store, judgement(1, 1));
        const b64 = async (prefix: string) =>
            (await listing(store, prefix)).map(({ name, bytes }) => ({
                name,
                base64: Buffer.from(bytes).toString("base64"),
            }));
        const out = runVerdictPromotionStep({
            mode: "validate",
            lock: null,
            evalWeightsSource: "",
            verdictObjects: await b64(VERDICT_OBJECT_PREFIX),
            attestationObjects: await b64(ATTESTATION_OBJECT_PREFIX),
        });
        expect(out.text).toContain(`${verdictObjectName(id)}  [invalid]`);
        expect(out.text).toMatch(/promotable\s+: 0/);
    });
});

describe("verdicts:promote — the lock it writes", () => {
    it("never promotes an unattested verdict, nor any member of a quarantined group", async () => {
        const store = createMemoryVerdictStore();
        const good = await stored(store, judgement(1, 1));
        await stored(store, judgement(2, 1), []);
        await stored(store, judgement(4, 1));
        await stored(store, judgement(4, 2), [["prod-a:carol", "explicit"]]);
        const plan = planPromotion(null, await validate(store));
        expect(plan.lock.verdictIds).toEqual([good]);
    });

    it("names the hash of the pack its verdicts are read from, and that pack loads", async () => {
        const store = createMemoryVerdictStore();
        await stored(store, judgement(1, 1));
        await stored(store, judgement(2, 0));
        const plan = planPromotion(null, await validate(store));
        const text = encodeVerdictPack(plan.entries);
        expect(plan.lock.packHash).toBe(sha256Hex(text));
        const lock = parseVerdictLock(serializeVerdictLock(plan.lock));
        expect(lock).toEqual(plan.lock);
        expect(
            verdictsFromLock(lock, parseVerdictPack(lock, text)).map(
                (v) => v.id
            )
        ).toEqual(lock.verdictIds);
    });

    it("is a no-op when re-run over its own lock with nothing new", async () => {
        const store = createMemoryVerdictStore();
        await stored(store, judgement(1, 1));
        const first = planPromotion(null, await validate(store));
        expect(first.noop).toBe(false);
        const again = planPromotion(first.lock, await validate(store));
        expect(again.noop).toBe(true);
        expect(again.lock).toEqual(first.lock);
        // And an empty store over no lock has nothing to write either.
        expect(
            planPromotion(null, await validate(createMemoryVerdictStore())).noop
        ).toBe(true);
    });

    it("appends new verdicts after the locked ones, in the lock's own order", async () => {
        const store = createMemoryVerdictStore();
        const ids = [
            await stored(store, judgement(1, 1)),
            await stored(store, judgement(2, 1)),
        ];
        const committed = [...ids].sort().reverse();
        const current = { verdictIds: committed, packHash: "a".repeat(64) };
        const added = await stored(store, judgement(3, 1));
        const plan = planPromotion(current, await validate(store));
        expect(plan.lock.verdictIds).toEqual([...committed, added]);
        expect(plan.added).toEqual([added]);
        expect(plan.noop).toBe(false);
    });

    it("drops a locked verdict a later judgement contests, and says why", async () => {
        const store = createMemoryVerdictStore();
        const locked = await stored(store, judgement(1, 1));
        const first = planPromotion(null, await validate(store));
        const rival = await stored(store, judgement(1, 2), [
            ["prod-b:dave", "explicit"],
        ]);
        const plan = planPromotion(first.lock, await validate(store));
        expect(plan.lock.verdictIds).toEqual([]);
        expect(plan.dropped).toEqual([
            { verdictId: locked, why: expect.stringContaining(rival) },
        ]);
    });

    it("never promotes what the blade registry already judges — the same answer, or another", async () => {
        // The registry is the corpus's permanent other half: every fit reads
        // it beside the lock, and no promotion can quarantine it.
        const asRegistry = (j: VerdictJudgement, label: string): Verdict => ({
            ...j,
            id: `registry:${label}`,
            author: "blade-registry",
            createdAt: "2026-09-05T00:00:00.000Z",
            source: "registry",
        });
        const store = createMemoryVerdictStore();
        const same = await stored(store, judgement(1, 1));
        const rival = await stored(store, judgement(2, 2));
        const fresh = await stored(store, judgement(3, 1));
        const validation = validateStoreObjects(
            await listing(store, VERDICT_OBJECT_PREFIX),
            await listing(store, ATTESTATION_OBJECT_PREFIX),
            rebuildsAll,
            [
                asRegistry(judgement(1, 1), "one"),
                asRegistry(judgement(2, 1), "two"),
            ]
        );
        expect(rowOf(validation, same).status).toBe("in-registry");
        expect(rowOf(validation, same).reasons[0]).toContain("registry:one");
        expect(rowOf(validation, rival).status).toBe("contested");
        expect(rowOf(validation, rival).reasons[0]).toContain("registry:two");
        expect(planPromotion(null, validation).lock.verdictIds).toEqual([
            fresh,
        ]);
    });

    it("refuses a committed lock naming a verdict the listing does not hold", async () => {
        const missing = verdictIdOf(judgement(9, 0));
        expect(() =>
            planPromotion(
                { verdictIds: [missing], packHash: "b".repeat(64) },
                validateStoreObjects([], [], rebuildsAll)
            )
        ).toThrow(/listing is incomplete/);
    });
});
