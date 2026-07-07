// WWK — white cards, split by colour per ADR 0043. The registry's
// `import * as wwk from "./sets/wwk"` resolves through wwk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Stoneforge Mystic — {1}{W} Creature. "When this creature enters, you may
// search your library for an Equipment card, reveal it, put it into your
// hand, then shuffle. {1}{W}, {T}: You may put an Equipment card from your
// hand onto the battlefield." (CR 701.19 search / 400.7 / 701.20 shuffle.)
// The ETB is a `choice`(zone: "library", filter: { subtype: "Equipment" },
// count: { min: 0, max: 1 }) — the range makes it "you may" (issue #677) —
// + `moveZone` to hand + shuffle. The activated ability is the hand-source
// `moveZone` shape (issue #677): `choice`(zone: "hand", filter: { subtype:
// "Equipment" }, count: { min: 0, max: 1 }) + `moveZone(from: "hand", to:
// "battlefield")`, routing through `putFromHandOntoBattlefield`. The "reveal
// it" clause is a `reveal` Op on the picked card (issue #945, CR 701.20): it
// makes the found Equipment known to every player, placed BEFORE the
// moveZone/shuffle so the knowledge rides the card into hand.
export const stoneforgeMystic: CardDefinition = {
    id: "19557351-b65f-4b04-b971-66abdc07000a",
    rarity: "rare",
    name: "Stoneforge Mystic",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Kor", "Artificer"],
    power: 1,
    toughness: 2,
    oracleText:
        "When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.",
    triggeredAbilities: [
        enteredTrigger({
            id: "stoneforge-mystic-etb-search",
            oracleText:
                "When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: "Equipment" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an Equipment card (or none).",
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
    activatedAbilities: [
        {
            id: "stoneforge-mystic-drop",
            oracleText:
                "{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.",
            cost: { mana: { X: 1, W: 1 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: { subtype: "Equipment" },
                    count: { min: 0, max: 1 },
                    prompt: "Put an Equipment card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};
