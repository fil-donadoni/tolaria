// The root-rule moratorium (issue #3399, PRD #3397, ADR 0124 §5).
//
// Three instruments, one purpose: make "does this root rule earn its place?"
// a measurement rather than a memory.
//
//   1. the FROZEN mechanism union + its allowlist — a fourteenth rule cannot
//      be added without a row naming the issue that proves it necessary;
//   2. `flipped` — did the mechanism attributed actually CHANGE the pick;
//   3. `disabledRootRules` — turn one rule off and re-run the blade tier.
//
// Nothing here changes a decision with the knob at its default.
import { describe, expect, it } from "vitest";
import {
    ROOT_DECISION_MECHANISMS,
    ROOT_RULE_ALLOWLIST,
    isDisableableRootRule,
    setRootDecisionSink,
    summarizeRootDecisions,
    type RootDecisionMechanism,
    type RootDecisionRecord,
} from "../decisionTelemetry";
import {
    EMPTY_DISABLED_RULES,
    NO_RULE_VARIANT_PREFIX,
    noRuleVariant,
    resolveDisabledRootRules,
} from "../searchVariant";
import { selectRootMove, type Edge, type Node } from "../../search";
import type { Move } from "../../moves";

// ---------------------------------------------------------------------------
// 1. The frozen union
// ---------------------------------------------------------------------------

