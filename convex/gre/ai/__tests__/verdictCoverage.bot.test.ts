// The coverage census: which DECISIONS the verdict corpus holds (issue #3588).
//
// The claims worth guarding are not arithmetic — they are the four places a
// census can lie and still look healthy:
//
//  1. A class it cannot read is absorbed into another one, so the corpus looks
//     complete the day the engine grows a move kind.
//  2. A stale verdict falls out of the denominator, shrinking exactly the
//     class the engine has most recently broken.
//  3. An unreachable pair (blind, or half of a contradictory couple) is
//     counted as something a better model could buy — the number a model-class
//     experiment would then over-claim on.
//  4. The judged class is taken from the wrong side of a pair, so "cast beats
//     pass" is filed under `pass`.
//
// Everything here is pure: no rebuild, no engine, no clock. The class of a
// candidate is readable off its stored key because `moveKey` is
// `JSON.stringify(move)`, and the census leans on that deliberately — a
// verdict whose position no longer builds must still be classifiable.
import { describe, expect, it } from "vitest";
import {
    CLASS_OF_MOVE_KIND,
    CLASS_EVIDENCE_FLOOR,
    censusByClass,
    classesBelowFloor,
    decisionClassOfKey,
    formatCensus,
    isResponseVerdict,
    offeredDecisionClasses,
    pairDecisionClass,
    verdictDecisionClass,
} from "../verdicts/coverage";
import type { EvalPair } from "../verdicts/evalPairs";
import type { VerdictReport } from "../verdicts/report";
import type { Verdict, VerdictCandidate } from "../verdicts/types";

const key = (kind: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ kind, ...extra });

const candidate = (kind: string): VerdictCandidate => ({
    key: key(kind),
    description: kind,
});

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
    id: "authored:v",
    spec: { cards: [] },
    seat: "me",
    candidates: [candidate("cast-spell"), candidate("pass")],
    answer: { kind: "right", rightIndexes: [0] },
    author: "tester",
    createdAt: "2026-09-14T00:00:00.000Z",
    source: "authored",
    ...over,
});

const pair = (
    rightKind: string,
    otherKind: string,
    id = "authored:v"
): EvalPair =>
    ({
        verdictId: id,
        kind: "right",
        rightIndex: 0,
        otherIndex: 1,
        right: candidate(rightKind),
        other: candidate(otherKind),
        terms: {},
        basis: {},
        fittableDelta: 0,
        delta: 0,
    }) as unknown as EvalPair;

const report = (over: Partial<VerdictReport> = {}): VerdictReport => ({
    verdicts: 0,
    rows: [],
    pairs: [],
    satisfied: [],
    violated: [],
    contradictions: [],
    blind: [],
    gaps: [],
    errors: [],
    ...over,
});

describe("decision classes come from the engine's move kinds (issue #3588)", () => {
    it("reads the class off a candidate's structural key", () => {
        expect(decisionClassOfKey(key("declare-blockers"))).toBe(
            "declare-blockers"
        );
        expect(decisionClassOfKey(key("play-land"))).toBe("land-drop");
        expect(decisionClassOfKey(key("land-entry"))).toBe("land-drop");
    });

    it("refuses to bucket a kind it does not know, and says so", () => {
        // The failure this guards: a new `Move` kind silently folded into an
        // existing class would make the census report coverage of a space that
        // had just grown. `null` here surfaces as `unclassified` in the table.
        expect(decisionClassOfKey(key("teleport-to-mars"))).toBeNull();
        expect(decisionClassOfKey("not json at all")).toBeNull();
        expect(decisionClassOfKey(JSON.stringify({ noKind: 1 }))).toBeNull();
    });

    it("maps every move kind the engine has", () => {
        // Totality is enforced by `tsc` on the Record's type; this asserts the
        // values are real classes rather than a placeholder someone reached
        // for to silence the compiler.
        for (const [kind, cls] of Object.entries(CLASS_OF_MOVE_KIND)) {
            expect(cls, kind).toBeTruthy();
        }
    });
});

