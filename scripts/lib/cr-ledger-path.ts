/**
 * Where the CR citation ledger (ADR 0133) lives — a leaf, so a module that
 * needs only the path (the artefact registry, and through it the queue
 * planner) does not drag `cr-ledger.ts` and its rule reader into every
 * program that imports it (issue #6648: the convex type-check reaches the
 * planner through `backlog-triage`).
 */
export const LEDGER_PATH = "data/cr/citations-ledger.json";
