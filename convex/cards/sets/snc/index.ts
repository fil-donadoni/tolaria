// SNC set barrel — re-exports every colour module so the registry's
// `import * as snc from "./sets/snc"` resolves here unchanged (ADR 0043).
// blue.ts is currently stub-only (Ledger Shredder, tracked-by #1343).

export * from "./colorless";
export * from "./blue";
