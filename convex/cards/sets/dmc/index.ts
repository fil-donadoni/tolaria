// DMC (Dominaria United Commander) set barrel — re-exports every populated
// colour module so the registry's `import * as dmc from "./sets/dmc"`
// resolves here unchanged (ADR 0043). Only multicolor is scaffolded so far
// (Torsten, Founder of Benalia, issue #1305).

export * from "./multicolor";
