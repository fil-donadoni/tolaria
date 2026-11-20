// bro — colorless cards (ADR 0043 colour split).

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

import type { ActivatedAbilityContext } from "../../types";
import { urzaPlaneswalkerFace } from "./urzaPlaneswalkerFace.cards";
import { mishraLostToPhyrexiaFace } from "./mishraLostToPhyrexiaFace.cards";
import { unearthAbility } from "../../abilities/unearth";

// Haywire Mite — {1} Artifact Creature — Insect, 1/1 (Vintage Cube FREE:
// ETB/dies/attack triggers, issue #679). "When this creature dies, you gain
// 2 life. {G}, Sacrifice this creature: Exile target noncreature artifact or
// noncreature enchantment." CR 603.2 death trigger (DSL `gainLife` Op) +
// CR 605 activated ability with a self-sacrifice cost (DSL `exile` Op). Both
// Ops are already interpreter-exercised — no hand-written test required
// (per-Op regime, ADR 0046).
// hand-tail: {G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment. (#8505)
export const haywireMite = defineCard(() => ({
    id: "847a175e-ead1-4596-baf3-5f7f57859e0b",
    name: "Haywire Mite",
    rarity: "uncommon",
    oracleText:
        "When this creature dies, you gain 2 life.\n{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "haywire-mite-death",
            oracleText: "When this creature dies, you gain 2 life.",
            event: "CREATURE_DIED",
            matches: (event, self) =>
                event.type === "CREATURE_DIED" &&
                event.creatureInstanceId === self.id,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
    activatedAbilities: [
        {
            id: "haywire-mite-sac",
            oracleText:
                "{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
            cost: { mana: { G: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                excludeTypes: "Creature",
                count: 1,
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
    ],
}));

// The Mightstone and Weakstone — {5} Legendary Artifact — Powerstone, the half
// of the Urza meld pair that carries no meld ability (CR 712.4a).
export const theMightstoneAndWeakstone = defineCard(() => ({
    id: "02aea379-b444-46a3-82f4-3038f698d4f4",
    name: "The Mightstone and Weakstone",
    rarity: "rare",
    oracleText:
        "When The Mightstone and Weakstone enters, choose one —\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn.\n{T}: Add {C}{C}. This mana can't be spent to cast nonartifact spells.\n(Melds with Urza, Lord Protector.)",
    manaCost: { X: 5 },
    types: ["Artifact"],
    subtypes: ["Powerstone"],
    supertypes: ["Legendary"],
    backFace: urzaPlaneswalkerFace,
    triggeredAbilities: [
        enteredTrigger({
            id: "the-mightstone-and-weakstone-etb",
            oracleText:
                "When The Mightstone and Weakstone enters, choose one —\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn.",
            scope: "self",
            modes: [
                {
                    id: "draw-two",
                    label: "Draw two cards",
                    oracleText: "Draw two cards.",
                    effects: [{ op: "draw", player: "controller", count: 2 }],
                },
                {
                    id: "minus-five",
                    label: "Target creature gets -5/-5 until end of turn",
                    oracleText: "Target creature gets -5/-5 until end of turn.",
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: -5,
                            toughness: -5,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "the-mightstone-and-weakstone-mana",
            oracleText:
                "{T}: Add {C}{C}. This mana can't be spent to cast nonartifact spells.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 2 });
            },
            manaProduced: { C: 2 },
            manaRestriction: "not-nonartifact-spell",
        },
    ],
}));

// Phyrexian Dragon Engine — {3} Artifact Creature — Phyrexian Dragon, 2/2, the
// half of the Mishra meld pair that carries no meld ability (CR 712.4a).
// "Double strike. When this creature enters from your graveyard, you may discard
// your hand. If you do, draw three cards. Unearth {3}{R}{R}"
// The trigger fires on the `PERMANENT_ENTERED.enteredFromGraveyard`
// provenance flag (issue #1533), checked at trigger time; "if you do"
// reads the `mayPay` boolean (CR 608.2c). Unearth is the shared factory
// (CR 702.84a, issue #8165).
// compiler-gap: Unearth {3}{R}{R} (#8165)
export const phyrexianDragonEngine = defineCard(() => ({
    id: "e2b826be-4256-4fd6-ad4d-6c80933ee940",
    name: "Phyrexian Dragon Engine",
    rarity: "rare",
    oracleText:
        "Double strike\nWhen this creature enters from your graveyard, you may discard your hand. If you do, draw three cards.\nUnearth {3}{R}{R} ({3}{R}{R}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)\n(Melds with Mishra, Claimed by Gix.)",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Dragon"],
    power: 2,
    toughness: 2,
    staticAbilities: ["double strike"],
    backFace: mishraLostToPhyrexiaFace,
    triggeredAbilities: [
        {
            id: "phyrexian-dragon-engine-etb",
            // CR 603.6a: fired by its OWN permanent entering and nothing else.
            etbAbility: true,
            oracleText:
                "When this creature enters from your graveyard, you may discard your hand. If you do, draw three cards.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id &&
                event.enteredFromGraveyard === true &&
                // "your graveyard": a card entering from its OWNER's graveyard.
                self.ownerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Discard your hand?",
                    bind: "$discardHand",
                },
                {
                    op: "if",
                    predicate: { binding: "$discardHand" },
                    then: [
                        { op: "discard", player: "controller" },
                        { op: "draw", player: "controller", count: 3 },
                    ],
                },
            ],
        },
    ],
    activatedAbilities: [unearthAbility({ X: 3, R: 2 })],
}));
