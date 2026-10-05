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
import { makeCircleOfProtection } from "../../abilities";

// Circle of Protection: Black — Beta-original (no Alpha printing). Completes
// the CoP cycle; same factory as the LEA CoPs (CR 615). Single printing, so
// the def id is its own LEB Scryfall id — no separate CardPrint needed.
export const circleOfProtectionBlack: CardDefinition = makeCircleOfProtection({
    id: "fa47b4cd-8da4-4544-b011-ba92b7009203",
    rarity: "common", // matches the LEA Circle of Protection cycle
    name: "Circle of Protection: Black",
    oracleText:
        "{1}: The next time a black source of your choice would deal damage to you this turn, prevent that damage.",
    color: "B",
    colorWord: "Black",
});
