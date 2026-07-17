// CN2 (Conspiracy: Take the Crown) set barrel — re-exports every colour module
// so the registry's `import * as cn2 from "./sets/cn2"` resolves here unchanged
// (ADR 0043). Home set for Leovold, Emissary of Trest (earliest paper printing,
// ADR 0041) and Palace Jailer (issue #1199).

export * from "./white";
export * from "./blue";
export * from "./black";
export * from "./red";
export * from "./green";
export * from "./multicolor";
export * from "./colorless";
