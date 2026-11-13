// isd — red cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Past in Flames — {3}{R} Sorcery with Flashback {4}{R}. "Each instant and
// sorcery card in your graveyard gains flashback until end of turn. The
// flashback cost is equal to its mana cost." (CR 702.34a — each granted card is
// castable from the graveyard for its own mana cost, then exiled.) The mass
// form of Snapcaster Mage's grant: a `forEach { set: "graveyard" }` sweep (the
// member set frozen at construct entry) running the instance-level
// `grantFlashback` Op on each `$each`, which expires at cleanup (CR 514.2).
// Past in Flames itself is on the stack while it resolves, so it never reaches
// its own sweep; its printed flashback is the engine capability
// (`convex/gre/flashback.ts`).
// hand-tail: Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (#8629)
export const pastInFlames = defineCard(() => ({
    id: "23af6033-4930-48e4-821d-14cbbe1754b4",
    rarity: "mythic",
    name: "Past in Flames",
    oracleText:
        "Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)\nFlashback {4}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    flashback: { X: 4, R: 1 },
    effects: [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: ["Instant", "Sorcery"] },
            },
            effects: [{ op: "grantFlashback", card: { ref: "$each" } }],
        },
    ],
}));
