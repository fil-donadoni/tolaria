// The COMMITTED weight table of the generated columns (ADR 0186, Decision 1;
// issue #10862) — a generated, static artefact, as the fitted weights of the
// hand-written terms are (`../fittedEvalWeights.ts`).
//
// Column NAME → weight. A name is the identity of a column; its index moves
// whenever a registry row is added (`columns.ts`), so nothing kept in git is
// keyed by index. A column that is not listed has weight zero.
//
// IT SHIPS EMPTY: every weight is zero, and the correction it prices is zero
// on every position. Only a search variant reads it (`generated-vector`,
// `../searchVariant.ts`); the Evaluation the Bot plays with carries no table
// and never reads the generated vector.
//
// EDIT IT BY FITTING, NEVER BY HAND. The guard in
// `__tests__/generatedCorrection.bot.test.ts` reds on any weight that moves
// the Evaluation of a `must` position.
//
// No imports, on purpose: `searchVariant.ts` reads this file and must not
// pull the registries the column list is built from.

/** Column name → weight. Absent = zero. */
export type GeneratedWeights = Readonly<Record<string, number>>;

export const GENERATED_COLUMN_WEIGHTS: GeneratedWeights = Object.freeze({});
