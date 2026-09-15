// Resolving a Contested Position (issue #3582, PRD #3574, ADR 0128 §6).
//
// Every claim is a property of the classification a promotion reads: a
// resolved position becomes promotable through its accepted verdict and ONLY
// through it, the rejected judgement is still there with its reason, a
// decision about two answers is not a decision about three, and a
// resolution's name is its decision, never its provenance.
import { describe, it, expect } from "vitest";
import {
    formatVerdictQuarantine,
    positionKeyOf,
    quarantineContestedPositions,
    resolutionIdOf,
    resolutionProblems,
    verdictIdOf,
    type Verdict,
    type VerdictAttestation,
    type VerdictResolution,
} from "../verdicts";

const BASE: Verdict = {
    id: "in-play:k17abc",
    spec: {
        cards: [],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 7 },
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [2] },
    author: "prod:alice",
    createdAt: "2026-09-15T10:00:00.000Z",
    source: "in-play",
};

const answering = (rightIndexes: number[]) =>
    ({ ...BASE, answer: { kind: "right", rightIndexes } }) as Verdict;

const SHOCK = answering([2]);
const LAND = answering([1]);
const PASS = answering([0]);
const KEY = positionKeyOf(BASE);

const attest = (verdict: Verdict, author: string): VerdictAttestation => ({
    verdictId: verdictIdOf(verdict),
    author,
    sourceAxis: "explicit",
});

const ATTESTATIONS = [attest(SHOCK, "prod:alice"), attest(LAND, "prod:bob")];

const resolving = (
    accepted: Verdict | null,
    rejected: [Verdict, string][],
    extra: Partial<VerdictResolution> = {}
): VerdictResolution => ({
    positionKey: KEY,
    acceptedVerdictId: accepted === null ? null : verdictIdOf(accepted),
    rejected: rejected.map(([verdict, reason]) => ({
        verdictId: verdictIdOf(verdict),
        reason,
    })),
    author: "prod:admin",
    createdAt: 1_000,
    ...extra,
});

const ids = (list: { verdictId: string }[]) => list.map((v) => v.verdictId);

