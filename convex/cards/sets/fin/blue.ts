// FIN — blue cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { equipAbility, jobSelect } from "../../abilities/equipment";

// Astrologian's Planisphere (issue #2610) — {1}{U} Artifact — Equipment.
// Oracle text: "Job select (When this Equipment enters, create a 1/1
// colorless Hero creature token, then attach this to it.)\nEquipped
// creature is a Wizard in addition to its other types and has 'Whenever you
// cast a noncreature spell and whenever you draw your third card each
// turn, put a +1/+1 counter on this creature.'\nDiana — Equip {2}".
// "Diana —" is pure flavour text (the Final Fantasy character naming the
// Equip line), no rules meaning — the `Cori-Steel Cutter` "Flurry —"
// ability-word precedent (`tdm/red.ts`), just without even an ability-word
// registry row: it is card-specific flavour, not a shared vocabulary term.
//
//  - Job select (CR 702.182a) is the shared `jobSelect()` self-ETB trigger
//    (`abilities/equipment.ts`) — the generalized Living Weapon factory
//    parametrized on `HERO_TOKEN` instead of the Germ.
//  - "Equipped creature is a Wizard in addition to its other types" is a
//    layer-4 `subtype-add` static (CR 305.7/611), the `Urborg, Tomb of
//    Yawgmoth` shape — additive, so the creature keeps its printed types.
//  - The quoted granted ability is a TRIGGERED ability (CR 611.2a/613.1f)
//    living on `triggeredGrantTemplates[]`, pushed onto the host by a
//    `triggered-grant` static — the exact Kaldra Compleat
//    (`mh2/colorless.ts`) convention. `self` inside the template is the
//    RECIPIENT (the equipped creature), so `self.controllerId` reads "you"
//    and `$source` in `effects` resolves to the equipped creature itself.
//    ONE Oracle sentence spans TWO engine events (CR 603.2 — the Sin Spira
//    `fin/multicolor.ts` array-event shape): casting a noncreature spell
//    (the `Third Path Iconoclast` / `Vivi Ornitier` noncreature-filter
//    convention) OR drawing the third card of the turn
//    (`nthDrawThisTurn`-equivalent condition inlined against
//    `CardDrawnEvent.drawIndexThisTurn`, issue #781's per-player draw
//    count — the third draw is 0-based index 2). Neither leg is read inside
//    `effects` (the counter placement is event-independent), so the array
//    `event` form stays legal per the DSL's "no `$event` read on an
//    array-event trigger" rule.
//  - Equip cost is `{2}`, printed on its own with the flavour prefix.
export const astrologiansPlanisphere: CardDefinition = {
    id: "bfa4e927-1d6f-4a64-9801-7d168a5ef3f6", // FIN 46
    name: "Astrologian's Planisphere",
    rarity: "rare",
    oracleText:
        'Job select (When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.)\nEquipped creature is a Wizard in addition to its other types and has "Whenever you cast a noncreature spell and whenever you draw your third card each turn, put a +1/+1 counter on this creature."\nDiana — Equip {2}',
    manaCost: { generic: 1, U: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: AURA_AFFECTS_HOST,
            subtypes: ["Wizard"],
        },
        {
            kind: "triggered-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "astrologians-planisphere-granted-counter",
        },
    ],
    triggeredGrantTemplates: [
        {
            id: "astrologians-planisphere-granted-counter",
            oracleText:
                "Whenever you cast a noncreature spell and whenever you draw your third card each turn, put a +1/+1 counter on this creature.",
            event: ["SPELL_CAST", "CARD_DRAWN"],
            // CR 603.2 — two independent trigger conditions on one ability:
            // a noncreature spell cast by the host's controller (CR 601.2i),
            // or the host's controller drawing their THIRD card this turn
            // (CR 121.1 — 0-based `drawIndexThisTurn === 2`).
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "SPELL_CAST" &&
                    event.casterId === self.controllerId &&
                    !event.spellTypes.includes("Creature")) ||
                (event.type === "CARD_DRAWN" &&
                    event.playerId === self.controllerId &&
                    (event.drawIndexThisTurn ?? 0) === 2),
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
    triggeredAbilities: [
        jobSelect({ id: "astrologians-planisphere-job-select" }),
    ],
    activatedAbilities: [
        equipAbility({
            id: "astrologians-planisphere-equip",
            cost: { generic: 2 },
            oracleText: "Diana — Equip {2}",
        }),
    ],
};
