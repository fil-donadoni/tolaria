// ARB (Alara Reborn) set barrel — re-exports every populated colour module
// so the registry's `import * as arb from "./sets/arb"` resolves here
// unchanged (ADR 0043). Only multicolor is scaffolded so far (Thopter
// Foundry, shipped as of issue #1926 — its {W/B}{U} hybrid cost was
// unblocked by the hybrid mana wave, PRD #1736).

export * from "./multicolor";
