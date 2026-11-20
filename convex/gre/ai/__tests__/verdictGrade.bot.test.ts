// The Verdict Grade honoured (issue #10087, PRD issue #10083): which grade a
// Verdict is read with, how the lock carries it, and what it does to the fit
// input, held-out agreement and Tester Quality. Clear — every Verdict before
// grades existed — must read exactly as before.
import { describe, expect, it } from "vitest";
import {
    agreesWithVerdict,
    fitInputPairs,
    formatHeldOutPickAgreement,
    formatTesterQuality,
    heldOutEvalAgreement,
    heldOutReceiptRefusals,
    parseReferenceJudgeConfig,
    parseVerdictLock,
    planPromotion,
    quarantineContestedPositions,
    readingOfAttestations,
    referenceJudgeOf,
    serializeVerdictLock,
    testerQualityOf,
    verdictIdOf,
    verdictSideOf,
    verdictsFromLock,
    type EvalPair,
    type StoreValidation,
    type Verdict,
    type VerdictAttestation,
    type VerdictJudgement,
    type VerdictLock,
    type VerdictReading,
    type VerdictSearchRow,
} from "../verdicts";

const NONE: ReadonlySet<string> = new Set();
const JUDGE = "prod:judge";
const ANN = "prod:ann";
const BOB = "dev:bob";
const nobody = () => false;
const isJudge = (author: string) => author === JUDGE;

const att = (
    author: string,
    grade?: VerdictAttestation["grade"],
    acceptedIndexes?: number[]
): VerdictAttestation => ({
    verdictId: "v",
    author,
    sourceAxis: "explicit",
    ...(grade === undefined ? {} : { grade }),
    ...(acceptedIndexes === undefined ? {} : { acceptedIndexes }),
});

describe("the grade a Verdict is read with (PRD issue #10083)", () => {
    it("reads an ungraded Verdict as Clear — no reading at all", () => {
        expect(readingOfAttestations([att(ANN), att(BOB)], nobody)).toBe(null);
        expect(readingOfAttestations([], nobody)).toBe(null);
    });

    it("reads the least committal grade present when no Reference Judge attested", () => {
        expect(
            readingOfAttestations(
                [att(ANN, "clear"), att(BOB, "preferred", [2])],
                nobody
            )
        ).toEqual({ grade: "preferred", acceptedIndexes: [2] });
        expect(
            readingOfAttestations(
                [att(ANN, "preferred", [2]), att(BOB, "indifferent")],
                nobody
            )
        ).toEqual({ grade: "indifferent" });
    });

    it("reads the Reference Judge's grade over everyone else's", () => {
        expect(
            readingOfAttestations(
                [att(ANN, "indifferent"), att(JUDGE, "preferred", [0])],
                isJudge
            )
        ).toEqual({ grade: "preferred", acceptedIndexes: [0] });
        // The judge's ungraded word is Clear, and it rules.
        expect(
            readingOfAttestations(
                [att(ANN, "indifferent"), att(JUDGE)],
                isJudge
            )
        ).toBe(null);
    });

    it("takes the role from configuration, joined to the person through aliases", () => {
        const configured = parseReferenceJudgeConfig({ authors: [JUDGE] });
        const personOf = (a: string) => (a === "dev:judge" ? JUDGE : a);
        const holds = referenceJudgeOf(configured, personOf);
        expect([JUDGE, "dev:judge", ANN].map(holds)).toEqual([
            true,
            true,
            false,
        ]);
        expect(parseReferenceJudgeConfig(undefined)).toEqual([]);
        expect(() => parseReferenceJudgeConfig({ authors: "x" })).toThrow();
    });

    it("counts an accepted alternative of a Preferred Verdict as agreement", () => {
        const answer = { kind: "right" as const, rightIndexes: [1] };
        const reading: VerdictReading = {
            grade: "preferred",
            acceptedIndexes: [2],
        };
        const preferred = { answer, reading };
        expect([0, 1, 2].map((i) => agreesWithVerdict(preferred, i))).toEqual([
            false,
            true,
            true,
        ]);
        expect([0, 1, 2].map((i) => agreesWithVerdict({ answer }, i))).toEqual([
            false,
            true,
            false,
        ]);
    });
});

