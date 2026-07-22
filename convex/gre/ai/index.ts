// Per-Op value model — the DSL semantic layer (PRD #1423, issue #1426). One
// source, read by three consumers named in the PRD: `cardValue` (card
// valuation), the choice-node `priorFor` seam, and the rollout choice policy.
// This barrel is the module's public surface.

export * from "./featureBasis";
export * from "./grounding";
export * from "./opValuers";
export * from "./cardScriptValue";
// Choice-node spine (PRD #1423, issue #1425): the per-kind candidate-generator
// registry and the pluggable `priorFor` ordering seam the search reads at a
// live `PendingChoice`.
export * from "./choicePriors";
export * from "./choiceCandidates";
