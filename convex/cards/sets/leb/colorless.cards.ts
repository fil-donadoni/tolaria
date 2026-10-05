// LEB (Limited Edition Beta), split by colour per ADR 0043. Like every set,
// these are a mix of:
//   • CardPrint entries — reprints of cards whose mechanics already live on a
//     LEA CardDefinition. A print only declares the per-edition Scryfall UUID
//     (printId) used for image lookup; the registry resolves printId →
//     definitionId → the shared LEA CardDefinition.
//   • CardDefinition entries — cards first implemented in this set (the two
//     Beta-original cards: Volcanic Island, Circle of Protection: Black, which
//     never existed in Alpha). See ADR 0014.
//
// Cards declared permanently out of scope (ADR 0010) and cards blocked on an
// open issue stay commented with a back-reference, so "LEB complete" reads as
// "complete minus the named exclusions". A commented stub whose definitionId
// points at a not-yet-implemented LEA stub is uncommented once that LEA def
// lands.

import type { CardDefinition } from "../../types";
import { makeDualLand } from "../../abilities";

// Out of scope — see ADR 0010 (physical-dexterity card, irrealizable).
// export const chaosOrbLeb: CardPrint = {
//     printId: "6bec436c-2869-432a-b3cf-633a58af6d4c",
//     definitionId: "92274971-7c4a-4326-b0fe-75e2d124f718", // chaosOrb (stub)
//     setCode: "leb",
// };

// Volcanic Island — Beta-original (no Alpha printing). The tenth ABUR dual;
// taps for {U} or {R} (CR 305.6). Same factory as the LEA duals. Single
// printing, so the def id is its own LEB Scryfall id.
export const volcanicIsland: CardDefinition = makeDualLand({
    id: "0324641d-af55-4c53-b4dc-c8262e967da5",
    rarity: "rare", // matches the LEA ABUR dual cycle
    name: "Volcanic Island",
    oracleText: "({T}: Add {U} or {R}.)",
    colors: ["U", "R"],
});
