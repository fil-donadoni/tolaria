// Verdict classification and the Minimal Pair link (issue #4793, PRD #4792,
// ADR 0148).
//
// Claims:
//
//  - classification and Discriminant are judgement: they move the verdict id,
//    never the position key, and "wrong always" / "wrong now" about one
//    position are two verdicts;
//  - the store round-trips the new fields and refuses malformed ones, and an
//    old record reads as unclassified — an unclassified `forbidden` from the
//    store as an incomplete Conditional Verdict, an unclassified `right` as
//    it always was;
//  - promotion keeps an incomplete Conditional Verdict out of the lock and
//    counts it; a complete pair enters as both halves; a contested or
//    unattested half keeps both out;
//  - an incomplete Conditional Verdict yields no Eval Pairs.
import { describe, expect, it } from "vitest";
import {
    ATTESTATION_OBJECT_PREFIX,
    RESOLUTION_OBJECT_PREFIX,
    VERDICT_OBJECT_PREFIX,
    decodeVerdictObject,
    encodeVerdictObject,
    putAttestation,
    putResolution,
    putVerdict,
} from "../../../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../../../verdictStoreMemory";
import {
    censusByClass,
    collectVerdictReport,
    evalPairsOf,
    formatStoreValidation,
    minimalPairStandings,
    planPromotion,
    positionKeyOf,
    validateStoreObjects,
    verdictIdOf,
    verdictsFromLock,
    verdictsFromRegistry,
    type Discriminant,
    type StoreObject,
    type Verdict,
    type VerdictJudgement,
} from "../verdicts";

const END_STEP: Discriminant = { kind: "step", detail: "opponent's end step" };

/** A judgement on board `turn`. Two judgements share a position key exactly
 *  when they share a turn. */
const board = (turn: number) => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" as const, turn },
    seat: "me" as const,
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Terror" },
    ],
});

const forbidCast = (turn: number): VerdictJudgement => ({
    ...board(turn),
    answer: { kind: "forbidden", forbiddenIndexes: [1] },
});

const conditional = (turn: number, d = END_STEP): VerdictJudgement => ({
    ...forbidCast(turn),
    classification: { kind: "conditional", discriminant: d },
});

const halfOf = (
    anchor: VerdictJudgement,
    turn: number,
    d = END_STEP
): VerdictJudgement => ({
    ...board(turn),
    answer: { kind: "right", rightIndexes: [1] },
    pairOf: { anchorId: verdictIdOf(anchor), discriminant: d },
});

/** A judgement as the lock reader turns stored JSON into a Verdict. */
function readBack(j: VerdictJudgement): Verdict {
    const { name, bytes, verdictId } = encodeVerdictObject(j);
    const payload = decodeVerdictObject(name, bytes);
    return verdictsFromLock(
        { verdictIds: [verdictId], packHash: "0".repeat(64) },
        [{ verdictId, payload }]
    )[0];
}

function readRaw(raw: Record<string, unknown>): Verdict {
    return verdictsFromLock(
        {
            verdictIds: [verdictIdOf(raw as VerdictJudgement)],
            packHash: "0".repeat(64),
        },
        [{ verdictId: verdictIdOf(raw as VerdictJudgement), payload: raw }]
    )[0];
}

describe("classification is judgement (issue #4793, ADR 0148)", () => {
    it("moves the verdict id, never the position key", () => {
        const bare = forbidCast(1);
        const absolute: VerdictJudgement = {
            ...bare,
            classification: { kind: "absolute" },
        };
        const now = conditional(1);
        const otherReason = conditional(1, { kind: "card", detail: "Terror" });
        const ids = [bare, absolute, now, otherReason].map(verdictIdOf);
        // Four claims — unclassified, "always", "now because of the step",
        // "now because of a card" — are four verdicts.
        expect(new Set(ids).size).toBe(4);
        // ...about ONE decision: quarantine must see them as rivals.
        expect(
            new Set([bare, absolute, now, otherReason].map(positionKeyOf)).size
        ).toBe(1);
    });

    it("moves the id of a right-hand half with its anchor", () => {
        const a = conditional(1);
        const b = conditional(1, { kind: "life", detail: "opponent at 3" });
        expect(verdictIdOf(halfOf(a, 2))).not.toBe(verdictIdOf(halfOf(b, 2)));
        expect(positionKeyOf(halfOf(a, 2))).toBe(positionKeyOf(halfOf(b, 2)));
    });
});

