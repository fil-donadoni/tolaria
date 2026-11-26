// TRK set barrel — re-exports every colour module so the registry's
// `import * as trk from "./sets/trk/index.cards"` resolves here (ADR 0043).
// Only colorless.ts exists so far (Deep Space 9, issue #10552).

export * from "./colorless.cards";
