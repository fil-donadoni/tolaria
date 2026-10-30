// GTC (Gatecrash) set barrel — re-exports every populated colour module so the
// registry's `import * as gtc from "./sets/gtc/index.cards"` resolves here
// unchanged (ADR 0043). Only colorless is scaffolded so far (Thespian's Stage,
// issue #7257).

export * from "./colorless.cards";
