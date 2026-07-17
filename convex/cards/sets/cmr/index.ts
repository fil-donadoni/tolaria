// CMR (Commander Legends) set barrel — re-exports every colour module so the
// registry's `import * as cmr from "./sets/cmr"` resolves here unchanged
// (ADR 0043). Home set for Hullbreacher (earliest paper printing, ADR 0041).

export * from "./white";
export * from "./blue";
export * from "./black";
export * from "./red";
export * from "./green";
export * from "./multicolor";
export * from "./colorless";
