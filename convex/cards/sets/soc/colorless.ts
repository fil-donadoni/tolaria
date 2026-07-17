// Secrets of Strixhaven Commander (SOC) — colorless cards, split by colour
// per ADR 0043. The registry's `import * as soc from "./sets/soc"` resolves
// through soc/index.ts. Lands and colourless artifacts (no coloured cost)
// live here per the colour-split convention. New home-set directory
// scaffolded for the #1302 residue tranche (parent PRD #620) — currently
// stub-only.

// tracked-by: #1345 (residue of #1302, parent PRD #620) — Staff of the
// Storyteller. "When this artifact enters, create a 1/1 white Spirit
// creature token with flying. Whenever you create one or more creature
// tokens, put a story counter on this artifact. {W}, {T}, Remove a story
// counter from this artifact: Draw a card." The ETB (`createToken`) and the
// activated ability (`{W}, tap, removeCounter("story",1): draw`, the
// `removeCounter` activation-cost shape is already exercised elsewhere) are
// both Op-expressible, but the middle trigger is not: tokens never emit
// `PERMANENT_ENTERED` at all in this engine (`createTokenPermanents`,
// gre/state.ts, never calls `emitPermanentEntered`), and there is no
// dedicated "token created" event either — plus the real trigger is BATCHED
// ("one or more" — fires once per token-creation event, not once per
// token). Needs a token-creation trigger event (+ factory) — see #1345.
// Left as a tracked stub pending that capability.
// import type { CardDefinition } from "../../types";
// export const staffOfTheStoryteller: CardDefinition = {
//     id: "67083aca-b077-4b12-8218-876e22476f85",
//     name: "Staff of the Storyteller",
//     rarity: "uncommon",
//     manaCost: { X: 1, W: 1 },
//     types: ["Artifact"],
// };

export {};
