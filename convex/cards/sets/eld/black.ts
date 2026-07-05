// ELD — black cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Wishclaw Talisman — {1}{B} Artifact. "This artifact enters with three wish
// counters on it. {1}, {T}, Remove a wish counter from this artifact: Search
// your library for a card, put it into your hand, then shuffle. An opponent
// gains control of this artifact. Activate only during your turn." (CR 122
// counters / 701.19 search / 400.7 / 701.20 shuffle / 613.1b control change.)
// The ETB counter-grant is a `counters` Op riding an `enteredTrigger`; the
// activation cost's `removeCounter` payment (CR 122.6) is already a plain
// ActivatedAbility.cost field; `controllerTurnOnly` models "Activate only
// during your turn"; the control change to "an opponent" uses the
// `EffectPlayerRef` literal `"opponent"`.
export const wishclawTalisman: CardDefinition = {
    id: "07c17b01-ee5d-491a-8403-b3f819b778c4",
    name: "Wishclaw Talisman",
    rarity: "rare",
    manaCost: { X: 1, B: 1 },
    types: ["Artifact"],
    oracleText:
        "This artifact enters with three wish counters on it.\n{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.",
    triggeredAbilities: [
        enteredTrigger({
            id: "wishclaw-talisman-etb-counters",
            oracleText: "This artifact enters with three wish counters on it.",
            scope: "self",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "wish",
                    target: { ref: "$source" },
                    count: 3,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "wishclaw-talisman-wish",
            oracleText:
                "{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.",
            cost: {
                mana: { X: 1 },
                tap: true,
                removeCounter: { type: "wish", count: 1 },
            },
            controllerTurnOnly: true,
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
                {
                    op: "gainControl",
                    target: { ref: "$source" },
                    controller: "opponent",
                },
            ],
        },
    ],
};
