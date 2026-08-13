// LTR — black cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";
import { amassOps } from "../../abilities/amass";

const ORCISH_BOWMASTERS_TRIGGER =
    "When this creature enters and whenever an opponent draws a card except " +
    "the first one they draw in each of their draw steps, this creature " +
    "deals 1 damage to any target. Then amass Orcs 1.";

// Orcish Bowmasters — "Flash / When this creature enters and whenever an
// opponent draws a card except the first one they draw in each of their draw
// steps, this creature deals 1 damage to any target. Then amass Orcs 1."
// (Issue #2374, which also shipped Amass, CR 701.47.)
//
// ONE Oracle sentence = ONE `TriggeredAbility` (CR 603.2, CLAUDE.md's
// multi-event standard): a single ability listening on both engine events the
// sentence spans — `PERMANENT_ENTERED` (this creature entering) and
// `CARD_DRAWN` (an opponent's draw) — rather than two near-duplicate stack
// entries.
//
// "except the first one they draw in each of their draw steps" is
// `CardDrawnEvent.isTurnBasedDrawStepDraw` (CR 504.1, issue #2374), the
// trigger-side twin of the flag Hullbreacher's draw REPLACEMENT already read.
// Deliberately NOT `drawIndexThisTurn === 0`: that is a different predicate
// (it would wrongly exempt an opponent's first upkeep draw, and wrongly punish
// their draw-step draw on any turn they drew earlier), and the CR 504.1
// turn-based-action flag is the only faithful reading.
export const orcishBowmasters: CardDefinition = {
    id: "7c024bae-5631-4e20-ac69-df392ac9e109",
    name: "Orcish Bowmasters",
    rarity: "rare",
    oracleText: `Flash\n${ORCISH_BOWMASTERS_TRIGGER}`,
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Orc", "Archer"],
    power: 1,
    toughness: 1,
    // CR 702.8 — Flash.
    staticAbilities: ["flash"],
    triggeredAbilities: [
        {
            id: "orcish-bowmasters-volley",
            oracleText: ORCISH_BOWMASTERS_TRIGGER,
            event: ["PERMANENT_ENTERED", "CARD_DRAWN"],
            // CR 601.2c — "any target": a creature, a planeswalker or a
            // player, announced as the trigger goes on the stack.
            targetRequirement: { type: "any", count: 1 },
            matches: (event, self) => {
                if (event.type === "PERMANENT_ENTERED") {
                    return event.instanceId === self.id;
                }
                if (event.type === "CARD_DRAWN") {
                    // "whenever an OPPONENT draws a card…"
                    if (event.playerId === self.controllerId) return false;
                    // "…except the first one they draw in each of their draw
                    // steps" (CR 504.1's turn-based draw).
                    return !event.isTurnBasedDrawStepDraw;
                }
                return false;
            },
            effects: [
                { op: "dealDamage", amount: 1, to: { target: 0 } },
                // CR 701.47 — "Then amass Orcs 1."
                ...amassOps("Orc", 1),
            ],
        },
    ],
};

// Troll of Khazad-dûm — "This creature can't be blocked except by three or
// more creatures. Swampcycling {1}." (Issue #1839.)
//
// The block restriction is CR 509.1b's minimum-blocker requirement with N = 3
// — the same rule shape as menace (CR 702.111a, N = 2) but with no keyword
// name of its own, so it is declared as the parametrized engine-internal
// marker `minimum-blockers:3` (censused in `ENGINE_INTERNAL_MARKERS`,
// mechanicsRegistry.ts). `MINIMUM_BLOCKER_RULES` (gre/combatRegistry.ts) reads
// it, `describeMinimumBlockers` takes the MAX over every matching rule, and
// the one threshold feeds both enforcement sites: `validateMinimumBlockers`
// at blocker-confirm (convex/game.ts) and the bot's legal-block enumerator
// (convex/gre/moves.ts).
//
// Swampcycling {1}: CR 702.29e typecycling — `typecyclingAbility`, which
// shares plain Cycling's activation shell (CR 702.29f).
export const trollOfKhazadDum: CardDefinition = {
    id: "a6539e26-b63b-4725-9407-caaf451de084",
    name: "Troll of Khazad-dûm",
    rarity: "common",
    manaCost: { X: 5, B: 1 },
    types: ["Creature"],
    subtypes: ["Troll"],
    power: 6,
    toughness: 5,
    oracleText:
        "This creature can't be blocked except by three or more creatures.\nSwampcycling {1} ({1}, Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle.)",
    // CR 509.1b — "can't be blocked except by three or more creatures".
    staticAbilities: ["minimum-blockers:3"],
    // CR 702.29e/f — Swampcycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Swamp")],
};
