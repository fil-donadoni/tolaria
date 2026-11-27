// The exam side BY RULE (issue #10851, ADR 0186 Decision 7): player Verdicts
// the lock names in `examIds` are held out whatever their scenario hashes to.
//
// Claims, each a property the Weight Fit or Held-out Agreement depends on:
//
//  - an older lock (no `examIds`) still reads, as no exam side, and is
//    written back to the byte — upcast at read, never rewritten;
//  - a named Verdict is held out, never reaches the fit, and is counted on
//    the rule side of the exam; the Test Position override still wins, and
//    burns it;
//  - a Minimal Pair is never split by the rule — the lock refuses it;
//  - the exam step widens the lock on the exam side only: the fit over the
//    widened lock rewrites the committed weights to the byte, a re-run is a
//    no-op, a Promotion carries the exam side unchanged, and nothing locked
//    is ever dropped or moved by it.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { runVerdictPromotionStep } from "../blade/verdictPromotion";
import {
    ATTESTATION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    encodeVerdictObject,
    putAttestation,
    putVerdict,
} from "../../../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../../verdictStoreMemory";
import {
    burnedCountOf,
    burnedOf,
    EVAL_WEIGHTS_PATH,
    evalPairsOf,
    fitInputPairs,
    heldOutBucketOf,
    parseVerdictLock,
    planExam,
    planPromotion,
    scenarioKeyOf,
    serializeVerdictLock,
    validateStoreObjects,
    verdictIdOf,
    verdictSideOf,
    verdictSidesOf,
    verdictsFromLock,
    verdictsFromRegistry,
    VERDICT_LOCK_PATH,
    type Discriminant,
    type EvalPair,
    type StoreObject,
    type StoredVerdictPayload,
    type VerdictJudgement,
    type VerdictLock,
} from "../verdicts";

const ROOT = resolve(__dirname, "../../../..");
const NO_TEST_POSITIONS: ReadonlySet<string> = new Set();
const PACK = "0".repeat(64);
const END_STEP: Discriminant = { kind: "step", detail: "opponent's end step" };

const board = (turn: number) => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" as const, turn },
    seat: "me" as const,
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Terror" },
    ],
});

const judgementAt = (turn: number): VerdictJudgement => ({
    ...board(turn),
    answer: { kind: "right", rightIndexes: [1] },
});

/** The first board, scanning turns, whose scenario hashes to `bucket0` (or
 *  not) — so a test can prove the rule, not the hash, decided. */
function boardHashing(fitSide: boolean, from = 1): VerdictJudgement {
    for (let turn = from; turn < from + 500; turn++) {
        const j = judgementAt(turn);
        if ((heldOutBucketOf(scenarioKeyOf(j)) === 0) !== fitSide) return j;
    }
    throw new Error("no board in 500 turns");
}

const payloadOf = (j: VerdictJudgement): StoredVerdictPayload => {
    const { verdictId } = encodeVerdictObject(j);
    return { verdictId, payload: j };
};

const lockOf = (
    judgements: VerdictJudgement[],
    examIds?: string[]
): VerdictLock => ({
    verdictIds: judgements.map((j) => verdictIdOf(j)),
    packHash: PACK,
    ...(examIds === undefined ? {} : { examIds }),
});

const read = (judgements: VerdictJudgement[], examIds?: string[]) =>
    verdictsFromLock(lockOf(judgements, examIds), judgements.map(payloadOf));

describe("the lock format carries the exam side (issue #10851)", () => {
    it("reads the committed lock and writes it back to the byte, with or without its exam side", () => {
        const text = readFileSync(join(ROOT, VERDICT_LOCK_PATH), "utf8");
        const lock = parseVerdictLock(text);
        expect(serializeVerdictLock(lock)).toBe(text);
        // The committed lock carries an exam side since issue #10855; the
        // same lock without it still reads as having none and keeps its bytes.
        const bare = serializeVerdictLock({ ...lock, examIds: undefined });
        expect(parseVerdictLock(bare)).not.toHaveProperty("examIds");
        expect(serializeVerdictLock(parseVerdictLock(bare))).toBe(bare);
    });

    it("writes examIds sorted, before verdictIds, and reads them back", () => {
        const [a, b] = [judgementAt(1), judgementAt(2)];
        const ids = [verdictIdOf(a), verdictIdOf(b)];
        const text = serializeVerdictLock(
            lockOf([a, b], ids.slice().reverse())
        );
        expect(parseVerdictLock(text).examIds).toEqual(ids.slice().sort());
        expect(text.indexOf('"examIds"')).toBeLessThan(
            text.indexOf('"verdictIds"')
        );
    });

    it("refuses an exam id the lock does not name, or names twice", () => {
        const a = judgementAt(1);
        const other = verdictIdOf(judgementAt(2));
        expect(() =>
            parseVerdictLock(JSON.stringify(lockOf([a], [other])))
        ).toThrow(/"examIds"\[0\] .* which "verdictIds" does not name/);
        const id = verdictIdOf(a);
        expect(() =>
            parseVerdictLock(JSON.stringify(lockOf([a], [id, id])))
        ).toThrow(/"examIds" names .* twice/);
    });
});

