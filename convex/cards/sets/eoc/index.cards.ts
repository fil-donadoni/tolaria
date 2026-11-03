// EOC (Edge of Eternities Commander) set barrel — re-exports every populated
// colour module so the registry's `import * as eoc from
// "./sets/eoc/index.cards"` resolves here unchanged (ADR 0043). Only green is
// scaffolded so far (Baloth Prime, issue #7803).

export * from "./green.cards";
