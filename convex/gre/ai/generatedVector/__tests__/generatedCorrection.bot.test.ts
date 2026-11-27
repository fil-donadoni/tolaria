// The generated vector's correction to the Evaluation (ADR 0186, Decision 1;
// issue #10862).
//
// Three things are pinned here:
//
//   1. THE ZERO GUARD. With the committed weight table — which ships empty —
//      the Evaluation is today's on every position of the `must` tier, from
//      both seats, term by term. The whole tier's PICKS under the same table
//      are `BLADE_VARIANT=generated-vector bun run test:blade`; a sample of
//      it is compared here on the full search trace, visit counts included.
//   2. THE SEAM. A table with one weight moves the Evaluation by that weight
//      times the column's count, on the side the column counts for, and the
//      breakdown reports it as the `generated` term.
//   3. THE REACH. A table arrives through a search variant and through
//      nothing else: the committed weights carry none.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../../cards/__tests__/setup.helper";
import {
    grizzlyBears,
    lightningBolt,
} from "../../../../cards/sets/lea/index.cards";
import {
    evaluate,
    evaluateBreakdown,
    evaluateWithMargin,
    materialMargin,
} from "../../../evaluate";
import { searchWithTrace } from "../../../search";
import type { GameState } from "../../../state";
import { buildBladeState } from "../../blade/build";
import { seatPlayerId } from "../../blade/matcher";
import { bladeScenariosForTier } from "../../blade/registry";
import { DEFAULT_BLADE_SEED } from "../../blade/runner";
import { resolveBladeVariant } from "../../blade/variant";
import {
    DEFAULT_EVAL_WEIGHTS,
    FIT_BASE_EVAL_WEIGHTS,
    type EvalWeights,
} from "../../evalWeights";
import {
    LADDER_VARIANTS,
    resolveEvalWeights,
    setSearchVariant,
    type SearchVariant,
} from "../../searchVariant";
import {
    GENERATED_COLUMN_WEIGHTS,
    countOf,
    generatedColumns,
    generatedCorrection,
    generatedVector,
    type GeneratedWeights,
} from "..";

const VARIANT = LADDER_VARIANTS["generated-vector"];

/** The committed weights with `table` as their generated weight table. */
function withTable(table: GeneratedWeights): EvalWeights {
    return { ...DEFAULT_EVAL_WEIGHTS, generatedWeights: table };
}

function under<T>(variant: SearchVariant | null, run: () => T): T {
    setSearchVariant(variant);
    try {
        return run();
    } finally {
        setSearchVariant(null);
    }
}

/** A search's trace with its wall-clock fields removed: everything else is a
 *  pure function of the position, the seed and the iteration budget. */
function deterministicPart(result: ReturnType<typeof searchWithTrace>): string {
    return JSON.stringify(result, (key, value: unknown) =>
        key.endsWith("Ms") ? undefined : value
    );
}

/** P1 holds a Lightning Bolt and controls a Grizzly Bears; P2 controls two
 *  Grizzly Bears. Life 20 and 17. */
function board(): GameState {
    const p1 = makePlayer("p1");
    const p2 = makePlayer("p2");
    p1.life = 20;
    p2.life = 17;
    p1.hand.push(
        makeInstance(lightningBolt().id, { controllerId: "p1", zone: "hand" })
    );
    p1.battlefield.push(
        makeInstance(grizzlyBears().id, { controllerId: "p1" })
    );
    p2.battlefield.push(
        makeInstance(grizzlyBears().id, { controllerId: "p2" })
    );
    p2.battlefield.push(
        makeInstance(grizzlyBears().id, { controllerId: "p2" })
    );
    return makeState({ players: [p1, p2] });
}

