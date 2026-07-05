// MMQ — red cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Squee, Goblin Nabob — {2}{R} Legendary Creature. "At the beginning of your
// upkeep, you may return this card from your graveyard to your hand." (CR
// 603.6e graveyard-zone triggered ability, 117.3a optional cost-free "may".)
// A cost-free `mayPay` (issue #680 — `SpellContext.requestMayPay`'s `cost`
// field was already optional; this generalizes the DSL Op rather than adding
// a new one), then the existing Ashen Ghoul-style `$source` self-return
// (`moveZone`'s graveyard → hand branch, issue #737/#839).
export const squeeGoblinNabob: CardDefinition = {
    id: "4ba8325a-1203-4125-9111-94d9e2b1f14b",
    name: "Squee, Goblin Nabob",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "squee-goblin-nabob-upkeep-return",
            oracleText:
                "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
            event: "PHASE_BEGIN",
            zone: "graveyard",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Return Squee, Goblin Nabob to your hand?",
                    bind: "$return",
                },
                {
                    op: "if",
                    predicate: { binding: "$return" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};
