// CNS (Conspiracy) set barrel — re-exports every colour module so the
// registry's `import * as cns from "./sets/cns"` resolves here unchanged
// (ADR 0043). Home set for Dack Fayden (earliest paper printing, 2014-06-06 —
// ADR 0041; issues #2360 / #1571). Colour modules are added as cards ship.

export * from "./multicolor";
