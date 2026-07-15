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
// The ETB "up to one target PLAYER" is a trigger-time player target. A
// `TriggeredAbility` carries no announcement-time `targetRequirement` (ADR
// 0002), so the player is chosen mid-resolution via the `choose-player`
// requestChoice kind (candidates = every player, `count: { min: 0, max: 1 }`
// for "up to one"). `putGraveyardOnBottomOfLibrary` performs the CR-faithful
// "bottom of library in a random order" bulk move (seeded PRNG, knowledge
// cleared — ADR 0026).
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
        handCost: {
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
            // Trigger-time player target — CR 115.1a, chosen mid-resolution
            // (a TriggeredAbility has no announcement-time targetRequirement,
            // ADR 0002). "Up to one" → count { min: 0, max: 1 }; an empty pick
            // is "none" and the effect does nothing.
            resolve: (ctx: SpellContext) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `endurance-etb-${ctx.sourceInstanceId}`,
                    kind: "choose-player",
                    zone: "graveyard",
                    candidatePlayerIds: [...ctx.allPlayerIds],
                    count: { min: 0, max: 1 },
                    prompt: "Choose up to one player: they put their graveyard on the bottom of their library in a random order.",
                });
                if (picks === undefined) return; // suspended on the choice
                if (picks.length === 0) return; // chose no player
                ctx.putGraveyardOnBottomOfLibrary(picks[0]);
            },
        }),
        evokeTrigger("Endurance"),
    ],
};

export {};
