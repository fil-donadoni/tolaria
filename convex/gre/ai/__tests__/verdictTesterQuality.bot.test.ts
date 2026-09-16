// Per-tester quality (issue #3585, PRD #3574, ADR 0128): given, contradicted,
// quarantined and unsatisfied per PERSON, one person's accounts joined by
// author aliases, every number carrying the positions behind it.

import { describe, expect, it } from "vitest";
import {
    formatTesterQuality,
    personsOf,
    positionKeyOf,
    quarantineContestedPositions,
    resolutionIdOf,
    testerQualityOf,
    verdictIdOf,
    type VerdictAttestation,
    type VerdictJudgement,
    type VerdictResolution,
    type VerdictSourceAxis,
} from "../verdicts";

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

const attest = (
    j: VerdictJudgement,
    author: string,
    sourceAxis: VerdictSourceAxis = "explicit"
): VerdictAttestation => ({
    verdictId: verdictIdOf(j),
    author,
    sourceAxis,
});

const LOCK_PACK = "a".repeat(64);

const DEV = "dev-a:owner1";
const PROD = "prod-b:owner2";
const BOB = "prod-b:bob";

function rowOf(report: ReturnType<typeof testerQualityOf>, person: string) {
    const row = report.testers.find((t) => t.person === person);
    if (row === undefined) throw new Error(`no row for ${person}`);
    return row;
}

const keys = (positions: { positionKey: string }[]) =>
    positions.map((p) => p.positionKey);

describe("per-tester quality — the four numbers (issue #3585)", () => {
    it("counts given, contradicted and quarantined per person, with the positions behind each", () => {
        const agreed = judgement(1, 1);
        const mine = judgement(2, 1);
        const theirs = judgement(2, 2);
        const q = quarantineContestedPositions(
            [agreed, mine, theirs],
            [
                attest(agreed, DEV),
                attest(agreed, BOB),
                attest(mine, DEV),
                attest(theirs, BOB),
            ]
        );
        const report = testerQualityOf(q, [], null);

        const owner = rowOf(report, DEV);
        expect(keys(owner.given).sort()).toEqual(
            [positionKeyOf(agreed), positionKeyOf(mine)].sort()
        );
        expect(owner.contradicted).toEqual([
            {
                positionKey: positionKeyOf(mine),
                verdictIds: [verdictIdOf(mine)],
            },
        ]);
        expect(keys(owner.quarantined)).toEqual([positionKeyOf(mine)]);
        expect(rowOf(report, BOB).contradicted).toEqual([
            {
                positionKey: positionKeyOf(theirs),
                verdictIds: [verdictIdOf(theirs)],
            },
        ]);
    });

    it("never counts an implicit attestation as a judgement given", () => {
        const j = judgement(1, 1);
        const q = quarantineContestedPositions(
            [j],
            [attest(j, DEV), attest(j, BOB, "implicit")]
        );
        const report = testerQualityOf(q, [], null);
        expect(report.testers.map((t) => t.person)).toEqual([DEV]);
    });

    it("keeps a resolved disagreement as contradicted, but no longer quarantined", () => {
        const mine = judgement(3, 1);
        const theirs = judgement(3, 2);
        const resolution: VerdictResolution = {
            positionKey: positionKeyOf(mine),
            acceptedVerdictId: verdictIdOf(mine),
            rejected: [{ verdictId: verdictIdOf(theirs), reason: "misread" }],
            author: "prod-b:admin",
        };
        expect(resolutionIdOf(resolution)).toMatch(/^v1-/);
        const q = quarantineContestedPositions(
            [mine, theirs],
            [attest(mine, DEV), attest(theirs, BOB)],
            [resolution]
        );
        const owner = rowOf(testerQualityOf(q, [], null), DEV);
        expect(keys(owner.contradicted)).toEqual([positionKeyOf(mine)]);
        expect(owner.quarantined).toEqual([]);
    });
});

