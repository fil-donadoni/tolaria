// SOC set barrel — re-exports every colour module so the registry's
// `import * as soc from "./sets/soc"` resolves here unchanged (ADR 0043).
// colorless.ts is currently stub-only (Staff of the Storyteller, tracked-by
// #1345).

export * from "./colorless";