describe("a verdict's class is the class of what the judge NAMED", () => {
    it("takes the named candidate, not the first one", () => {
        expect(
            verdictDecisionClass(
                verdict({
                    candidates: [
                        candidate("pass"),
                        candidate("declare-attackers"),
                    ],
                    answer: { kind: "right", rightIndexes: [1] },
                })
            )
        ).toBe("declare-attackers");
    });

    it("uses the forbidden side when that is all the judgement says", () => {
        expect(
            verdictDecisionClass(
                verdict({
                    candidates: [candidate("cast-spell"), candidate("pass")],
                    answer: { kind: "forbidden", forbiddenIndexes: [0] },
                })
            )
        ).toBe("cast");
    });

    it("says `mixed` rather than picking one when the named candidates span classes", () => {
        expect(
            verdictDecisionClass(
                verdict({
                    candidates: [
                        candidate("cast-spell"),
                        candidate("declare-attackers"),
                    ],
                    answer: { kind: "right", rightIndexes: [0, 1] },
                })
            )
        ).toBe("mixed");
    });

    it("reports every class the decision OFFERED, whatever was chosen", () => {
        const offered = offeredDecisionClasses(
            verdict({
                candidates: [
                    candidate("cast-spell"),
                    candidate("declare-attackers"),
                    candidate("pass"),
                ],
            })
        );
        expect([...offered].sort()).toEqual([
            "cast",
            "declare-attackers",
            "pass",
        ]);
    });

    it("separates a judgement about responding from one about acting", () => {
        expect(isResponseVerdict(verdict())).toBe(false);
        expect(
            isResponseVerdict(
                verdict({
                    spec: {
                        cards: [],
                        stack: [
                            {
                                kind: "spell",
                                name: "Lightning Bolt",
                                controller: "opp",
                            },
                        ],
                    },
                })
            )
        ).toBe(true);
    });
});

describe("the census counts what a model could actually buy", () => {
    it("files a pair under the class of the move the judge defended", () => {
        expect(pairDecisionClass(pair("cast-spell", "pass"))).toBe("cast");
        expect(pairDecisionClass(pair("pass", "cast-spell"))).toBe("pass");
    });

    it("subtracts blind and contradictory pairs from the addressable count", () => {
        const blind = pair("cast-spell", "pass");
        const contra = pair("cast-spell", "pass");
        const real = pair("cast-spell", "pass");
        const census = censusByClass(
            report({
                pairs: [blind, contra, real],
                satisfied: [],
                violated: [blind, contra, real],
                blind: [blind],
                contradictions: [{ a: contra, b: contra }],
            }),
            [verdict()]
        );
        const cast = census.rows.find((r) => r.class === "cast");
        expect(cast?.violated).toBe(3);
        expect(cast?.blind).toBe(1);
        expect(cast?.contradictory).toBe(1);
        expect(cast?.addressable).toBe(1);
    });

    it("subtracts a pair that is BOTH blind and contradictory only once", () => {
        // Otherwise `addressable` goes negative, and a negative headroom reads
        // as "this class is fine" to anyone skimming.
        const both = pair("cast-spell", "pass");
        const census = censusByClass(
            report({
                pairs: [both],
                violated: [both],
                blind: [both],
                contradictions: [{ a: both, b: both }],
            }),
            [verdict()]
        );
        const cast = census.rows.find((r) => r.class === "cast");
        expect(cast?.addressable).toBe(0);
    });

    it("keeps a stale verdict in its class and counts it as stale", () => {
        const census = censusByClass(
            report({
                errors: [{ verdictId: "authored:v", error: "no rebuild" }],
            }),
            [verdict()]
        );
        const cast = census.rows.find((r) => r.class === "cast");
        expect(cast?.verdicts).toBe(1);
        expect(cast?.stale).toBe(1);
    });

    it("never double-counts a verdict in the total through `offered`", () => {
        const census = censusByClass(report(), [
            verdict({
                candidates: [
                    candidate("cast-spell"),
                    candidate("declare-attackers"),
                    candidate("pass"),
                ],
            }),
        ]);
        expect(census.totals.verdicts).toBe(1);
    });
});

describe("the census names its collection targets", () => {
    it("lists every class under the evidence floor, absent ones included", () => {
        const census = censusByClass(
            report({ pairs: [pair("cast-spell", "pass")] }),
            [verdict()]
        );
        const below = classesBelowFloor(census);
        const names = below.map((b) => b.class);
        expect(names).toContain("declare-blockers");
        expect(names).toContain("cast");
        expect(below.find((b) => b.class === "declare-blockers")?.pairs).toBe(
            0
        );
    });

    it("excludes `pass`, which is never a collection target of its own", () => {
        const census = censusByClass(report(), []);
        expect(classesBelowFloor(census).map((b) => b.class)).not.toContain(
            "pass"
        );
    });

    it("prints the table and the shopping list together", () => {
        const text = formatCensus(
            censusByClass(report({ pairs: [pair("cast-spell", "pass")] }), [
                verdict(),
            ])
        );
        expect(text).toContain("class");
        expect(text).toContain("TOTAL");
        expect(text).toContain(`${CLASS_EVIDENCE_FLOOR}-pair evidence floor`);
        expect(text).toContain("declare-blockers");
    });
});
