// sth (Stronghold) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

// import type { CardDefinition } from "../../types";

// Mox Diamond — "If this artifact would enter, you may discard a land card
// instead. If you do, put this artifact onto the battlefield. If you don't,
// put it into its owner's graveyard.\n{T}: Add one mana of any color."
// STOP-AND-ISSUE (tracked-by: #1841): the mana ability itself (any-colour
// choice) is trivial, but the ETB replacement redirects the resolving
// permanent to a DIFFERENT zone (graveyard, not battlefield) based on a
// discard choice made AT RESOLUTION — no existing spell/ability site can
// redirect a permanent spell's own destination zone away from the
// battlefield from within its `resolve()`/`resolveSteps` (that transition is
// owned unconditionally by `finalizeSpellResolution`, not by the card). Left
// as a tracked stub pending that capability.
// export const moxDiamond: CardDefinition = {
//     id: "28028830-83ed-45e2-b495-3b9ad9d3e988",
//     name: "Mox Diamond",
//     rarity: "rare",
//     types: ["Artifact"],
// };
export {};
