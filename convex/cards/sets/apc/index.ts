// APC set barrel — re-exports every colour module so the
// registry's `import * as apc from "./sets/apc"` resolves here
// unchanged (ADR 0043).

export * from "./white";
export * from "./blue";
export * from "./black";
export * from "./red";
export * from "./green";
export * from "./multicolor";
export * from "./colorless";