describe("a resolved position (ADR 0128 §6)", () => {
    it("is unresolved without a resolution: both answers quarantined", () => {
        const q = quarantineContestedPositions([SHOCK, LAND], ATTESTATIONS);
        expect(q.contested).toHaveLength(1);
        expect(q.resolved).toEqual([]);
        expect(q.promotable).toEqual([]);
    });

    it("promotes the accepted verdict and keeps the rejected one, with its reason", () => {
        const q = quarantineContestedPositions([SHOCK, LAND], ATTESTATIONS, [
            resolving(SHOCK, [[LAND, "Shock is lethal this turn"]]),
        ]);
        expect(q.contested).toEqual([]);
        expect(ids(q.promotable)).toEqual([verdictIdOf(SHOCK)]);
        expect(q.resolved).toHaveLength(1);
        const [position] = q.resolved;
        expect(position.positionKey).toBe(KEY);
        expect(position.accepted?.verdictId).toBe(verdictIdOf(SHOCK));
        // Rejected is still classified — its attestation included — never
        // dropped from the report.
        expect(position.rejected).toEqual([
            {
                verdict: expect.objectContaining({
                    verdictId: verdictIdOf(LAND),
                    attestations: [attest(LAND, "prod:bob")],
                }),
                reason: "Shock is lethal this turn",
            },
        ]);
    });

    it("promotes nothing when the resolver rejects every answer", () => {
        const q = quarantineContestedPositions([SHOCK, LAND], ATTESTATIONS, [
            resolving(null, [
                [SHOCK, "Opponent has a counter up"],
                [LAND, "Holding the land bluffs nothing"],
            ]),
        ]);
        expect(q.promotable).toEqual([]);
        expect(q.contested).toEqual([]);
        expect(q.resolved[0].accepted).toBeNull();
        expect(ids(q.resolved[0].rejected.map((r) => r.verdict))).toEqual(
            ids([
                { verdictId: verdictIdOf(SHOCK) },
                { verdictId: verdictIdOf(LAND) },
            ]).sort()
        );
    });

    it("reopens when a third answer arrives: a decision about two is not about three", () => {
        const resolution = resolving(SHOCK, [[LAND, "lethal"]]);
        const q = quarantineContestedPositions(
            [SHOCK, LAND, PASS],
            [...ATTESTATIONS, attest(PASS, "prod:carol")],
            [resolution]
        );
        expect(q.resolved).toEqual([]);
        expect(q.promotable).toEqual([]);
        expect(q.contested).toHaveLength(1);
        expect(q.contested[0].verdicts).toHaveLength(3);
        expect(q.contested[0].staleResolutions).toEqual([
            { resolutionId: resolutionIdOf(resolution), resolution },
        ]);
    });

    it("applies the newest of several resolutions, whatever the input order", () => {
        const first = resolving(SHOCK, [[LAND, "lethal"]], { createdAt: 1 });
        const second = resolving(LAND, [[SHOCK, "they gain life first"]], {
            createdAt: 2,
        });
        for (const resolutions of [
            [first, second],
            [second, first],
        ]) {
            const q = quarantineContestedPositions(
                [SHOCK, LAND],
                ATTESTATIONS,
                resolutions
            );
            expect(ids(q.promotable)).toEqual([verdictIdOf(LAND)]);
            expect(q.resolved[0].applied.resolution).toBe(second);
        }
    });

    it("does not touch an uncontested position", () => {
        const q = quarantineContestedPositions(
            [SHOCK],
            [attest(SHOCK, "prod:alice")],
            // Names an absent verdict, so its set is not the position's.
            [
                resolving(null, [
                    [SHOCK, "no"],
                    [LAND, "no"],
                ]),
            ]
        );
        expect(ids(q.promotable)).toEqual([verdictIdOf(SHOCK)]);
        expect(q.resolved).toEqual([]);
    });

    it("throws, naming it, on a resolution that is not a decision", () => {
        expect(() =>
            quarantineContestedPositions([SHOCK, LAND], ATTESTATIONS, [
                resolving(SHOCK, [[LAND, "   "]]),
            ])
        ).toThrow(/rejected without a reason/);
    });

    it("counts the resolved position per author and prints it", () => {
        const q = quarantineContestedPositions([SHOCK, LAND], ATTESTATIONS, [
            resolving(SHOCK, [[LAND, "lethal"]]),
        ]);
        expect(q.byAuthor.map((row) => row.resolvedPositionKeys)).toEqual([
            [KEY],
            [KEY],
        ]);
        expect(q.byAuthor.map((row) => row.contestedPositionKeys)).toEqual([
            [],
            [],
        ]);
        const text = formatVerdictQuarantine(q);
        expect(text).toContain("resolved positions     : 1");
        expect(text).toContain("rejected verdicts      : 1");
        expect(text).toContain(`    rejected ${verdictIdOf(LAND)}  (lethal)`);
        expect(text).toContain(
            "  prod:bob: 0 contested of 1 judged, 1 resolved"
        );
    });
});

describe("a resolution's identity and validity", () => {
    const base = resolving(SHOCK, [[LAND, "lethal"]]);

    it("is named by the decision, not by when it was given or the note", () => {
        expect(
            resolutionIdOf({
                ...base,
                createdAt: 99,
                note: "checked twice",
                deployment: "dev",
                deploymentKind: "local",
            })
        ).toBe(resolutionIdOf(base));
    });

    it("moves with the accepted verdict, a reason or the resolver", () => {
        const id = resolutionIdOf(base);
        expect(resolutionIdOf(resolving(LAND, [[SHOCK, "lethal"]]))).not.toBe(
            id
        );
        expect(resolutionIdOf(resolving(SHOCK, [[LAND, "other"]]))).not.toBe(
            id
        );
        expect(resolutionIdOf({ ...base, author: "prod:other" })).not.toBe(id);
    });

    it("does not move with the order the rejected entries were listed in", () => {
        const a = resolving(null, [
            [SHOCK, "x"],
            [LAND, "y"],
        ]);
        const b = resolving(null, [
            [LAND, "y"],
            [SHOCK, "x"],
        ]);
        expect(resolutionIdOf(a)).toBe(resolutionIdOf(b));
    });

    it("refuses a single decided verdict, a duplicate and a malformed key", () => {
        expect(resolutionProblems(base)).toEqual([]);
        expect(resolutionProblems(resolving(SHOCK, []))).toContain(
            "a resolution decides over at least two verdicts"
        );
        expect(resolutionProblems(resolving(SHOCK, [[SHOCK, "x"]]))).toContain(
            "a verdict is decided more than once"
        );
        expect(
            resolutionProblems({ ...base, positionKey: "not-a-key" })
        ).toContain('"not-a-key" is not a position key');
    });
});
