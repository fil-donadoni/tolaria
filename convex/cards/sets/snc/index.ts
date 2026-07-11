// SNC set barrel — re-exports every colour module so the registry's
// `import * as snc from "./sets/snc"` resolves here unchanged (ADR 0043).
// Only the colorless module (the five Triomes) is populated so far.

export * from "./colorless";