describe("store parsing and the upcast (issue #4793)", () => {
    it("round-trips classification and the pair link under their own id", () => {
        const anchor = conditional(1);
        const half = halfOf(anchor, 2);
        expect(readBack(anchor).classification).toEqual(anchor.classification);
        expect(readBack(half).pairOf).toEqual(half.pairOf);
        expect(
            readBack({ ...anchor, classification: { kind: "absolute" } })
                .classification
        ).toEqual({ kind: "absolute" });
    });

    it.each([
        [
            "an unknown classification",
            { classification: { kind: "maybe" } },
            /classification\.kind/,
        ],
        [
            "a Discriminant kind off the list",
            {
                classification: {
                    kind: "conditional",
                    discriminant: { kind: "mood", detail: "x" },
                },
            },
            /discriminant\.kind/,
        ],
        [
            "a Discriminant with no words",
            {
                classification: {
                    kind: "conditional",
                    discriminant: { kind: "other", detail: "  " },
                },
            },
            /detail/,
        ],
        [
            "a Discriminant padded with whitespace",
            {
                classification: {
                    kind: "conditional",
                    discriminant: { kind: "card", detail: "Terror " },
                },
            },
            /whitespace/,
        ],
        [
            "an absolute verdict with a reason",
            { classification: { kind: "absolute", discriminant: END_STEP } },
            /names no Discriminant/,
        ],
    ])("refuses %s", (_, extra, why) => {
        expect(() => readRaw({ ...forbidCast(1), ...extra })).toThrow(why);
    });

    it("refuses a malformed right-hand half", () => {
        const anchor = conditional(1);
        const half = halfOf(anchor, 2);
        expect(() =>
            readRaw({
                ...half,
                pairOf: { ...half.pairOf, anchorId: "registry:x" },
            })
        ).toThrow(/anchorId/);
        expect(() =>
            readRaw({ ...half, classification: { kind: "absolute" } })
        ).toThrow(/carries no "classification"/);
        expect(() =>
            readRaw({
                ...half,
                answer: { kind: "forbidden", forbiddenIndexes: [0] },
            })
        ).toThrow(/must answer "right"/);
    });

    it("reads an old record as unclassified: a stored forbidden is incomplete, a stored right is kept", () => {
        const oldForbidden = readBack(forbidCast(1));
        const oldRight = readBack({
            ...board(2),
            answer: { kind: "right", rightIndexes: [0] },
        });
        expect(oldForbidden.classification).toBeUndefined();
        const standings = minimalPairStandings(
            [oldForbidden, oldRight].map((v) => ({
                verdictId: v.id,
                judgement: v,
                stored: true,
            }))
        );
        expect(standings.get(oldForbidden.id)?.kind).toBe("incomplete");
        expect(standings.get(oldRight.id)?.kind).toBe("unclassified");
        // The upcast is the STORE's: the same forbidden, not from the store,
        // keeps today's behaviour.
        expect(
            minimalPairStandings([
                {
                    verdictId: oldForbidden.id,
                    judgement: oldForbidden,
                    stored: false,
                },
            ]).get(oldForbidden.id)?.kind
        ).toBe("unclassified");
    });
});