describe("generated correction — the committed table leaves the Evaluation as it is (issue #10862)", () => {
    const arm = resolveEvalWeights(VARIANT);
    const must = bladeScenariosForTier("must");

    it("on every `must` position, from both seats: value, margin and every term", () => {
        expect(must.length).toBeGreaterThan(100);
        const moved: string[] = [];
        let nonEmptyVectors = 0;
        for (const scenario of must) {
            const state = buildBladeState(scenario);
            for (const player of state.players) {
                const seat = player.id;
                if (generatedVector(state, seat).columns.length > 0) {
                    nonEmptyVectors++;
                }
                const base = evaluateBreakdown(state, seat);
                const read = evaluateBreakdown(state, seat, arm);
                const same =
                    JSON.stringify(read) === JSON.stringify(base) &&
                    read.self.generated === 0 &&
                    read.opp.generated === 0 &&
                    evaluate(state, seat, arm) === evaluate(state, seat) &&
                    materialMargin(state, seat, arm) ===
                        materialMargin(state, seat);
                if (!same) moved.push(`${scenario.label} [${seat}]`);
            }
        }
        expect(moved).toEqual([]);
        // The arm read a vector on every one of them: the equality above is
        // a zero table over real counts, never an unread vector.
        expect(nonEmptyVectors).toBe(must.length * 2);
    });

    // The whole tier's picks are `BLADE_VARIANT=generated-vector bun run
    // test:blade`; this samples it on the full trace.
    const sample = must
        .filter((s) => !s.revisit && !s.setup?.length)
        .filter((_, i) => i % 97 === 0)
        .slice(0, 6);

    it.each(sample.map((s) => [s.label, s] as const))(
        "same pick, visit counts and trace under the variant: %s",
        (_label, scenario) => {
            const run = () => {
                const state = buildBladeState(scenario);
                const botId = seatPlayerId(state, scenario.bot);
                return deterministicPart(
                    searchWithTrace(
                        state,
                        botId,
                        { iterations: scenario.budget.iterations },
                        DEFAULT_BLADE_SEED
                    )
                );
            };
            const base = run();
            expect(under(VARIANT, run)).toBe(base);
        }
    );
});

describe("generated correction — a weight prices its column on the side it counts for", () => {
    it("a `self` column adds weight × count to the reader's total", () => {
        const state = board();
        const count = countOf(generatedVector(state, "p1"), "life.self");
        expect(count).toBe(20);
        const weights = withTable({ "life.self": 0.5 });

        const base = evaluateBreakdown(state, "p1");
        const read = evaluateBreakdown(state, "p1", weights);
        expect(read.self.generated).toBe(10);
        expect(read.opp.generated).toBe(0);
        expect(read.margin).toBe(base.margin + 10);
        expect(read.total).toBe(base.total + 10);
        // Every hand-written term is where it was.
        expect({ ...read.self, generated: 0 }).toEqual(base.self);
        expect(read.opp).toEqual(base.opp);
    });

    it("an `opp` column adds to the OPPONENT's total, so it lowers the margin", () => {
        const state = board();
        const weights = withTable({ "type.Creature.battlefield.opp": 3 });

        const base = evaluateBreakdown(state, "p1");
        const read = evaluateBreakdown(state, "p1", weights);
        expect(read.self.generated).toBe(0);
        expect(read.opp.generated).toBe(6);
        expect(read.margin).toBe(base.margin - 6);

        // Read from the other chair the same two creatures are `self`, and
        // the column is P1's one creature.
        const other = evaluateBreakdown(state, "p2", weights);
        expect(other.opp.generated).toBe(3);
    });

    it("the three readings of one position agree: value, margin, breakdown", () => {
        const state = board();
        const weights = withTable({
            "life.self": 0.5,
            "life.opp": 0.25,
            "op.dealDamage.spell.hand.self": 7,
        });
        const breakdown = evaluateBreakdown(state, "p1", weights);
        expect(breakdown.self.generated).toBe(20 * 0.5 + 7);
        expect(breakdown.opp.generated).toBe(17 * 0.25);
        expect(evaluate(state, "p1", weights)).toBe(breakdown.total);
        expect(materialMargin(state, "p1", weights)).toBe(breakdown.margin);
        expect(evaluateWithMargin(state, "p1", weights)).toEqual({
            value: breakdown.total,
            margin: breakdown.margin,
        });
    });

    it("the two halves are the vector's own counts, split by side", () => {
        const state = board();
        expect(
            generatedCorrection(state, "p1", {
                "cards.battlefield.self": 2,
                "cards.battlefield.opp": 5,
                "need.requirements.self": 100,
            })
        ).toEqual({ self: 2, opp: 10 });
    });

    it("is the vector's dot product with the table, on every `must` position", () => {
        // The correction prices each count as the walk meets it and never
        // builds the vector; this is the vector, built, against the same
        // table. Whole-number weights, so both sums are exact whatever
        // their order. Every column carries one, drawn from its index.
        const names = generatedColumns();
        const weightAt = (column: number) => ((column * 7919) % 13) - 6;
        const table: Record<string, number> = {};
        for (let c = 0; c < names.length; c++) table[names[c]] = weightAt(c);

        const differing: string[] = [];
        let priced = 0;
        for (const scenario of bladeScenariosForTier("must")) {
            const state = buildBladeState(scenario);
            for (const player of state.players) {
                const vector = generatedVector(state, player.id);
                let self = 0;
                let opp = 0;
                for (let i = 0; i < vector.columns.length; i++) {
                    const column = vector.columns[i];
                    const worth = weightAt(column) * vector.counts[i];
                    if (names[column].endsWith(".opp")) opp += worth;
                    else self += worth;
                }
                const read = generatedCorrection(state, player.id, table);
                if (read.self !== self || read.opp !== opp) {
                    differing.push(`${scenario.label} [${player.id}]`);
                }
                if (self !== 0 && opp !== 0) priced++;
            }
        }
        expect(differing).toEqual([]);
        expect(priced).toBeGreaterThan(100);
    });

    it("a name that is no column, or a weight that is no number, throws", () => {
        const state = board();
        expect(() =>
            evaluate(state, "p1", withTable({ "life.mine": 1 }))
        ).toThrow(/no column named "life.mine"/);
        expect(() =>
            evaluate(state, "p1", withTable({ "life.self": Number.NaN }))
        ).toThrow(/"life.self" is not a finite number/);
    });
});

