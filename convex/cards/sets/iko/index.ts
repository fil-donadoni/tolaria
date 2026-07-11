// IKO set barrel — re-exports every colour module so the registry's
// `import * as iko from "./sets/iko"` resolves here unchanged (ADR 0043).
// Only the colorless module (the five Triomes) is populated so far.

export * from "./colorless";