async function stored(
    store: MemoryVerdictStore,
    j: VerdictJudgement,
    authors: string[] = ["prod-a:alice"]
): Promise<string> {
    const { verdictId } = await putVerdict(store, j);
    for (const author of authors) {
        await putAttestation(store, {
            verdictId,
            author,
            sourceAxis: "explicit",
        });
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

async function validate(store: MemoryVerdictStore) {
    return validateStoreObjects(
        await listing(store, VERDICT_OBJECT_PREFIX),
        await listing(store, ATTESTATION_OBJECT_PREFIX),
        () => null,
        [],
        await listing(store, RESOLUTION_OBJECT_PREFIX)
    );
}

describe("promotion reads a Minimal Pair as one unit (issue #4793)", () => {
    it("keeps an incomplete Conditional Verdict out of the lock and counts it", async () => {
        const store = createMemoryVerdictStore();
        const anchor = await stored(store, conditional(1));
        const oldForbidden = await stored(store, forbidCast(5));
        const absolute = await stored(store, {
            ...forbidCast(3),
            classification: { kind: "absolute" },
        });
        const validation = await validate(store);
        const plan = planPromotion(null, validation);
        expect(plan.lock.verdictIds).toEqual([absolute]);
        const status = (id: string) =>
            validation.rows.find((r) => r.verdictId === id)!;
        expect(status(anchor).status).toBe("incomplete-pair");
        expect(status(anchor).reasons[0]).toMatch(/no right-hand half/);
        expect(status(oldForbidden).status).toBe("incomplete-pair");
        expect(formatStoreValidation(validation)).toContain(
            "incomplete-pair      : 2"
        );
    });

    it("puts both halves of a complete pair in the lock", async () => {
        const store = createMemoryVerdictStore();
        const a = conditional(1);
        const anchor = await stored(store, a);
        // Anyone may write the half: its attestation is its own.
        const half = await stored(store, halfOf(a, 2), ["prod-a:bob"]);
        const plan = planPromotion(null, await validate(store));
        expect([...plan.lock.verdictIds].sort()).toEqual([anchor, half].sort());
    });

    it("keeps both out when the half is contested, unattested or names another reason", async () => {
        const a = conditional(1);
        const contestedStore = createMemoryVerdictStore();
        await stored(contestedStore, a);
        await stored(contestedStore, halfOf(a, 2));
        // A second explicit judgement at the half's position, disagreeing.
        await stored(
            contestedStore,
            { ...board(2), answer: { kind: "right", rightIndexes: [0] } },
            ["prod-a:carol"]
        );
        expect(
            planPromotion(null, await validate(contestedStore)).lock.verdictIds
        ).toEqual([]);

        const unattestedStore = createMemoryVerdictStore();
        await stored(unattestedStore, a);
        await stored(unattestedStore, halfOf(a, 2), []);
        expect(
            planPromotion(null, await validate(unattestedStore)).lock.verdictIds
        ).toEqual([]);

        // The mirror: the ANCHOR is unattested, so the half stands alone — and
        // a half alone teaches "always" as an anchor alone teaches "never".
        const orphanStore = createMemoryVerdictStore();
        await stored(orphanStore, a, []);
        const orphan = await stored(orphanStore, halfOf(a, 2));
        const orphaned = await validate(orphanStore);
        expect(planPromotion(null, orphaned).lock.verdictIds).toEqual([]);
        expect(
            orphaned.rows.find((r) => r.verdictId === orphan)!.reasons[0]
        ).toMatch(/not beside it/);

        const mismatchStore = createMemoryVerdictStore();
        await stored(mismatchStore, a);
        const half = await stored(
            mismatchStore,
            halfOf(a, 2, { kind: "mana", detail: "two open" })
        );
        const validation = await validate(mismatchStore);
        expect(planPromotion(null, validation).lock.verdictIds).toEqual([]);
        expect(
            validation.rows.find((r) => r.verdictId === half)!.reasons[0]
        ).toMatch(/one pair, one Discriminant/);
    });
});

describe("reclassifying an old forbidden goes through a resolution (issue #4793)", () => {
    it("holds the position contested until an admin accepts the classified record", async () => {
        const store = createMemoryVerdictStore();
        const a = conditional(1);
        const old = await stored(store, forbidCast(1));
        const anchor = await stored(store, a, ["prod-a:bob"]);
        const half = await stored(store, halfOf(a, 2));
        // Two answers to one decision: quarantined, and the half with them.
        expect(
            planPromotion(null, await validate(store)).lock.verdictIds
        ).toEqual([]);

        await putResolution(store, {
            positionKey: positionKeyOf(a),
            acceptedVerdictId: anchor,
            rejected: [{ verdictId: old, reason: "reclassified: wrong now" }],
            author: "prod-a:admin",
            createdAt: 1,
        });
        expect(
            [
                ...planPromotion(null, await validate(store)).lock.verdictIds,
            ].sort()
        ).toEqual([anchor, half].sort());
    });
});

describe("Eval Pair derivation skips an incomplete Conditional Verdict (issue #4793)", () => {
    // A real registry position whose forbidden answer yields pairs today.
    const real = verdictsFromRegistry().verdicts.find(
        (v) => v.answer.kind === "forbidden" && evalPairsOf(v).pairs.length > 0
    )!;

    it("yields pairs unclassified, none once classified conditional and unpaired", () => {
        expect(collectVerdictReport([real]).pairs.length).toBeGreaterThan(0);

        const now: Verdict = {
            ...real,
            id: "authored:now",
            source: "authored",
            classification: { kind: "conditional", discriminant: END_STEP },
        };
        const report = collectVerdictReport([now]);
        // Out of the fit, so out of the coverage census: counted, it would
        // read as a covered class with no pairs.
        expect(censusByClass(report, [now]).totals.verdicts).toBe(0);
        expect(
            censusByClass(collectVerdictReport([real]), [real]).totals.verdicts
        ).toBe(1);
        expect(report.pairs).toEqual([]);
        expect(report.rows).toEqual([]);
        expect(report.incomplete).toEqual([
            {
                verdictId: "authored:now",
                why: expect.stringMatching(/no right-hand half/),
            },
        ]);
    });

    it("upcasts a stored unclassified forbidden, and leaves the registry's alone", () => {
        const fromStore: Verdict = { ...real, source: "store" };
        expect(collectVerdictReport([fromStore]).pairs).toEqual([]);
        expect(collectVerdictReport([fromStore]).incomplete).toHaveLength(1);
        expect(collectVerdictReport([real]).incomplete).toEqual([]);
    });
});
