// 4ED set barrel — re-exports every colour module so the registry's
// `import * as fourthEdition from "./sets/4ed"` resolves here unchanged
// (ADR 0043). 4ED is a reprint-only set; only the colour modules with
// CardPrint entries exist.

export * from "./red";
