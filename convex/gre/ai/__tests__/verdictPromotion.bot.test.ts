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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { BLADE_SCENARIOS } from "../blade/registry";
import { runVerdictPromotionStep } from "../blade/verdictPromotion";
import {
    ALIAS_OBJECT_PREFIX,
    ATTESTATION_OBJECT_PREFIX,
    RESOLUTION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    encodeVerdictObject,
    putAlias,
    putAttestation,
    putResolution,
    putVerdict,
    resolutionObjectName,
    verdictObjectName,
} from "../../../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../../verdictStoreMemory";
import {
    encodeVerdictPack,
    evalPairsOf,
    formatStoreValidation,
    EVAL_WEIGHTS_PATH,
    heldOutBucketOf,
    parsePromotionStreakLedger,
    scenarioKeyOf,
    parseVerdictLock,
    parseVerdictPack,
    serializePromotionStreakLedger,
    planPromotion,
    positionKeyOf,
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
import { LANE_FIXTURE_NOTE } from "../verdicts/laneFixture";
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

    it("reads the store's resolutions through the engine step (issue #3582)", async () => {
        // An unreadable resolution is the discriminating case at this seam:
        // the fixtures here do not rebuild on the real engine, but whether the
        // step reads `resolutionObjects` at all shows as the problem it names.
        const store = createMemoryVerdictStore();
        const name = resolutionObjectName(
            positionKeyOf(judgement(1, 1)),
            `v1-${"0".repeat(64)}`
        );
        store.objects.set(name, new TextEncoder().encode("{}"));
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
            resolutionObjects: await b64(RESOLUTION_OBJECT_PREFIX),
        });
        expect(out.text).toMatch(/resolution problems\s+: 1/);
        expect(out.text).toContain(name);
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

    it("promotes a resolved position through its accepted verdict only, and keeps the rejected one with its reason (issue #3582)", async () => {
        const store = createMemoryVerdictStore();
        const accepted = await stored(store, judgement(4, 1));
        const rejected = await stored(store, judgement(4, 2), [
            ["prod-a:carol", "explicit"],
        ]);
        const unresolved = await stored(store, judgement(5, 1));
        await stored(store, judgement(5, 2), [["prod-a:carol", "explicit"]]);
        const withResolutions = async () =>
            validateStoreObjects(
                await listing(store, VERDICT_OBJECT_PREFIX),
                await listing(store, ATTESTATION_OBJECT_PREFIX),
                rebuildsAll,
                [],
                await listing(store, RESOLUTION_OBJECT_PREFIX)
            );
        // Before anyone resolves it, both answers stay out.
        expect(
            planPromotion(null, await withResolutions()).lock.verdictIds
        ).toEqual([]);

        await putResolution(store, {
            positionKey: positionKeyOf(judgement(4, 1)),
            acceptedVerdictId: accepted,
            rejected: [{ verdictId: rejected, reason: "Shock is lethal" }],
            author: "prod-a:admin",
            createdAt: 1,
        });
        const validation = await withResolutions();
        expect(rowOf(validation, accepted).status).toBe("promotable");
        expect(rowOf(validation, rejected).status).toBe("rejected");
        expect(rowOf(validation, rejected).reasons[0]).toContain(
            "Shock is lethal"
        );
        expect(rowOf(validation, unresolved).status).toBe("contested");
        expect(validation.resolutionProblems).toEqual([]);
        expect(planPromotion(null, validation).lock.verdictIds).toEqual([
            accepted,
        ]);
        expect(formatStoreValidation(validation)).toContain(
            "rejected             : 1"
        );
    });

    it("never lets the check:ui lane fixture into the corpus — nor contest a real verdict with it (issue #4905)", async () => {
        const store = createMemoryVerdictStore();
        const real = await stored(store, judgement(6, 1));
        const fixtureOnly = await stored(store, judgement(6, 2), []);
        const fixture = (verdictId: string, author: string) =>
            putAttestation(store, {
                verdictId,
                author,
                sourceAxis: "explicit",
                note: LANE_FIXTURE_NOTE,
                deployment: "local-3210",
                deploymentKind: "local",
            });
        await fixture(real, "local-3210:lane1");
        await fixture(fixtureOnly, "local-3210:lane2");

        // The fixture's position need not rebuild: it is set aside unread,
        // never judged invalid (the leaked ones crash the engine step).
        const validation = await validate(store, (v) =>
            v.answer.kind === "right" && v.answer.rightIndexes[0] === 2
                ? "the fixture's position does not rebuild"
                : null
        );

        expect(
            validation.rows
                .filter((r) => r.verdictId === fixtureOnly)
                .map((r) => r.status)
        ).toEqual(["lane-fixture"]);
        expect(rowOf(validation, real).status).toBe("promotable");
        expect(validation.attestationProblems).toEqual([]);
        expect(planPromotion(null, validation).lock.verdictIds).toEqual([real]);
        expect(formatStoreValidation(validation)).toContain(
            "lane-fixture         : 1"
        );
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

describe("verdicts:testers — the engine step (issue #3585)", () => {
    /** A registry verdict the committed weights satisfy with room to spare,
     *  as a stored judgement — and the same position judged the other way,
     *  which those weights therefore cannot satisfy. Real positions: the fit
     *  report is re-derived on the real engine, never stubbed. */
    function satisfiedAndFlipped(): [VerdictJudgement, VerdictJudgement] {
        const pick = verdictsFromRegistry().verdicts.find((v) => {
            if (
                v.answer.kind !== "right" ||
                v.answer.rightIndexes.length !== 1 ||
                v.candidates.length !== 2
            ) {
                return false;
            }
            const out = evalPairsOf(v, DEFAULT_EVAL_WEIGHTS);
            return (
                out.error === undefined &&
                out.pairs.length > 0 &&
                out.pairs.every((p) => p.delta > 1)
            );
        });
        if (pick === undefined) {
            throw new Error("no satisfied two-candidate registry verdict");
        }
        const judgementOf = (right: number): VerdictJudgement => ({
            spec: pick.spec,
            ...(pick.setup?.length ? { setup: pick.setup } : {}),
            seat: pick.seat,
            ...(pick.deckKnowledge?.length
                ? { deckKnowledge: pick.deckKnowledge }
                : {}),
            candidates: pick.candidates,
            answer: { kind: "right", rightIndexes: [right] },
        });
        const right =
            pick.answer.kind === "right" ? pick.answer.rightIndexes[0] : 0;
        return [judgementOf(right), judgementOf(1 - right)];
    }

    const b64 = async (store: MemoryVerdictStore, prefix: string) =>
        (await listing(store, prefix)).map(({ name, bytes }) => ({
            name,
            base64: Buffer.from(bytes).toString("base64"),
        }));

    it("joins aliased accounts and reads unsatisfied off the fit report over the lock", async () => {
        const [held, flipped] = satisfiedAndFlipped();
        const store = createMemoryVerdictStore();
        const heldId = await stored(store, held, [
            ["dev-a:owner1", "explicit"],
            ["prod-b:owner2", "explicit"],
        ]);
        const flippedId = await stored(store, flipped, [
            ["prod-b:bob", "explicit"],
        ]);
        await putAlias(store, { authors: ["prod-b:owner2", "dev-a:owner1"] });
        const lock = serializeVerdictLock({
            verdictIds: [heldId, flippedId],
            packHash: "b".repeat(64),
        });

        const out = runVerdictPromotionStep(
            {
                mode: "testers",
                lock,
                evalWeightsSource: "",
                verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
                attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
                aliasObjects: await b64(store, ALIAS_OBJECT_PREFIX),
            },
            []
        );
        expect(out.mode).toBe("testers");
        const block = (person: string) =>
            out.text.split("\n\n").find((b) => b.startsWith(person)) ?? "";

        expect(out.text).toMatch(/testers\s+: 2/);
        const owner = block("dev-a:owner1");
        expect(owner).toContain("(also prod-b:owner2)");
        expect(owner).toMatch(/given\s+: 1/);
        expect(owner).toMatch(/contradicted : 1/);
        expect(owner).toMatch(/unsatisfied {2}: 0/);
        const bob = block("prod-b:bob");
        expect(bob).toMatch(/unsatisfied {2}: 1 — positions worth a look/);
        expect(bob).toContain(`${positionKeyOf(flipped)}  ${flippedId}`);
    });

    it("counts a store verdict the blade registry judges differently as contradicted and quarantined", async () => {
        const [, flipped] = satisfiedAndFlipped();
        const store = createMemoryVerdictStore();
        await stored(store, flipped, [["prod-b:bob", "explicit"]]);
        const out = runVerdictPromotionStep({
            mode: "testers",
            lock: null,
            evalWeightsSource: "",
            verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
            attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
        });
        expect(out.text).toMatch(/contradicted : 1/);
        expect(out.text).toMatch(/quarantined {2}: 1/);
        expect(out.text).toContain("attestation problems: 0");
    });

    it("verdicts:promote advances the streak ledger and appends the Admission Candidates; a no-op reads the ledger and advances nothing (issue #3985)", async () => {
        const [held] = satisfiedAndFlipped();
        const store = createMemoryVerdictStore();
        const heldId = await stored(store, held, [
            ["dev-a:owner1", "explicit"],
        ]);
        await putAlias(store, { authors: ["prod-b:owner2", "dev-a:owner1"] });
        const admission = {
            minPersons: 2,
            ownerPersons: ["prod-b:owner2"],
            minConsecutivePromotions: 1,
            seeds: [1],
            iterations: 30,
        };
        const snapshot = async () => ({
            evalWeightsSource: readFileSync(
                resolve(__dirname, "../../../..", EVAL_WEIGHTS_PATH),
                "utf8"
            ),
            verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
            attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
            aliasObjects: await b64(store, ALIAS_OBJECT_PREFIX),
            admission,
        });
        const registry = JSON.stringify(BLADE_SCENARIOS);

        const first = runVerdictPromotionStep(
            {
                mode: "promote",
                lock: null,
                streakLedger: null,
                ...(await snapshot()),
            },
            []
        );
        if (first.mode !== "promote" || first.noop) {
            throw new Error("expected a promotion that writes");
        }
        const ledger = parsePromotionStreakLedger(first.streakLedgerText);
        expect(ledger).toEqual({
            packHash: first.lock.packHash,
            streaks: { [heldId]: 1 },
        });
        expect(first.text).toContain("== Admission Candidates");
        expect(first.text).toMatch(/locked units\s+: 1/);
        // The owner's alias cleared the persons bar and the streak bar, so the
        // whole Bot was asked: one seed, whatever it picked.
        expect(first.text).toMatch(/refused — persons\s+: 0/);
        expect(first.text).toMatch(/refused — streak\s+: 0/);

        const again = runVerdictPromotionStep(
            {
                mode: "promote",
                lock: first.lockText,
                streakLedger: first.streakLedgerText,
                ...(await snapshot()),
            },
            []
        );
        expect(again).toMatchObject({ mode: "promote", noop: true });
        expect(again).not.toHaveProperty("streakLedgerText");
        expect(again.text).toContain(
            "streak ledger          : read over the committed lock"
        );
        // Nothing the step reads is written back: the registry is code.
        expect(JSON.stringify(BLADE_SCENARIOS)).toBe(registry);

        const stale = runVerdictPromotionStep(
            {
                mode: "promote",
                lock: first.lockText,
                streakLedger: serializePromotionStreakLedger({
                    ...ledger,
                    packHash: "e".repeat(64),
                }),
                ...(await snapshot()),
            },
            []
        );
        expect(stale.text).toMatch(/every streak restarts at 0/);
        expect(stale.text).toMatch(/refused — streak\s+: 1/);
    });

    /** `j` moved to the first later turn whose board falls on `side` of
     *  the held-out split (no Test Positions: the scenarios are `[]`). */
    const onSide = (j: VerdictJudgement, side: 0 | "fit"): VerdictJudgement => {
        for (let later = 1; later < 100; later++) {
            const moved = {
                ...j,
                spec: { ...j.spec, turn: (j.spec.turn ?? 1) + later },
            };
            const bucket = heldOutBucketOf(scenarioKeyOf(moved));
            if (side === 0 ? bucket === 0 : bucket !== 0) return moved;
        }
        throw new Error("no later turn lands on that side");
    };

    const promoteOnce = async (
        store: MemoryVerdictStore,
        admission: Record<string, unknown>
    ) => {
        const out = runVerdictPromotionStep(
            {
                mode: "promote",
                lock: null,
                streakLedger: null,
                evalWeightsSource: readFileSync(
                    resolve(__dirname, "../../../..", EVAL_WEIGHTS_PATH),
                    "utf8"
                ),
                verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
                attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
                resolutionObjects: await b64(store, RESOLUTION_OBJECT_PREFIX),
                admission,
            },
            []
        );
        if (out.mode !== "promote" || out.noop) {
            throw new Error("expected a promotion that writes");
        }
        return out;
    };

    it("verdicts:promote restarts at 0 the streak of a locked verdict the fitted weights leave unsatisfied (issue #3985)", async () => {
        const [held, flipped] = satisfiedAndFlipped();
        const store = createMemoryVerdictStore();
        const heldId = await stored(store, onSide(held, "fit"));
        // Held out, so the fit never bends to it — and its answer is the
        // opposite of the one the fit was just taught on the same board.
        const flippedId = await stored(store, onSide(flipped, 0));
        const out = await promoteOnce(store, {
            minPersons: 1,
            ownerPersons: [],
            minConsecutivePromotions: 1000,
            seeds: [1],
            iterations: 1,
        });
        expect(
            parsePromotionStreakLedger(out.streakLedgerText).streaks
        ).toEqual({ [heldId]: 1, [flippedId]: 0 });
    });

    it("verdicts:promote never proposes a position a resolution decided — it was Contested (issue #3985)", async () => {
        const [held, flipped] = satisfiedAndFlipped();
        const store = createMemoryVerdictStore();
        const accepted = await stored(store, held);
        const rejected = await stored(store, flipped, [
            ["prod-b:bob", "explicit"],
        ]);
        await putResolution(store, {
            positionKey: positionKeyOf(held),
            acceptedVerdictId: accepted,
            rejected: [{ verdictId: rejected, reason: "the other line" }],
            author: "prod-a:admin",
            createdAt: 1,
        });
        const out = await promoteOnce(store, {
            minPersons: 1,
            ownerPersons: [],
            minConsecutivePromotions: 1,
            seeds: [1],
            iterations: 1,
        });
        expect(out.lock.verdictIds).toEqual([accepted]);
        expect(out.text).toMatch(/refused — contested\s+: 1/);
        expect(out.text).toMatch(/candidates\s+: 0/);
    });

    it("says unsatisfied is not measured when no lock is committed, and lists an alias that does not read", async () => {
        const store = createMemoryVerdictStore();
        await stored(store, satisfiedAndFlipped()[0]);
        const bad = `${ALIAS_OBJECT_PREFIX}dev-a:x/prod-b:y`;
        store.objects.set(bad, new TextEncoder().encode("{}"));
        const out = runVerdictPromotionStep(
            {
                mode: "testers",
                lock: null,
                evalWeightsSource: "",
                verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
                attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
                aliasObjects: await b64(store, ALIAS_OBJECT_PREFIX),
            },
            []
        );
        expect(out.text).toContain("no lock committed");
        expect(out.text).toContain("unsatisfied  : not measured");
        expect(out.text).toMatch(/alias problems: 1/);
        expect(out.text).toContain(bad);
    });
});
