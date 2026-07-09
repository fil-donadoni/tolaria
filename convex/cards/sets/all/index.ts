// ALL (Alliances) set barrel — re-exports every colour module so the
// registry's `import * as all from "./sets/all"` resolves here unchanged
// (ADR 0043). Home set (earliest paper printing, ADR 0041) for the Vintage
// Cube pitch spells Force of Will (blue) and Pyrokinesis (red), issue #690.

export * from "./blue";
export * from "./red";
