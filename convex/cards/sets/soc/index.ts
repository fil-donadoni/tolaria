// SOC set barrel — re-exports every colour module so the registry's
// `import * as soc from "./sets/soc"` resolves here unchanged (ADR 0043).
// colorless.ts currently holds only the Staff of the Storyteller REPRINT
// (`CardPrint`); the definition lives in its home set `onc/white.ts` (earliest
// paper printing, ADR 0041).

export * from "./colorless";
