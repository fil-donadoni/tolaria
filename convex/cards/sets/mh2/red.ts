// mh2 — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";
import { dashTrigger } from "../../abilities/dash";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { TREASURE_TOKEN } from "../../sharedTokens";

// Mine Collapse — {3}{R} Instant. "If it's your turn, you may sacrifice a
// Mountain rather than pay this spell's mana cost. Mine Collapse deals 5 damage
// to target creature or planeswalker." (CR 118.9 alternative pitch cost —
// sacrifice a Mountain, gated on the your-turn condition; CR 701.16 sacrifice;
// CR 120.1 damage.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// the existing PERMANENT `action: "sacrifice"` leg (Fireblast's shape) narrowed
// to a single Mountain, plus a `condition: your-turn`. The effect is a single
// already-censused `dealDamage` Op to a creature-or-planeswalker target
// (ADR 0045, DSL-first).
export const mineCollapse: CardDefinition = {
    id: "56e2e8b5-660d-4469-a4fe-2367dfadb709", // MH2 135
    rarity: "common",
    name: "Mine Collapse",
    oracleText:
        "If it's your turn, you may sacrifice a Mountain rather than pay this spell's mana cost.\nMine Collapse deals 5 damage to target creature or planeswalker.",
    manaCost: { X: 3, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Planeswalker"], count: 1 },
    alternativeCosts: [
        {
            id: "pitch-sacrifice-mountain",
            description: "Sacrifice a Mountain",
            action: "sacrifice",
            count: 1,
            filter: { subtypes: "Mountain" },
            condition: { kind: "your-turn" },
        },
    ],
    effects: [{ op: "dealDamage", amount: 5, to: { target: 0 } }],
};

// Fury — {3}{R}{R} Creature — Elemental Incarnation, 3/3 (MH2, issue #1206).
// "Double strike. When this creature enters, it deals 4 damage divided as you
// choose among any number of target creatures and/or planeswalkers. Evoke—Exile
// a red card from your hand." The Evoke halves ship as engine infra (#900):
// the alt cast is a pure HAND leg (`evoke`, reusing `AlternativeCost.handCost`)
// and the sacrifice-on-ETB half is `evokeTrigger` (convex/cards/abilities/
// evoke.ts) — Solitude/Grief precedent.
//
// The ETB is the first TARGETED triggered ability with divide-as-you-choose
// (CR 603.3d + CR 601.2d/120.4, issue #1193): `targetRequirement` on the
// trigger now selects 1–4 target creatures/planeswalkers across BOTH
// battlefields and assigns the ≥1-each split of 4 damage AT ANNOUNCEMENT
// (`raiseTriggerTargetSelection` / the shared divide UI), snapshotting the
// split onto the trigger stack item's `targetAmounts`.
// DSL-first (ADR 0045): the `dealDamageDividedAsChosen` Op (CR 601.2d / 120.4)
// reads the announcement-time divide snapshot off the trigger stack item — the
// group counterpart to the single-`to` `dealDamage` Op; `total` mirrors
// `divideAsChosen.total`.
export const fury: CardDefinition = {
    id: "bd281158-8180-40b9-a5b7-03cfc712d81a",
    rarity: "mythic",
    name: "Fury",
    oracleText:
        "Double strike\nWhen this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.\nEvoke—Exile a red card from your hand.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 3,
    staticAbilities: ["double strike"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a red card from your hand",
        handCost: {
            action: "exile",
            requirements: [{ filter: { color: "R" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "fury-etb",
            oracleText:
                "When this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.",
            scope: "self",
            // CR 601.2d/120.4 — divide-as-you-choose: 1–4 targets (each gets
            // ≥1, so at most 4 targets share the 4 total), any mix of creatures
            // and planeswalkers on either battlefield.
            targetRequirement: {
                type: ["Creature", "Planeswalker"],
                count: { min: 1, max: 4 },
                divideAsChosen: { total: 4 },
            },
            effects: [{ op: "dealDamageDividedAsChosen", total: 4 }],
        }),
        evokeTrigger("Fury"),
    ],
};

// Unholy Heat — {R} Instant. "Unholy Heat deals 2 damage to target creature or
// planeswalker. Delirium — Unholy Heat deals 6 damage instead if there are four
// or more card types among cards in your graveyard." (Delirium ability word —
// engine infra, no registry row.)
export const unholyHeat: CardDefinition = {
    id: "4e879386-b1f8-4f2a-9820-6e1291746f88",
    rarity: "common",
    name: "Unholy Heat",
    oracleText:
        "Unholy Heat deals 2 damage to target creature or planeswalker.\nDelirium — Unholy Heat deals 6 damage instead if there are four or more card types among cards in your graveyard.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        countTypes: true,
                    },
                },
                op: "ge",
                right: 4,
            },
            then: [{ op: "dealDamage", amount: 6, to: { target: 0 } }],
            else: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Blazing Rootwalla — {R} Creature — Lizard, 1/1. "{R}: This creature gets +2/+0
// until end of turn. Activate only once each turn.\nMadness {0}." (CR 605 pump
// activated ability with `oncePerTurn`, template Fire Drake `drk/red.ts`; CR
// 702.35 Madness — the discard→exile cast capability, `convex/gre/madness.ts`.
// `Madness {0}` is the empty cost `{}`. The red counterpart to Basking Rootwalla
// first printed in Modern Horizons 2.)
export const blazingRootwalla: CardDefinition = {
    id: "4404fc9c-ef02-479c-9638-0cc163f0b48f",
    rarity: "common",
    name: "Blazing Rootwalla",
    oracleText:
        "{R}: This creature gets +2/+0 until end of turn. Activate only once each turn.\nMadness {0} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Lizard"],
    power: 1,
    toughness: 1,
    madness: {},
    activatedAbilities: [
        {
            id: "blazing-rootwalla-pump",
            oracleText:
                "{R}: This creature gets +2/+0 until end of turn. Activate only once each turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            oncePerTurn: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Ragavan, Nimble Pilferer — {R} Legendary Creature — Monkey Pirate, 2/1
// (MH2 138, Vintage Cube FREE wave 3: keyword-residue creatures, issue
// #1527, closes #917 residue). "Whenever Ragavan, Nimble Pilferer deals
// combat damage to a player, create a Treasure token and exile the top card
// of that player's library. Until end of turn, you may cast that card.
// Dash {1}{R}."
//
// PROTOCOL (impulse-draw off an opponent's library — no Op skin, precedent:
// Elkin Bottle / Ice Cauldron, ice/colorless.ts; the cross-player exile-and-
// grant shape specifically mirrors Robber of the Rich, eld/red.ts, almost
// line for line): composes `createToken` + `peekLibraryTop` +
// `exileFaceDown` + `grantCastFromExile(..., "this-turn")`, sourced from the
// DAMAGED player's library rather than the caster's own. Dash is the SAME
// factory-composed shape as Death-Greeter's Champion (moc/red.ts):
// `CardDefinition.dash` + `dashTrigger(name)`.
export const ragavanNimblePilferer: CardDefinition = {
    id: "a9738cda-adb1-47fb-9f4c-ecd930228c4d", // MH2 138
    name: "Ragavan, Nimble Pilferer",
    rarity: "mythic",
    oracleText:
        "Whenever Ragavan, Nimble Pilferer deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.\nDash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Monkey", "Pirate"],
    power: 2,
    toughness: 1,
    dash: { id: "dash", description: "Dash {1}{R}", mana: { X: 1, R: 1 } },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "ragavan-combat-damage",
            oracleText:
                "Whenever Ragavan, Nimble Pilferer deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.",
            source: "self",
            target: { kind: "player", player: { relation: "any" } },
            isCombat: true,
            resolve: (ctx, _event, damage) => {
                if (damage.target.type !== "player") return;
                const damagedPlayerId = damage.target.id;
                // CR 707.2 — the shared Treasure token spec (art + sac-for-
                // mana ability already wired).
                ctx.createToken(TREASURE_TOKEN, ctx.controller);
                const top = ctx.peekLibraryTop(damagedPlayerId, 1);
                if (top.length === 0) return; // empty library
                const cardId = top[0];
                // CR 406.3 — exiled hidden to the opponent, known to
                // controller (Robber of the Rich / Headliner Scarlett
                // precedent).
                ctx.exileFaceDown(
                    damagedPlayerId,
                    cardId,
                    "library",
                    ctx.controller
                );
                // Cross-player grant (Robber of the Rich shape): the card
                // stays owned by (and exiled in) the DAMAGED player's zone
                // (CR 400.7), but the ATTACKING player (Ragavan's
                // controller) is granted cast permission "until end of
                // turn".
                ctx.grantCastFromExile(
                    cardId,
                    ctx.controller,
                    damagedPlayerId,
                    "this-turn"
                );
            },
        }),
        dashTrigger("Ragavan, Nimble Pilferer"),
    ],
};

export {};