describe("the lock carries the grades (PRD issue #10083)", () => {
    const j = (turn: number): VerdictJudgement => ({
        spec: { cards: [], phase: "PRECOMBAT_MAIN", turn },
        seat: "me",
        candidates: [
            { key: '{"kind":"pass"}', description: "pass" },
            { key: '{"kind":"play-land"}', description: "play Forest" },
        ],
        answer: { kind: "right", rightIndexes: [1] },
    });
    const [a, b] = [j(1), j(2)];
    const [ida, idb] = [verdictIdOf(a), verdictIdOf(b)];
    const PACK = "c".repeat(64);
    const payloads = [
        { verdictId: ida, payload: a },
        { verdictId: idb, payload: b },
    ];

    it("writes an ungraded lock byte for byte as before", () => {
        const text = serializeVerdictLock({
            verdictIds: [ida, idb],
            packHash: PACK,
            readings: {},
        });
        expect(text).toBe(
            `${JSON.stringify({ packHash: PACK, verdictIds: [ida, idb] }, null, 4)}\n`
        );
        expect(
            verdictsFromLock(parseVerdictLock(text), payloads).map(
                (v) => v.reading
            )
        ).toEqual([undefined, undefined]);
    });

    it("round-trips a reading and hands it to the locked Verdict", () => {
        const lock: VerdictLock = {
            verdictIds: [ida, idb],
            packHash: PACK,
            readings: { [idb]: { grade: "indifferent" } },
        };
        const back = parseVerdictLock(serializeVerdictLock(lock));
        expect(back).toEqual(lock);
        expect(verdictsFromLock(back, payloads).map((v) => v.reading)).toEqual([
            undefined,
            { grade: "indifferent" },
        ]);
    });

    it("refuses a reading of an id it does not name, and a written Clear", () => {
        const text = (readings: Record<string, unknown>) =>
            JSON.stringify({ packHash: PACK, readings, verdictIds: [ida] });
        expect(() =>
            parseVerdictLock(text({ [idb]: { grade: "indifferent" } }))
        ).toThrow(/does not name/);
        expect(() =>
            parseVerdictLock(text({ [ida]: { grade: "clear" } }))
        ).toThrow(/no reading/);
    });

    it("records the read grade at promotion, and a regrade is no no-op", () => {
        const validation = (
            attestations: VerdictAttestation[]
        ): StoreValidation =>
            ({
                rows: [],
                attestationProblems: [],
                resolutionProblems: [],
                promotable: [{ verdictId: ida, payload: a }],
                quarantine: {
                    promotable: [
                        {
                            verdictId: ida,
                            positionKey: "k",
                            judgement: a,
                            attestations,
                        },
                    ],
                    contested: [],
                    resolved: [],
                    implicitOnly: [],
                    unattested: [],
                    byAuthor: [],
                },
            }) as StoreValidation;
        const ungraded = planPromotion(null, validation([att(ANN)]));
        expect(ungraded.lock.readings).toBeUndefined();
        const graded = planPromotion(
            ungraded.lock,
            validation([att(ANN, "clear"), att(JUDGE, "indifferent")]),
            nobody
        );
        expect(graded.lock.readings).toEqual({
            [ida]: { grade: "indifferent" },
        });
        expect(graded.noop).toBe(false);
        // The judge's Clear rules over Ann's doubt once the role is theirs.
        expect(
            planPromotion(
                graded.lock,
                validation([att(ANN, "indifferent"), att(JUDGE, "clear")]),
                isJudge
            ).lock.readings
        ).toBeUndefined();
    });
});

/** The `n`-th board on `side` of the real split, read with `reading`. */
function verdictOn(
    side: "fit" | "held-out",
    n: number,
    reading?: VerdictReading
): Verdict {
    let seen = 0;
    for (let turn = 1; turn < 5000; turn++) {
        const v: Verdict = {
            id: `${side}:${n}`,
            spec: { cards: [], phase: "PRECOMBAT_MAIN", turn },
            seat: "me",
            candidates: [
                { key: '{"kind":"pass"}', description: "pass" },
                { key: '{"kind":"cast-spell"}', description: "cast" },
                { key: '{"kind":"play-land"}', description: "land" },
            ],
            answer: { kind: "right", rightIndexes: [1] },
            author: "dev:t",
            createdAt: "2026-11-20T10:00:00.000Z",
            source: "authored",
            ...(reading === undefined ? {} : { reading }),
        };
        if (verdictSideOf(v, NONE) === side && seen++ === n) return v;
    }
    throw new Error(`no ${side} board`);
}

