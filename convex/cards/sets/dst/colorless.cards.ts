// DST — colorless cards, split by colour per ADR 0043. The registry's
// `import * as dst from "./sets/dst/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import {
    defineCard,
    AURA_AFFECTS_HOST,
    type EffectOp,
    type GameEvent,
    type PermanentView,
} from "../../types";
import { LAND_SUBTYPE_MANA } from "../../../gre/constants";
import {
    leftTrigger,
    wasAttachedToLeaver,
} from "../../abilities/triggers/leftTrigger";
import { equipAbility } from "../../abilities/equipment";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

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
export const skullclamp = defineCard(() => ({
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
}));

// Trinisphere — {3} Artifact. "As long as this artifact is untapped, each spell
// that would cost less than three mana to cast costs three mana to cast.
// (Additional mana in the cost may be paid with any color of mana or colorless
// mana. For example, a spell that would cost {1}{B} to cast costs {2}{B} to
// cast instead.)" One global `cost-modifier` (CR 601.2f) whose `raiseTotalCostTo`
// is the "effect that directly affects the total cost", applied after every
// increase and reduction: it adds GENERIC mana up to the floor, so the reminder
// text's {1}{B} → {2}{B} falls out and a coloured pip is never touched. "As long
// as this artifact is untapped" is read off the carrying permanent (the
// `effectSource` argument), so tapping it switches the tax off live. It reaches
// every player's spells, the controller's included; abilities are not spells and
// stay untouched.
// hand-tail: As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast. (#8640)
export const trinisphere = defineCard(() => ({
    id: "d465597a-362e-4bd0-b547-f11d8807e597",
    name: "Trinisphere",
    rarity: "rare",
    oracleText:
        "As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast. (Additional mana in the cost may be paid with any color of mana or colorless mana. For example, a spell that would cost {1}{B} to cast costs {2}{B} to cast instead.)",
    manaCost: { generic: 3 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (_card, _ctx, effectSource) =>
                effectSource?.isTapped !== true,
            raiseTotalCostTo: 3,
        },
    ],
}));

// Aether Vial — {1} Artifact. "At the beginning of your upkeep, you may put a
// charge counter on this artifact.\n{T}: You may put a creature card with mana
// value equal to the number of charge counters on this artifact from your hand
// onto the battlefield."
//
//  - The upkeep line is a cost-free `mayPay` gating one `counters` add — the
//    Powder Keg shape.
//  - The {T} line is the hand-source `choice` + `moveZone` shape (Elvish
//    Piper); the "mana value equal to" half is `manaValueEquals` over the
//    source's charge-counter tally, read as the ability RESOLVES (CR 608.2h),
//    so a counter added in response counts and a Vial destroyed in response
//    answers with its last known counters.
// hand-tail: {T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield. (#10505)
export const aetherVial = defineCard(() => ({
    id: "741c479b-5e92-4837-9673-9bc72aa11d26",
    name: "Aether Vial",
    rarity: "uncommon",
    oracleText:
        "At the beginning of your upkeep, you may put a charge counter on this artifact.\n{T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield.",
    manaCost: { generic: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "aether-vial-charge",
            oracleText:
                "At the beginning of your upkeep, you may put a charge counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Put a charge counter on Aether Vial?",
                    bind: "$charge",
                },
                {
                    op: "if",
                    predicate: { binding: "$charge" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "charge",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "aether-vial-put",
            oracleText:
                "{T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: {
                        type: "Creature",
                        manaValueEquals: {
                            counters: {
                                of: { ref: "$source" },
                                type: "charge",
                            },
                        },
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Put a creature card with mana value equal to Aether Vial's charge counters onto the battlefield (or none).",
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
}));

// Sundering Titan — {8} Artifact Creature — Golem, 7/10. "When this creature
// enters or leaves the battlefield, choose a land of each basic land type,
// then destroy those lands."
//
// ONE Oracle line = ONE triggered ability on both events (CR 603.2): the
// self-entering half (CR 603.6a) and the self-leaving half (CR 603.6c, a
// look-back trigger, CR 603.10a — it fires from whatever zone the Titan went
// to). The mixed event list makes it NOT an ETB Ability (issue #4758): the
// leaving half is still to come while the Titan sits on the battlefield.
//
// "Choose" is not "target" (CR 115.10a): no targets, so hexproof and shroud
// do not stop it, and the choices are made on resolution by the ability's
// controller (CR 608.2c). One `choice` per basic land type (CR 205.3i), over
// EVERY player's battlefield — the Titan's controller's own lands included,
// which is what makes the card a symmetrical land wipe. Each pick is an exact
// count of one, so a type with a land on the battlefield MUST be answered,
// and a type with none is skipped (no candidate raises no choice, the
// binding stays uncaptured and its `destroy` skips). The five choices are
// independent, so a land with
// several basic land types (Watery Grave, Tropical Island) may be chosen for
// each of them — the printed ruling — and is destroyed once: the later
// `destroy` finds it gone. Every choice is made before any land is destroyed
// ("then"), each destruction through the replacement layer (CR 701.8a).
//
// hand-tail: When this creature enters or leaves the battlefield, choose a land of each basic land type, then destroy those lands. (#10559)
export const sunderingTitan = defineCard(() => ({
    id: "3e4bd552-e629-41a4-868f-d656187317b7", // DST 146
    name: "Sundering Titan",
    rarity: "rare",
    oracleText:
        "When this creature enters or leaves the battlefield, choose a land of each basic land type, then destroy those lands.",
    manaCost: { X: 8 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 7,
    toughness: 10,
    triggeredAbilities: [
        {
            id: "sundering-titan-destroy-basic-types",
            oracleText:
                "When this creature enters or leaves the battlefield, choose a land of each basic land type, then destroy those lands.",
            event: ["PERMANENT_ENTERED", "PERMANENT_LEFT"],
            etbAbility: false, // issue #4758 — the leaving half stays realized
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" ||
                    event.type === "PERMANENT_LEFT") &&
                event.instanceId === self.id,
            effects: chooseLandOfEachBasicTypeThenDestroy(),
        },
    ],
}));

// CR 205.3i — one exact-count-one `choice` per basic land type, every player's
// lands eligible, then one `destroy` per binding (Sundering Titan, above).
function chooseLandOfEachBasicTypeThenDestroy(): EffectOp[] {
    const basicLandTypes = Object.keys(LAND_SUBTYPE_MANA);
    const choices: EffectOp[] = basicLandTypes.map((subtype) => ({
        op: "choice",
        kind: "choose-permanents",
        player: "controller",
        zone: "battlefield",
        allControllers: true,
        filter: { type: "Land", subtype },
        count: 1,
        prompt: `Sundering Titan: choose a land with the basic land type ${subtype} to destroy.`,
        bind: `$${subtype.toLowerCase()}`,
    }));
    // A `choice` binds PICKS, not an object snapshot: `forEach` over the
    // bound picks hands `destroy` each pick as `$each`.
    const destroys: EffectOp[] = basicLandTypes.map((subtype) => ({
        op: "forEach",
        select: { set: "bound", ref: `$${subtype.toLowerCase()}` },
        effects: [{ op: "destroy", target: { ref: "$each" } }],
    }));
    return [...choices, ...destroys];
}
