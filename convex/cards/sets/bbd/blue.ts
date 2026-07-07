// BBD — blue cards, split by colour per ADR 0043. The registry's
// `import * as bbd from "./sets/bbd"` resolves through bbd/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Spellseeker — {2}{U} Creature. "When this creature enters, you may search
// your library for an instant or sorcery card with mana value 2 or less,
// reveal it, put it into your hand, then shuffle." (CR 701.19 / 400.7 /
// 701.20.) `filter.type` is an OR-array (Instant/Sorcery, issue #677);
// `filter.manaValueAtMost: 2` is the fixed mana-value ceiling (issue #677);
// `count: { min: 0, max: 1 }` makes the search optional ("you may"). The
// "reveal it" clause is a `reveal` Op on the picked card (issue #945, CR
// 701.20): it makes the found instant/sorcery known to every player, placed
// BEFORE the moveZone/shuffle so the knowledge rides the card into hand and
// survives the shuffle.
export const spellseeker: CardDefinition = {
    id: "74b4c336-5d4c-4bc5-b82a-35084a6ad808",
    rarity: "rare",
    name: "Spellseeker",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    oracleText:
        "When this creature enters, you may search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.",
    triggeredAbilities: [
        enteredTrigger({
            id: "spellseeker-etb-search",
            oracleText:
                "When this creature enters, you may search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: ["Instant", "Sorcery"],
                        manaValueAtMost: 2,
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an instant or sorcery card with mana value 2 or less (or none).",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
};
