// SNC set barrel — re-exports every colour module so the registry's
// `import * as snc from "./sets/snc/index.cards"` resolves here (ADR 0043).
// blue.ts ships Ledger Shredder (issue #1343).

export * from "./colorless.cards";
export * from "./blue.cards";