describe("a Verdict named by rule is held out (issue #10851)", () => {
    it("is held out though it hashes fit-side, and its pairs never reach the fit", () => {
        const j = boardHashing(true);
        const [plain] = read([j]);
        const [exam] = read([j], [verdictIdOf(j)]);
        expect(verdictSideOf(plain, NO_TEST_POSITIONS)).toBe("fit");
        expect(exam.heldOutByRule).toBe(true);
        expect(verdictSideOf(exam, NO_TEST_POSITIONS)).toBe("held-out");
        const pairs = [{ verdictId: exam.id, kind: "right" } as EvalPair];
        expect(fitInputPairs(pairs, [plain], NO_TEST_POSITIONS)).toHaveLength(
            1
        );
        expect(fitInputPairs(pairs, [exam], NO_TEST_POSITIONS)).toEqual([]);
    });

    it("counts the exam by side: hash, rule, and their total", () => {
        const byRule = boardHashing(true);
        const byHash = boardHashing(false);
        const verdicts = read([byRule, byHash], [verdictIdOf(byRule)]);
        expect(burnedCountOf(verdicts, NO_TEST_POSITIONS)).toEqual({
            burned: 0,
            heldOutN: 2,
            byHash: 1,
            byRule: 1,
        });
    });

    it("yields to the Test Position override, and is then burned", () => {
        const j = boardHashing(true);
        const verdicts = read([j], [verdictIdOf(j)]);
        const admitted = new Set([scenarioKeyOf(j)]);
        expect(verdictSideOf(verdicts[0], admitted)).toBe("fit");
        expect(burnedOf(verdicts, admitted)).toEqual(verdicts);
    });
});

describe("the rule never splits a Minimal Pair (issue #10851, ADR 0148)", () => {
    const anchor = (turn: number): VerdictJudgement => ({
        ...board(turn),
        answer: { kind: "forbidden", forbiddenIndexes: [1] },
        classification: { kind: "conditional", discriminant: END_STEP },
    });
    const halfOf = (a: VerdictJudgement, turn: number): VerdictJudgement => ({
        ...board(turn),
        answer: { kind: "right", rightIndexes: [1] },
        pairOf: { anchorId: verdictIdOf(a), discriminant: END_STEP },
    });

    it("puts both halves on the exam side when both are named", () => {
        const a = anchor(10);
        const h = halfOf(a, 11);
        const verdicts = read([a, h], [verdictIdOf(a), verdictIdOf(h)]);
        const sides = verdictSidesOf(verdicts, NO_TEST_POSITIONS);
        expect([...sides.values()]).toEqual(["held-out", "held-out"]);
    });

    it("refuses a lock naming one half without the other", () => {
        const a = anchor(10);
        const h = halfOf(a, 11);
        expect(() => read([a, h], [verdictIdOf(a)])).toThrow(
            /splits the Minimal Pair/
        );
        expect(() => read([a, h], [verdictIdOf(h)])).toThrow(
            /splits the Minimal Pair/
        );
    });

    it("refuses a named half whose anchor the lock does not name", () => {
        const h = halfOf(anchor(10), 11);
        expect(() => read([h], [verdictIdOf(h)])).toThrow(
            /anchor .* the lock does not name/
        );
    });
});

async function stored(
    store: MemoryVerdictStore,
    j: VerdictJudgement
): Promise<string> {
    const { verdictId } = await putVerdict(store, j);
    await putAttestation(store, {
        verdictId,
        author: "prod-a:alice",
        sourceAxis: "explicit",
    });
    return verdictId;
}

async function listing(
    store: MemoryVerdictStore,
    prefix: string
): Promise<StoreObject[]> {
    return Promise.all(
        (await store.list(prefix)).map(async (name) => ({
            name,
            bytes: (await store.get(name))!,
        }))
    );
}

const validate = async (store: MemoryVerdictStore) =>
    validateStoreObjects(
        await listing(store, VERDICT_OBJECT_PREFIX),
        await listing(store, ATTESTATION_OBJECT_PREFIX),
        () => null
    );

