// LEB set barrel — re-exports every colour module so the registry's
// `import * as leb from "./sets/leb/index.cards"` resolves here (ADR 0043).

export * from "./white.cards";
export * from "./multicolor.cards";
export * from "./colorless.cards";
