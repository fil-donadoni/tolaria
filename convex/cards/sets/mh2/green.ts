// mh2 — green cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";

// Ignoble Hierarch — {G} Creature — Goblin Shaman, 0/1. "Exalted (CR 702.83) —
// Whenever a creature you control attacks alone, that creature gets +1/+1
// until end of turn.\n{T}: Add {B}, {R}, or {G}." The Jund-colours cousin of
// Noble Hierarch (Vintage Cube mana dork, issue #699). Same shape as Noble
// Hierarch: the exalted keyword expands to its triggered ability at the
// `getDefinition` seam, and the CHOICE mana ability is a CR 605.1a mana
// ability (useStack: false) via `manaChoices`.
export const ignobleHierarch: CardDefinition = {
    id: "aba51852-af8f-49d8-8fb6-22d52a1742b8",
    rarity: "rare",
    name: "Ignoble Hierarch",
    oracleText:
        "Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\n{T}: Add {B}, {R}, or {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Shaman"],
    power: 0,
    toughness: 1,
    staticAbilities: ["exalted"],
    activatedAbilities: [
        {
            id: "ignoble-hierarch-mana",
            oracleText: "{T}: Add {B}, {R}, or {G}.",
            cost: { tap: true },
            effect: (ctx) => {
                ctx.addMana({ G: 1 });
            },
            useStack: false,
            manaChoices: [{ B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Endurance — {1}{G}{G} Creature — Elemental Incarnation, 3/4 (MH2, #1207).
// "Flash. Reach. When this creature enters, up to one target player puts all
// the cards from their graveyard on the bottom of their library in a random
// order. Evoke—Exile a green card from your hand." CR 702.74 Evoke: the alt
// cast is a pure HAND leg (`evoke`, reusing `AlternativeCost`'s `handCost`
// shape) and the sacrifice-on-ETB half is `evokeTrigger` — Solitude/Grief
// precedent (mh2/white.ts, mh2/black.ts).
//
// TARGETING (CR 603.3d, issue #1193): "up to one target player" is a REAL
// target chosen when the ETB trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (`raiseTriggerTargetSelection`
// in gre/rules.ts), NOT a resolution-time `requestChoice`. That makes it
// subject to redirect/"becomes the target" triggers and locks the player
// before resolution, matching the printed "target player" wording. `type:
// "player"` with `count { min: 0, max: 1 }` = "up to one target player" (any
// player eligible — no controller restriction in the text). The resolve()
// then reads the announced slot via `ctx.targets[0]` and hands its player id
// to `putGraveyardOnBottomOfLibrary`, the CR-faithful "bottom of library in a
// random order" bulk move (seeded PRNG, knowledge cleared — ADR 0026).
export const endurance: CardDefinition = {
    id: "eb0e0404-4846-4891-acfa-bd0951ecf9c6",
    rarity: "mythic",
    name: "Endurance",
    oracleText:
        "Flash\nReach\nWhen this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.\nEvoke—Exile a green card from your hand.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flash", "reach"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a green card from your hand",
        hand: {
            action: "exile",
            requirements: [{ filter: { color: "G" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "endurance-etb",
            oracleText:
                "When this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.",
            scope: "self",
            // CR 603.3d — "up to one target player": a real target locked when
            // the trigger goes on the stack (not a resolution-time choice).
            // `count { min: 0, max: 1 }` = "up to one"; every player is a legal
            // target (no controller restriction in the oracle text).
            targetRequirement: { type: "player", count: { min: 0, max: 1 } },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return; // "up to one": none chosen / CR 608.2b none legal
                ctx.putGraveyardOnBottomOfLibrary(target.id);
            },
        }),
        evokeTrigger("Endurance"),
    ],
};

export {};
