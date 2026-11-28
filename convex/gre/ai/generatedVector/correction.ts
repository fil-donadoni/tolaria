// The generated vector's CORRECTION to the Evaluation (ADR 0186, Decision 1;
// issue #10862): a weight table times the vector of one position, split by
// the side each column counts for.
//
// WHAT A WEIGHT MEANS. A column counts something on one side of the table —
// the seat the vector is read for (`self`) or everybody else (`opp`). Its
// weight is what ONE UNIT of that count is worth, in margin points, TO THE
// SIDE IT IS COUNTED ON. That is the convention of every hand-written term:
// a term is worth something to the player it belongs to, and the Evaluation
// is the reader's total minus the opponent's. So the weight of `life.opp` is
// positive when life is good for whoever has it, exactly as `life.self` is,
// and the opponent's half is subtracted where every other term's is.
//
// The vector is read ONCE, for the seat the Evaluation is asked for. The
// opponent's half is what that seat can see of the other side (`generate.ts`
// § What the seat may read), never a second vector read from the opponent's
// chair: that one would read the cards the search sampled into its hand.
//
// A FULL RECOMPUTE per call: the position is walked again each time and
// nothing is carried from one position to the next. The walk prices each
// count as it meets it (`pricedGeneratedVector`), so no vector is built.

import type { ManaCensusMemo } from "../../manaCensusMemo";
import type { GameState } from "../../state";
import { columnLayout, type Side } from "./columns";
import type { GeneratedWeights } from "./committedWeights";
import { pricedGeneratedVector, type ColumnPricing } from "./generate";

const OPP: Side = "opp";

let columnSides: Uint8Array | undefined;

/** The side each column counts for, by column index: 1 for `opp`, 0 for
 *  `self`. Every family's LAST axis is its side axis (`columns.ts`): the two
 *  sides, or `self` alone for a family read for the seat only. The Weight
 *  Fit reads it to know which way a column's weight moves the margin. */
export function sideOfColumns(): Uint8Array {
    if (columnSides) return columnSides;
    const layout = columnLayout();
    const out = new Uint8Array(layout.names.length);
    const families = Object.values(layout.families);
    for (let f = 0; f < families.length; f++) {
        const { family, base, size } = families[f];
        const sides = family.axes[family.axes.length - 1];
        for (let i = 0; i < size; i++) {
            out[base + i] = sides[i % sides.length] === OPP ? 1 : 0;
        }
    }
    columnSides = out;
    return out;
}

/** Compiled tables, by table object: a table is static data, read at every
 *  evaluation of a search, and compiled the first time it is seen. So a table
 *  is read ONCE: changing a weight in an object already handed to an
 *  evaluation changes nothing — a different table is a different object. */
const compiledTables = new WeakMap<GeneratedWeights, ColumnPricing>();

/** `table` over this build's columns. Throws on a name that is no column and
 *  on a weight that is not a finite number: a table is keyed by name so that
 *  it survives a column being added, and a name that no longer resolves is a
 *  table fitted against another column list, never a weight to drop. */
function compiled(table: GeneratedWeights): ColumnPricing {
    const cached = compiledTables.get(table);
    if (cached) return cached;
    const layout = columnLayout();
    const weights = new Float64Array(layout.names.length);
    const names = Object.keys(table);
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const column = layout.indexByName.get(name);
        if (column === undefined) {
            throw new Error(`generated weights: no column named "${name}"`);
        }
        const weight = table[name];
        if (!Number.isFinite(weight)) {
            throw new Error(
                `generated weights: "${name}" is not a finite number`
            );
        }
        weights[column] = weight;
    }
    const out = { weights, side: sideOfColumns() };
    compiledTables.set(table, out);
    return out;
}

/** What the generated columns are worth to each side of one position. */
export type GeneratedCorrection = {
    /** To the seat the position is read for. */
    readonly self: number;
    /** To everybody else. */
    readonly opp: number;
};

/**
 * The correction `table` prices on `state`, read for the seat `seatId`: the
 * weighted sum of the generated vector's `self` columns, and of its `opp`
 * columns. The Evaluation adds each to that side's total, so the margin moves
 * by `self − opp`.
 *
 * Pure. `memo` is the mana census memo of the evaluation that asks: the
 * vector's mana columns and the evaluation's own terms then walk each seat's
 * sources once between them.
 */
export function generatedCorrection(
    state: GameState,
    seatId: string,
    table: GeneratedWeights,
    memo?: ManaCensusMemo
): GeneratedCorrection {
    return pricedGeneratedVector(state, seatId, compiled(table), memo);
}
