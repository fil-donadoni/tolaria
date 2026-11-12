// Issue #9095 — the Saturation Prior of in-tree selection.
//
// Past the reward clip every child of a node scores the same mean reward, so
// UCB1 spreads the visits evenly: a root move with eight continuations reads
// each through an eighth of its visits, one with two through a half, and the
// subtree mean margin the root `material-tiebreak` reads prefers the move
// with FEWER continuations. At a saturated declaration node the prior ranks
// the children by their one-ply policy value, so the visits deepen the line
// the Bot would play.
//
// Three layers: the term on hand-built edges (how much each child earns),
// the gate (which node earns it), then the REAL search on the Caustic Bronco
// twin, where the prior is what turns `pass` from losing on every seed into
// the pick.
import { afterEach, describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import {
    saturationPriorTerms,
    searchWithTrace,
    selectionSaturationPrior,
    type CandidateTrace,
    type Edge,
    type KeyedMove,
} from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { LADDER_VARIANTS, setSearchVariant } from "../searchVariant";

/** An opened edge keyed `key`, with `visits` visits and mean reward `reward`.
 *  Only the statistics the prior reads are real. */
function edge(key: string, visits: number, reward: number): Edge {
    return {
        move: { kind: "pass" },
        key,
        mover: "bot",
        node: { children: new Map() },
        visits,
        totalReward: reward * visits,
        totalMargin: 0,
        avail: visits,
    };
}

const W = DEFAULT_EVAL_WEIGHTS;
const CLIP = 0.75;

describe("saturationPriorTerms (issue #9095)", () => {
    it("spans a saturated node linearly by one-ply policy value, from 0 to saturationPriorC", () => {
        const low = edge("low", 40, CLIP);
        const mid = edge("mid", 20, CLIP);
        const high = edge("high", 5, CLIP);
        const values = new Map([
            ["low", 600],
            ["mid", 650],
            ["high", 700],
        ]);
        const terms = saturationPriorTerms([low, mid, high], values, W)!;
        expect(terms.get(low)).toBe(0);
        expect(terms.get(mid)).toBeCloseTo(W.saturationPriorC / 2, 12);
        expect(terms.get(high)).toBe(W.saturationPriorC);
    });

    it("is null as soon as two children's rewards differ, however slightly", () => {
        const values = new Map([
            ["a", 600],
            ["b", 700],
        ]);
        const a = edge("a", 10, CLIP);
        expect(
            saturationPriorTerms([a, edge("b", 10, CLIP)], values, W)
        ).not.toBeNull();
        expect(
            saturationPriorTerms([a, edge("b", 10, CLIP - 0.001)], values, W)
        ).toBeNull();
    });

    it("is null when a child is unopened, unvisited or has no policy value", () => {
        const a = edge("a", 10, CLIP);
        const b = edge("b", 10, CLIP);
        const values = new Map([
            ["a", 600],
            ["b", 700],
        ]);
        expect(saturationPriorTerms([a, undefined], values, W)).toBeNull();
        expect(
            saturationPriorTerms([a, edge("b", 0, 0)], values, W)
        ).toBeNull();
        expect(
            saturationPriorTerms([a, b], new Map([["a", 600]]), W)
        ).toBeNull();
        expect(saturationPriorTerms([a, b], undefined, W)).toBeNull();
    });

    it("is null when the policy values are all equal, on a lone child, or when off", () => {
        const a = edge("a", 10, CLIP);
        const b = edge("b", 10, CLIP);
        const flat = new Map([
            ["a", 650],
            ["b", 650],
        ]);
        const values = new Map([
            ["a", 600],
            ["b", 700],
        ]);
        expect(saturationPriorTerms([a, b], flat, W)).toBeNull();
        // A rounding error apart is the same value, not a ranking.
        const rounding = new Map([
            ["a", 650],
            ["b", 650 + 1e-13],
        ]);
        expect(saturationPriorTerms([a, b], rounding, W)).toBeNull();
        expect(saturationPriorTerms([a], values, W)).toBeNull();
        expect(
            saturationPriorTerms([a, b], values, { ...W, saturationPriorC: 0 })
        ).toBeNull();
    });
});

describe("selectionSaturationPrior (issue #9095)", () => {
    const attack: KeyedMove = {
        move: { kind: "declare-attackers", attackerIds: ["a"] },
        key: "attack",
        prior: 0,
    };
    const hold: KeyedMove = {
        move: { kind: "declare-attackers", attackerIds: [] },
        key: "hold",
        prior: 0,
    };
    const pass: KeyedMove = { move: { kind: "pass" }, key: "pass", prior: 0 };
    const children = new Map([
        ["attack", edge("attack", 10, CLIP)],
        ["hold", edge("hold", 10, CLIP)],
        ["pass", edge("pass", 10, CLIP)],
    ]);
    const values = new Map([
        ["attack", 700],
        ["hold", 600],
        ["pass", 650],
    ]);

    it("ranks a saturated declaration of the bot's below the root", () => {
        const terms = selectionSaturationPrior(
            [attack, hold],
            children,
            values,
            W,
            false,
            true
        )!;
        expect(terms.get(children.get("attack")!)).toBe(W.saturationPriorC);
        expect(terms.get(children.get("hold")!)).toBe(0);
    });

    it("leaves a priority window alone: `pass` among the moves", () => {
        expect(
            selectionSaturationPrior(
                [attack, hold, pass],
                children,
                values,
                W,
                false,
                true
            )
        ).toBeNull();
    });

    it("leaves the root and the opponent's nodes alone", () => {
        const at = (atRoot: boolean, botNode: boolean) =>
            selectionSaturationPrior(
                [attack, hold],
                children,
                values,
                W,
                atRoot,
                botNode
            );
        expect(at(true, true)).toBeNull();
        expect(at(false, false)).toBeNull();
    });
});

// CR 702.171a/b — the Bronco twin: saddling taps both Bears for a drain worth
// 2 life against the 4 damage they would deal. Both root moves sit past the
// reward clip, so the pick is the `material-tiebreak`'s subtree mean margin.
const TWIN =
    "attacks with the saddlers rather than saddle its Mount when their damage outweighs the drain";
const SEED = 1;

function twinRoot(): { chosen: string; byLabel: Map<string, CandidateTrace> } {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === TWIN);
    if (!scenario) throw new Error(`registry lost the entry: ${TWIN}`);
    const state = buildBladeState(scenario);
    const bot = seatPlayerId(state, scenario.bot);
    const { trace } = searchWithTrace(
        state,
        bot,
        { iterations: scenario.budget.iterations },
        SEED
    );
    if (!trace) throw new Error("search returned no trace");
    return {
        chosen: trace.chosen,
        byLabel: new Map(trace.candidates.map((c) => [c.label, c])),
    };
}

describe("the Saturation Prior through the real search (issue #9095)", () => {
    afterEach(() => setSearchVariant(null));

    it("reads the full swing's line above the saddle's and passes", () => {
        const { chosen, byLabel } = twinRoot();
        const pass = byLabel.get("pass")!;
        const saddle = [...byLabel.values()].find((c) => c !== pass)!;
        expect(pass.meanReward).toBe(saddle.meanReward);
        expect(pass.meanMargin).toBeGreaterThan(saddle.meanMargin);
        expect(chosen).toBe("pass");
    });

    it("without the prior the even spread dilutes `pass` and the saddle wins", () => {
        setSearchVariant(LADDER_VARIANTS["no-saturation-prior"]);
        const { chosen } = twinRoot();
        expect(chosen).not.toBe("pass");
    });
});
