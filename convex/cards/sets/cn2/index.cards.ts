// CN2 (Conspiracy: Take the Crown) set barrel — re-exports every colour module
// so the registry's `import * as cn2 from "./sets/cn2/index.cards"` resolves here
// (ADR 0043). Home set for Leovold, Emissary of Trest (earliest paper printing,
// ADR 0041) and Palace Jailer (issue #1199).

export * from "./white.cards";
export * from "./blue.cards";
export * from "./black.cards";
export * from "./red.cards";
export * from "./green.cards";
export * from "./multicolor.cards";
export * from "./colorless.cards";
