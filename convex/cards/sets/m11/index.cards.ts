// M11 set barrel — re-exports every colour module so the
// registry's `import * as m11 from "./sets/m11/index.cards"` resolves here
// unchanged (ADR 0043).

export * from "./blue.cards";
export * from "./green.cards";
export * from "./multicolor.cards";
export * from "./colorless.cards";
