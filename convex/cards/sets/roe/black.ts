// ROE — black cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Inquisition of Kozilek — {B} Sorcery (Vintage Cube FREE: edict/discard/hand
// disruption, issue #682). "Target player reveals their hand. You choose a
// nonland card from it with mana value 3 or less. That player discards that
// card." (CR 701.20a reveal, CR 701.9 discard, CR 202.3 mana value.) Same
// `reveal` + `choice(zoneOwnerId)` template as Thoughtseize
// (`convex/cards/sets/lrw/black.ts`), with the additional `manaValueAtMost: 3`
// filter field (issue #677) ANDed onto the existing `excludeType: "Land"`
// (issue #682) — no life loss, unlike Thoughtseize.
export const inquisitionOfKozilek: CardDefinition = {
    id: "6a3ff5c3-0fdb-4d54-b4e5-ce7bad9953f0",
    name: "Inquisition of Kozilek",
    rarity: "uncommon",
    oracleText:
        "Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "hand",
            filter: { excludeType: "Land", manaValueAtMost: 3 },
            count: 1,
            prompt: "Choose a nonland card with mana value 3 or less from that player's hand.",
            bind: "$picked",
        },
        {
            op: "discard",
            player: { target: 0 },
            cards: { ref: "$picked" },
        },
    ],
};