describe("planExam — the lock widens on the exam side only (issue #10851)", () => {
    it("appends what is new to the exam side, keeps the locked ids, and is a no-op re-run", async () => {
        const store = createMemoryVerdictStore();
        const fitId = await stored(store, judgementAt(1));
        const locked = planPromotion(null, await validate(store)).lock;
        const examId = await stored(store, judgementAt(2));

        const plan = planExam(locked, await validate(store), NO_TEST_POSITIONS);
        expect(plan.named).toEqual([examId]);
        expect(plan.lock.verdictIds).toEqual([fitId, examId]);
        expect(plan.lock.examIds).toEqual([examId]);
        expect(plan.noop).toBe(false);

        const again = planExam(
            plan.lock,
            await validate(store),
            NO_TEST_POSITIONS
        );
        expect(again.noop).toBe(true);
        expect(again.lock).toEqual(plan.lock);
    });

    it("a Promotion carries the exam side: nothing held out by rule moves to the fit", async () => {
        const store = createMemoryVerdictStore();
        await stored(store, judgementAt(1));
        const examId = await stored(store, judgementAt(2));
        const exam = planExam(null, await validate(store), NO_TEST_POSITIONS);
        expect(exam.lock.examIds?.sort()).toEqual(exam.lock.verdictIds.sort());
        await stored(store, judgementAt(3));
        const promoted = planPromotion(exam.lock, await validate(store)).lock;
        expect(promoted.verdictIds).toHaveLength(3);
        expect(promoted.examIds).toContain(examId);
        expect(promoted.examIds).toHaveLength(2);
    });

    it("refuses to drop a locked verdict that is no longer promotable", async () => {
        const store = createMemoryVerdictStore();
        await stored(store, judgementAt(1));
        const locked = planPromotion(null, await validate(store)).lock;
        // The same board judged the other way: the locked verdict is contested.
        await stored(store, {
            ...judgementAt(1),
            answer: { kind: "right", rightIndexes: [0] },
        });
        const validation = await validate(store);
        expect(() => planExam(locked, validation, NO_TEST_POSITIONS)).toThrow(
            /no longer promotable[^]*PRD issue #10849/
        );
    });
});

describe("verdicts:exam — the engine step (issue #10851)", () => {
    /** A registry position as a stored judgement, answered `right`. */
    const judgementOn = (
        pick: ReturnType<typeof verdictsFromRegistry>["verdicts"][number],
        right: number
    ): VerdictJudgement => ({
        spec: pick.spec,
        ...(pick.setup?.length ? { setup: pick.setup } : {}),
        seat: pick.seat,
        ...(pick.deckKnowledge?.length
            ? { deckKnowledge: pick.deckKnowledge }
            : {}),
        candidates: pick.candidates,
        answer: { kind: "right", rightIndexes: [right] },
    });

    /** Two real two-candidate positions the committed weights satisfy with
     *  room to spare, the second hashing FIT-side: judged the other way, it
     *  is a pair the fit could only answer by moving a weight. */
    function positions() {
        const satisfied = verdictsFromRegistry().verdicts.filter((v) => {
            if (
                v.answer.kind !== "right" ||
                v.answer.rightIndexes.length !== 1 ||
                v.candidates.length !== 2
            )
                return false;
            const out = evalPairsOf(v, DEFAULT_EVAL_WEIGHTS);
            return (
                out.error === undefined &&
                out.pairs.length > 0 &&
                out.pairs.every((p) => p.delta > 1)
            );
        });
        const right = (v: (typeof satisfied)[number]) =>
            v.answer.kind === "right" ? v.answer.rightIndexes[0] : 0;
        const fitSide = satisfied.filter(
            (v) => heldOutBucketOf(scenarioKeyOf(v)) !== 0
        );
        if (fitSide.length < 2) throw new Error("need two fit-side positions");
        const [first, second] = fitSide;
        return {
            locked: judgementOn(first, right(first)),
            flipped: judgementOn(second, 1 - right(second)),
        };
    }

    const b64 = async (store: MemoryVerdictStore, prefix: string) =>
        (await listing(store, prefix)).map(({ name, bytes }) => ({
            name,
            base64: Buffer.from(bytes).toString("base64"),
        }));

    it("rewrites the committed weights to the byte: the exam side is invisible to the fit", async () => {
        const { locked, flipped } = positions();
        const store = createMemoryVerdictStore();
        await stored(store, locked);
        const snapshot = async () => ({
            verdictObjects: await b64(store, VERDICT_OBJECT_PREFIX),
            attestationObjects: await b64(store, ATTESTATION_OBJECT_PREFIX),
        });
        const promoted = runVerdictPromotionStep(
            {
                mode: "promote",
                lock: null,
                streakLedger: null,
                admission: {
                    minPersons: 2,
                    ownerPersons: [],
                    minConsecutivePromotions: 1,
                    seeds: [1],
                    iterations: 30,
                },
                evalWeightsSource: readFileSync(
                    join(ROOT, EVAL_WEIGHTS_PATH),
                    "utf8"
                ),
                ...(await snapshot()),
            },
            []
        );
        if (promoted.mode !== "promote" || promoted.noop)
            throw new Error("expected a promotion that writes");

        const flippedId = await stored(store, flipped);
        const exam = runVerdictPromotionStep(
            {
                mode: "exam",
                lock: promoted.lockText,
                evalWeightsSource: promoted.evalWeightsSource,
                ...(await snapshot()),
            },
            []
        );
        if (exam.mode !== "exam" || exam.noop)
            throw new Error("expected an exam step that writes");
        expect(exam.lock.examIds).toEqual([flippedId]);
        expect(exam.text).toContain("rule side 1");
        expect(exam).not.toHaveProperty("evalWeightsSource");

        const again = runVerdictPromotionStep(
            {
                mode: "exam",
                lock: exam.lockText,
                evalWeightsSource: promoted.evalWeightsSource,
                ...(await snapshot()),
            },
            []
        );
        expect(again).toMatchObject({ mode: "exam", noop: true });
    });
});
