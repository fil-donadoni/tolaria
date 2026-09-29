// PIP set barrel — re-exports every colour module so the
// registry's `import * as pip from "./sets/pip/index.cards"` resolves here
// unchanged (ADR 0043).

export * from "./white.cards";
export * from "./blue.cards";
export * from "./black.cards";
export * from "./red.cards";
export * from "./green.cards";
export * from "./multicolor.cards";
export * from "./colorless.cards";
