// IKO set barrel — re-exports every colour module so the registry's
// `import * as iko from "./sets/iko"` resolves here unchanged (ADR 0043).

export * from "./colorless";
export * from "./multicolor";
