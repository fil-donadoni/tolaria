// The generated vector (ADR 0186, Decision 1; issue #10853): the Evaluation's
// second set of inputs, counted from what card definitions and the board
// declare instead of written by hand, and how far the seat's own list is
// from what its cards require (`deckNeeds.ts`). Nothing reads it yet — no
// weight, no fit, no change to the Bot.
//
// `candidate.ts` (the vector of one candidate move, through the Eval Pair
// probe) is deliberately NOT re-exported: it reaches the search, and this
// barrel stays what a leaf evaluation could afford to import.

export {
    CARRIERS,
    COUNT_ZONES,
    MANA_SYMBOLS,
    MANA_UNIT_KINDS,
    NEED_MEASURES,
    NEED_SIDES,
    READ_ZONES,
    SIDES,
    generatedColumnFamilies,
    generatedColumnIndex,
    generatedColumns,
    type Carrier,
    type ColumnFamily,
    type CountZone,
    type NeedMeasure,
    type ReadZone,
    type Side,
} from "./columns";
export { requirementShapes, type RequirementShape } from "./deckNeeds";
export { generatedVector } from "./generate";
export {
    countOf,
    namedEntries,
    subtractVectors,
    type GeneratedVector,
} from "./vector";
