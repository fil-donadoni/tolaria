// DST — colorless cards, split by colour per ADR 0043. The registry's
// `import * as dst from "./sets/dst"` resolves through dst/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { AURA_AFFECTS_HOST } from "../../types";
import type { CardDefinition } from "../../types";
import {
    leftTrigger,
    wasAttachedToLeaver,
} from "../../abilities/triggers/leftTrigger";
import { equipAbility } from "../../abilities/equipment";

// Skullclamp — "Equipped creature gets +1/-1.\nWhenever equipped creature
// dies, draw two cards.\nEquip {1}." (issue #1306, parent PRD #620; the
// engine half is #1350.) All three clauses are DSL/declarative:
//
//  - +1/-1 is a flat layer-7c `pt-buff` gated by the canonical
//    `AURA_AFFECTS_HOST` predicate (reads `source.attachedTo === target.id` —
//    Equipment and Auras share the plumbing, see Cori-Steel Cutter).
//  - Equip {1} (CR 702.6e) is the generic `attach` Op on a sorcery-speed-only
//    activated ability targeting a creature you control — the same shell Lion
//    Sash's Reconfigure and Cori-Steel Cutter's Equip use (ADR 0065).
//  - "Whenever equipped creature dies" is a `leftTrigger` on toZone
//    "graveyard" + a Creature filter (CR 700.4's definition of "dies"). It
//    can NOT test `self.attachedTo` at fire time: the attachment SBA
//    (CR 704.5m) detaches the Equipment the instant its host leaves, so the
//    link has to come from last-known information. That is the
//    `attachmentsBeforeLeave` payload added by #1350 (the reverse direction of
//    the pre-existing `attachedToBeforeLeave`, which carries the LEAVER's own
//    host), read via the shared `wasAttachedToLeaver` condition helper so any
//    future "whenever equipped/enchanted creature dies" card reuses it.
export const skullclamp: CardDefinition = {
    id: "55318397-de3c-47ea-a088-72a24df5c8fa",
    name: "Skullclamp",
    rarity: "rare",
    oracleText:
        "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}",
    manaCost: { generic: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: -1,
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "skullclamp-equipped-dies",
            oracleText: "Whenever equipped creature dies, draw two cards.",
            // CR 700.4 — "dies" = put into a graveyard from the battlefield.
            // `any-other` (not `yours`): the equipped creature can be under an
            // opponent's control (Skullclamp equips only creatures you
            // control, but a control-change effect can move the host away
            // while the Equipment stays put — CR 301.5c keeps it attached).
            scope: "any-other",
            toZone: "graveyard",
            filter: { types: "Creature" },
            condition: wasAttachedToLeaver,
            effects: [{ op: "draw", player: "controller", count: 2 }],
        }),
    ],
    activatedAbilities: [
        equipAbility({
            id: "skullclamp-equip",
            cost: { generic: 1 },
            oracleText: "Equip {1}",
        }),
    ],
};
