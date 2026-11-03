// MSC (Marvel Super Heroes Commander) set barrel — re-exports every populated
// colour module so the registry's `import * as msc from
// "./sets/msc/index.cards"` resolves here unchanged (ADR 0043). Only red is
// scaffolded so far (Batroc the Leaper, issue #7226).

export * from "./red.cards";