const pair = (verdictId: string, delta: number, otherIndex = 0): EvalPair =>
    ({ verdictId, delta, otherIndex }) as EvalPair;

describe("grades in the fit input and in agreement (PRD issue #10083)", () => {
    it("leaves an Indifferent Verdict out of the fit input, and only it", () => {
        const clear = verdictOn("fit", 0);
        const preferred = verdictOn("fit", 1, {
            grade: "preferred",
            acceptedIndexes: [2],
        });
        const indifferent = verdictOn("fit", 2, { grade: "indifferent" });
        const pairs = [clear, preferred, indifferent].map((v) => pair(v.id, 1));
        expect(
            fitInputPairs(pairs, [clear, preferred, indifferent], NONE).map(
                (p) => p.verdictId
            )
        ).toEqual([clear.id, preferred.id]);
    });

    it("counts an accepted alternative as agreed and states the Indifferent it excluded", () => {
        const preferred = verdictOn("held-out", 0, {
            grade: "preferred",
            acceptedIndexes: [2],
        });
        const indifferent = verdictOn("held-out", 1, { grade: "indifferent" });
        const clear = verdictOn("held-out", 2);
        const agreement = heldOutEvalAgreement(
            {
                pairs: [
                    pair(preferred.id, -50, 2), // the alternative scores higher
                    pair(preferred.id, 30, 0),
                    pair(indifferent.id, -80, 0),
                    pair(clear.id, -20, 2), // no grade: a loss is a loss
                ],
                timing: [pair(indifferent.id, 1)],
                incomplete: [],
            },
            [preferred, indifferent, clear],
            NONE
        );
        expect(agreement.aggregate).toEqual({ agreed: 2, n: 3 });
        expect(agreement.excludedIndifferent).toBe(1);
        expect(agreement.excludedTiming).toBe(0);
    });

    it("keeps an Indifferent row out of the pick-agreement denominator and says so", () => {
        const row = (
            id: string,
            agreed: number,
            extra: Partial<VerdictSearchRow> = {}
        ): VerdictSearchRow => ({
            verdictId: id,
            class: "cast",
            timing: false,
            agreed,
            seeds: 2,
            picks: [],
            ...extra,
        });
        const rows = [
            row("a", 2),
            row("b", 0, { seeds: 0, indifferent: true }),
        ];
        const text = formatHeldOutPickAgreement(rows, "1 iteration", {
            burned: 0,
            heldOutN: 2,
        });
        expect(text).toContain("  all                : 1/1 (100.0%)");
        expect(text).toContain(
            "  indifferent        : 1 verdicts graded Indifferent"
        );
        expect(heldOutReceiptRefusals([rows[1]])).toHaveLength(1);
        expect(heldOutReceiptRefusals(rows)).toEqual([]);
    });
});

describe("Tester Quality prints the grades each tester gave (PRD issue #10083)", () => {
    const j = (turn: number): VerdictJudgement => ({
        spec: { cards: [], phase: "PRECOMBAT_MAIN", turn },
        seat: "me",
        candidates: [
            { key: '{"kind":"pass"}', description: "pass" },
            { key: '{"kind":"play-land"}', description: "play Forest" },
        ],
        answer: { kind: "right", rightIndexes: [1] },
    });
    const on = (
        judgement: VerdictJudgement,
        author: string,
        grade?: VerdictAttestation["grade"]
    ): VerdictAttestation => ({
        ...att(author, grade),
        verdictId: verdictIdOf(judgement),
    });

    it("counts one grade per verdict per person, ungraded as clear", () => {
        const [x, y, z] = [j(1), j(2), j(3)];
        const q = quarantineContestedPositions(
            [x, y, z],
            [
                on(x, ANN),
                on(y, ANN, "preferred"),
                on(z, ANN, "indifferent"),
                on(x, BOB, "indifferent"),
            ]
        );
        const report = testerQualityOf(q, [], null);
        const grades = Object.fromEntries(
            report.testers.map((t) => [t.person, t.grades])
        );
        expect(grades).toEqual({
            [BOB]: { clear: 0, preferred: 0, indifferent: 1 },
            [ANN]: { clear: 1, preferred: 1, indifferent: 1 },
        });
        expect(formatTesterQuality(report)).toContain(
            "  grades       : clear 1 · preferred 1 · indifferent 1"
        );
    });
});