describe("generated correction — a table reaches the Evaluation through a variant only", () => {
    it("the committed weights carry no table", () => {
        expect("generatedWeights" in DEFAULT_EVAL_WEIGHTS).toBe(false);
        expect("generatedWeights" in FIT_BASE_EVAL_WEIGHTS).toBe(false);
        expect(resolveEvalWeights(null)).toBe(DEFAULT_EVAL_WEIGHTS);
    });

    it("the `generated-vector` variant supplies the committed table, by name", () => {
        expect(resolveBladeVariant("generated-vector")).toBe(VARIANT);
        const resolved = resolveEvalWeights(VARIANT);
        expect(resolved.generatedWeights).toBe(GENERATED_COLUMN_WEIGHTS);
        expect({ ...resolved, generatedWeights: undefined }).toEqual({
            ...DEFAULT_EVAL_WEIGHTS,
            generatedWeights: undefined,
        });
    });

    it("resolving a variant leaves the committed weights and the committed table as they were", () => {
        const before = JSON.stringify(DEFAULT_EVAL_WEIGHTS);
        resolveEvalWeights({
            name: "one-weight",
            evalWeights: { generatedWeights: { "life.self": 1 } },
        });
        expect(JSON.stringify(DEFAULT_EVAL_WEIGHTS)).toBe(before);
        expect(Object.isFrozen(GENERATED_COLUMN_WEIGHTS)).toBe(true);
        expect(Object.isFrozen(DEFAULT_EVAL_WEIGHTS)).toBe(true);
    });

    it("a search under a variant with a weight reads it at every candidate; the base search reads none", () => {
        const scenario = must1();
        const run = () => {
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            return searchWithTrace(
                state,
                botId,
                { iterations: 30 },
                DEFAULT_BLADE_SEED
            );
        };
        const priced = under(
            {
                name: "one-weight",
                evalWeights: { generatedWeights: { "life.self": 1 } },
            },
            run
        );
        const base = run();
        const pricedCandidates = priced.trace?.candidates ?? [];
        const baseCandidates = base.trace?.candidates ?? [];
        expect(pricedCandidates.length).toBeGreaterThan(0);
        expect(baseCandidates.length).toBe(pricedCandidates.length);
        for (const candidate of pricedCandidates) {
            expect(candidate.eval.self.generated).toBeGreaterThan(0);
        }
        for (const candidate of baseCandidates) {
            expect(candidate.eval.self.generated).toBe(0);
        }
    });
});

/** The first `must` entry the search can be asked directly: no revisit, no
 *  setup steps. */
function must1() {
    const scenario = bladeScenariosForTier("must").find(
        (s) => !s.revisit && !s.setup?.length
    );
    if (!scenario) throw new Error("no directly searchable `must` entry");
    return scenario;
}
