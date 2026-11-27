// The generated vector (ADR 0186, Decision 1; issue #10853): the Evaluation's
// second set of inputs, counted from what card definitions and the board
// declare instead of written by hand, and how far the seat's own list is
// from what its cards require (`deckNeeds.ts`). The Evaluation reads it as a
// correction priced by a weight table (`correction.ts`), and only when a
// search variant hands it one: the committed table is empty, and the
// Evaluation the Bot plays with carries none (`committedWeights.ts`).
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
export {
    GENERATED_COLUMN_WEIGHTS,
    type GeneratedWeights,
} from "./committedWeights";
export { generatedCorrection, type GeneratedCorrection } from "./correction";
export { requirementShapes, type RequirementShape } from "./deckNeeds";
export { generatedVector } from "./generate";
export {
    countOf,
    namedEntries,
    subtractVectors,
    type GeneratedVector,
} from "./vector";
