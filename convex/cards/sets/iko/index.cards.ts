// IKO set barrel — re-exports every colour module so the registry's
// `import * as iko from "./sets/iko/index.cards"` resolves here (ADR 0043).

export * from "./colorless.cards";
export * from "./multicolor.cards";
