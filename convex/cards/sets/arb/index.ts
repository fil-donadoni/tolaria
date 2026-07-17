// ARB (Alara Reborn) set barrel — re-exports every populated colour module
// so the registry's `import * as arb from "./sets/arb"` resolves here
// unchanged (ADR 0043). Only multicolor is scaffolded so far (Thopter
// Foundry, a tracked stub blocked on #782).

export * from "./multicolor";
