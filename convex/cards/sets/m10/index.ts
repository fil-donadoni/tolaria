// M10 set barrel — re-exports every colour module so the registry's
// `import * as m10 from "./sets/m10"` resolves here unchanged (ADR 0043).
// Magic 2010 (2009) — home set for Silence (ADR 0041 earliest-paper-printing;
// issue #2761), reprinted in M11 (`convex/cards/sets/m11/white.ts`).

export * from "./white";