describe("RootDecisionMechanism is frozen behind an allowlist (issue #3399)", () => {
    it("every mechanism carries an allowlist row, and every row a mechanism", () => {
        // Both directions. `Record<RootDecisionMechanism, …>` already reds in
        // `tsc` on a missing row, but vitest transpiles rather than
        // typechecks, so a new member reaching the runtime with no row has to
        // red HERE too — that is what makes this a guard and not a comment.
        expect([...ROOT_DECISION_MECHANISMS].sort()).toEqual(
            Object.keys(ROOT_RULE_ALLOWLIST).sort()
        );
    });

    it("every row names a real issue number", () => {
        for (const m of ROOT_DECISION_MECHANISMS) {
            const row = ROOT_RULE_ALLOWLIST[m];
            expect(
                Number.isInteger(row.issue) && row.issue > 0,
                `${m}: allowlist row must name the issue whose body records its justification`
            ).toBe(true);
            expect(
                row.why.length,
                `${m}: allowlist row needs a why`
            ).toBeGreaterThan(20);
        }
    });

    it("exactly two mechanisms are structural — the rest are disableable rules", () => {
        // The search's own selection is not a rule and cannot be turned off:
        // with no argmax there is no pick at all.
        const structural = ROOT_DECISION_MECHANISMS.filter(
            (m) => !isDisableableRootRule(m)
        );
        expect([...structural]).toEqual(["mean-reward", "material-tiebreak"]);
    });

    it("`namedRuleShare` counts every rule, including the newest", () => {
        // Regression on the drift the derived list closed: `resolved-payoff`
        // (issue #3388) was a named rule the hand-maintained `NAMED_RULES`
        // literal never listed, so it counted as unnamed from the day it
        // shipped.
        const s = summarizeRootDecisions([
            recordWith({ mechanism: "resolved-payoff" }),
        ]);
        expect(s.namedRuleShare).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 2. `flipped`
// ---------------------------------------------------------------------------

const PASS: Move = { kind: "pass" };
const LAND: Move = { kind: "play-land", cardInstanceId: "forest" };
// A cast is the neutral partner for the two structural cases below: with no
// root state, NO named rule can fire on a `pass`-vs-cast pair (the land-drop
// rescue is the only rule reachable without one, and it needs a `play-land`
// edge), so what the record attributes is the search's own selection alone.
const SPELL = {
    kind: "cast-spell",
    cardInstanceId: "bolt",
    targets: [],
    manaPayment: {},
} as unknown as Move;

/** A synthetic root whose edges carry the given mean reward and mean margin at
 *  a fixed visit count — the same shape `search.bot.test.ts` uses, so a
 *  decision here is the real `selectRootMove` on hand-set numbers. */
function rootOf(
    edges: { move: Move; meanReward: number; meanMargin: number }[]
): Node {
    const children = new Map<string, Edge>();
    edges.forEach((e, i) => {
        const visits = 100;
        children.set(`${e.move.kind}:${i}`, {
            move: e.move,
            key: `${e.move.kind}:${i}`,
            mover: "p1",
            node: { children: new Map() },
            visits,
            totalReward: e.meanReward * visits,
            totalMargin: e.meanMargin * visits,
            avail: visits,
        });
    });
    return { children };
}

/** Run `selectRootMove` with a telemetry-shaped capture of the one record it
 *  emits. `out` carries the mechanism; the record carries `flipped`. */
function decide(
    root: Node,
    moves: Move[],
    disabled?: RootDecisionMechanism[]
): { kind: string; mechanism: RootDecisionMechanism; flipped: boolean } {
    const records: RootDecisionRecord[] = [];
    const out: { mechanism: RootDecisionMechanism } = {
        mechanism: "mean-reward",
    };
    setRootDecisionSink((r) => records.push(r));
    try {
        const move = selectRootMove(
            root,
            moves,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            out,
            undefined,
            disabled ? new Set(disabled) : EMPTY_DISABLED_RULES
        );
        expect(records).toHaveLength(1);
        return {
            kind: move.kind,
            mechanism: out.mechanism,
            flipped: records[0].flipped,
        };
    } finally {
        setRootDecisionSink(null);
    }
}

function recordWith(over: Partial<RootDecisionRecord>): RootDecisionRecord {
    return {
        phase: "PRECOMBAT_MAIN",
        moveKind: "pass",
        choiceNode: false,
        poolSize: 2,
        exploredSize: 2,
        contenderCount: 1,
        bestMean: 0.5,
        chosenMean: 0.5,
        gapReward: null,
        gapMarginPoints: null,
        chosenDeficitReward: 0,
        mechanism: "mean-reward",
        flipped: false,
        pickIsMeanArgmax: true,
        ...over,
    };
}

describe("`flipped` says whether the attributed mechanism decided (issue #3399)", () => {
    it("mean-reward never flips — there is no stage before the argmax", () => {
        // The land wins outright (beyond OUTCOME_EPS), so it is the lone
        // contender and no tie-break is consulted at all.
        const d = decide(
            rootOf([
                { move: LAND, meanReward: 0.8, meanMargin: 300 },
                { move: PASS, meanReward: 0.66, meanMargin: 350 },
            ]),
            [LAND, PASS]
        );
        expect(d.mechanism).toBe("mean-reward");
        expect(d.flipped).toBe(false);
    });

    it("the material tie-break CONFIRMS when the reward stage had no opinion", () => {
        // Two edges at the IDENTICAL mean reward: the margin ranking picks
        // between them, but it traded nothing away — the pick is still a
        // mean-reward argmax. Calling that a flip would count the order the
        // pool happened to be built in.
        const d = decide(
            rootOf([
                { move: PASS, meanReward: 0.66, meanMargin: 350 },
                { move: SPELL, meanReward: 0.66, meanMargin: 300 },
            ]),
            [PASS, SPELL]
        );
        expect(d.mechanism).toBe("material-tiebreak");
        expect(d.kind).toBe("pass");
        expect(d.flipped).toBe(false);
    });

    it("the material tie-break FLIPS when it trades reward away for margin", () => {
        // `pass` is the strict mean-reward argmax; the margin ranking takes a
        // strictly lower-reward edge inside the OUTCOME_EPS window.
        const d = decide(
            rootOf([
                { move: PASS, meanReward: 0.665, meanMargin: 300 },
                { move: SPELL, meanReward: 0.664, meanMargin: 350 },
            ]),
            [PASS, SPELL]
        );
        expect(d.mechanism).toBe("material-tiebreak");
        expect(d.kind).toBe("cast-spell");
        expect(d.flipped).toBe(true);
    });

    it("a named rule that OVERRIDES the running pick reports a flip", () => {
        // The land-drop rescue (`free-development`, ADR 0020 §1): `pass` wins
        // the material tie-break on noise, the outcome-equal land drop is
        // pulled from the full pool and takes the pick.
        const d = decide(
            rootOf([
                { move: PASS, meanReward: 0.6635, meanMargin: 330 },
                { move: LAND, meanReward: 0.6633, meanMargin: 327 },
            ]),
            [PASS, LAND]
        );
        expect(d.mechanism).toBe("free-development");
        expect(d.kind).toBe("play-land");
        expect(d.flipped).toBe(true);
    });

    it("no named rule is ever attributed without moving the pick", () => {
        // The invariant `flipped` exists to KEEP, stated as a test rather than
        // left to construction. Every named rule today either mutates the
        // running pick under an explicit `best !== prev` guard, or returns an
        // edge of a different move kind — so an attribution IS a flip. A
        // fourteenth rule that re-selected what the stage before it already
        // held would confirm, not decide, and this reds.
        const cases: { root: Node; moves: Move[] }[] = [
            {
                root: rootOf([
                    { move: PASS, meanReward: 0.6635, meanMargin: 330 },
                    { move: LAND, meanReward: 0.6633, meanMargin: 327 },
                ]),
                moves: [PASS, LAND],
            },
        ];
        for (const c of cases) {
            const d = decide(c.root, c.moves);
            if (isDisableableRootRule(d.mechanism)) {
                expect(
                    d.flipped,
                    `${d.mechanism} attributed a confirmation`
                ).toBe(true);
            }
        }
    });

    it("summarizeRootDecisions reports flips per mechanism", () => {
        const s = summarizeRootDecisions([
            recordWith({ mechanism: "free-development", flipped: true }),
            recordWith({ mechanism: "free-development", flipped: true }),
            recordWith({ mechanism: "material-tiebreak", flipped: false }),
            recordWith({ mechanism: "mean-reward", flipped: false }),
        ]);
        expect(s.flipsByMechanism["free-development"]).toEqual({
            flipped: 2,
            total: 2,
        });
        expect(s.flipsByMechanism["material-tiebreak"]).toEqual({
            flipped: 0,
            total: 1,
        });
        expect(s.flippedShare).toBeCloseTo(0.5);
    });
});

// ---------------------------------------------------------------------------
// 3. `disabledRootRules`
// ---------------------------------------------------------------------------

describe("disabledRootRules makes a named rule a no-op (issue #3399)", () => {
    it("the land-drop rescue disappears and the pick falls through to the stage before it", () => {
        // Same root as the FIRE case above. With `free-development` off the
        // pick is the material tie-break's `pass` — the rule is a no-op, not a
        // different rule, which is what "is it inert?" has to measure.
        const root = () =>
            rootOf([
                { move: PASS, meanReward: 0.6635, meanMargin: 330 },
                { move: LAND, meanReward: 0.6633, meanMargin: 327 },
            ]);
        expect(decide(root(), [PASS, LAND]).kind).toBe("play-land");

        const off = decide(root(), [PASS, LAND], ["free-development"]);
        expect(off.kind).toBe("pass");
        expect(off.mechanism).toBe("material-tiebreak");
        expect(off.flipped).toBe(false);
    });

    it("disabling an UNRELATED rule changes nothing", () => {
        const off = decide(
            rootOf([
                { move: PASS, meanReward: 0.6635, meanMargin: 330 },
                { move: LAND, meanReward: 0.6633, meanMargin: 327 },
            ]),
            [PASS, LAND],
            ["hold-trick", "block-quality"]
        );
        expect(off.kind).toBe("play-land");
        expect(off.mechanism).toBe("free-development");
    });

    it("resolves to the empty set for live play and every variant that does not ask", () => {
        expect(resolveDisabledRootRules(null).size).toBe(0);
        expect(
            resolveDisabledRootRules({ name: "x", disabledRootRules: [] }).size
        ).toBe(0);
        expect([
            ...resolveDisabledRootRules({
                name: "x",
                disabledRootRules: ["hold-trick"],
            }),
        ]).toEqual(["hold-trick"]);
    });

    it("throws on a structural mechanism and on a name that is not one at all", () => {
        // Fail-loud, the rule `BLADE_VARIANT` already follows: a knob that
        // silently disabled nothing would make "`must` is green without rule
        // X" a statement about a typo.
        expect(() =>
            resolveDisabledRootRules({
                name: "x",
                disabledRootRules: ["mean-reward"],
            })
        ).toThrow(/structural/);
        expect(() =>
            resolveDisabledRootRules({
                name: "x",
                disabledRootRules: ["hold-the-trick" as RootDecisionMechanism],
            })
        ).toThrow(/not a RootDecisionMechanism/);
    });

    it("BLADE_VARIANT=no-rule:<mechanism> builds the variant the blade suite installs", () => {
        const v = noRuleVariant(`${NO_RULE_VARIANT_PREFIX}hold-trick`);
        expect(v.disabledRootRules).toEqual(["hold-trick"]);
        expect(v.name).toBe("no-rule:hold-trick");

        const two = noRuleVariant(
            `${NO_RULE_VARIANT_PREFIX}hold-trick, free-development`
        );
        expect(two.disabledRootRules).toEqual([
            "hold-trick",
            "free-development",
        ]);

        expect(() => noRuleVariant(NO_RULE_VARIANT_PREFIX)).toThrow(
            /names no rule/
        );
        expect(() =>
            noRuleVariant(`${NO_RULE_VARIANT_PREFIX}material-tiebreak`)
        ).toThrow(/structural/);
    });
});