describe("one person across deployments (issue #3585)", () => {
    it("aggregates two accounts joined by an alias into one row", () => {
        const onDev = judgement(1, 1);
        const onProd = judgement(2, 1);
        const q = quarantineContestedPositions(
            [onDev, onProd],
            [attest(onDev, DEV), attest(onProd, PROD)]
        );
        const apart = testerQualityOf(q, [], null);
        expect(apart.testers.map((t) => t.given.length)).toEqual([1, 1]);

        const joined = testerQualityOf(q, [{ authors: [PROD, DEV] }], null);
        expect(joined.testers).toHaveLength(1);
        expect(joined.testers[0].person).toBe(DEV);
        expect(joined.testers[0].authors).toEqual([DEV, PROD]);
        expect(joined.testers[0].given).toHaveLength(2);
    });

    it("does not call one person's two accounts disagreeing a contradiction — it is still quarantined", () => {
        const a = judgement(4, 1);
        const b = judgement(4, 2);
        const q = quarantineContestedPositions(
            [a, b],
            [attest(a, DEV), attest(b, PROD)]
        );
        const joined = testerQualityOf(q, [{ authors: [DEV, PROD] }], null);
        expect(joined.testers).toHaveLength(1);
        expect(joined.testers[0].contradicted).toEqual([]);
        expect(keys(joined.testers[0].quarantined)).toEqual([positionKeyOf(a)]);
    });

    it("joins through a chain, and names the person by the smallest author whatever the order", () => {
        const chain = [
            { authors: ["c-dep:z", "b-dep:y"] as [string, string] },
            { authors: ["b-dep:y", "a-dep:x"] as [string, string] },
        ];
        const forward = personsOf(["c-dep:z"], chain);
        const backward = personsOf(["c-dep:z"], [...chain].reverse());
        expect(forward.get("c-dep:z")).toBe("a-dep:x");
        expect(backward.get("c-dep:z")).toBe("a-dep:x");
    });
});

describe("unsatisfied — read from the fit report over the lock (issue #3585)", () => {
    const given = judgement(5, 1);
    const unfit = judgement(6, 2);
    const unlocked = judgement(7, 1);
    const q = quarantineContestedPositions(
        [given, unfit, unlocked],
        [attest(given, DEV), attest(unfit, DEV), attest(unlocked, BOB)]
    );
    const lock = {
        verdictIds: [verdictIdOf(given), verdictIdOf(unfit)],
        packHash: LOCK_PACK,
    };

    it("counts the person's locked verdicts the fit left unsatisfied, and nothing else", () => {
        const report = testerQualityOf(q, [], {
            lock,
            unsatisfiedVerdictIds: [verdictIdOf(unfit)],
        });
        expect(report.fitRead).toBe(true);
        expect(rowOf(report, DEV).unsatisfied).toEqual([
            {
                positionKey: positionKeyOf(unfit),
                verdictIds: [verdictIdOf(unfit)],
            },
        ]);
        expect(rowOf(report, BOB).unsatisfied).toEqual([]);
    });

    it("refuses a fit report naming a verdict the lock does not", () => {
        expect(() =>
            testerQualityOf(q, [], {
                lock,
                unsatisfiedVerdictIds: [verdictIdOf(unlocked)],
            })
        ).toThrow(/not over this lock/);
    });

    it("lists an unsatisfied locked verdict nobody in the store attests, never drops it", () => {
        const orphan = judgement(8, 1);
        const report = testerQualityOf(q, [], {
            lock: {
                verdictIds: [...lock.verdictIds, verdictIdOf(orphan)],
                packHash: LOCK_PACK,
            },
            unsatisfiedVerdictIds: [verdictIdOf(orphan)],
        });
        expect(report.unattributedUnsatisfied).toEqual([verdictIdOf(orphan)]);
    });

    it("says unsatisfied is unmeasured with no lock, and presents it as a pointer, never a score", () => {
        expect(formatTesterQuality(testerQualityOf(q, [], null))).toContain(
            "unsatisfied  : not measured"
        );
        const text = formatTesterQuality(
            testerQualityOf(q, [], {
                lock,
                unsatisfiedVerdictIds: [verdictIdOf(unfit)],
            })
        );
        expect(text).toContain(
            "unsatisfied  : 1 — positions worth a look, not a score"
        );
        expect(text).toContain("a term the evaluation lacks");
        // Every number drills through to the verdict ids behind it.
        expect(text).toContain(
            `      ${positionKeyOf(unfit)}  ${verdictIdOf(unfit)}`
        );
    });
});
