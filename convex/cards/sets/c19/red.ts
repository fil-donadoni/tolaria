// c19 — red cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Anje's Ravager — {2}{R} Creature — Vampire Berserker, 3/3. "This creature
// attacks each combat if able.\nWhenever this creature attacks, discard your
// hand, then draw three cards.\nMadness {1}{R}." (CR 508.1d attack requirement
// via `staticEffects[]`, template Urborg Drake `inv/multicolor.ts`; CR 509
// attack trigger; CR 702.35 Madness — the discard→exile cast capability,
// `convex/gre/madness.ts`.)
export const anjesRavager: CardDefinition = {
    id: "22924c44-5551-4a48-a574-dfef91a5d4d7",
    rarity: "rare",
    name: "Anje's Ravager",
    oracleText:
        "This creature attacks each combat if able.\nWhenever this creature attacks, discard your hand, then draw three cards.\nMadness {1}{R} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Vampire", "Berserker"],
    power: 3,
    toughness: 3,
    madness: { X: 1, R: 1 },
    staticEffects: [
        {
            kind: "attack-requirement",
            id: "anjes-ravager-attacks-if-able",
            oracleText: "Anje's Ravager attacks each combat if able.",
        },
    ],
    triggeredAbilities: [
        {
            id: "anjes-ravager-attack-wheel",
            oracleText:
                "Whenever this creature attacks, discard your hand, then draw three cards.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            // NOT DSL-migratable (ADR 0045): "discard your hand" has no
            // Effect Script Op — the `discard` Op requires an explicit picks
            // binding (a `choice` Op's fixed-count selection), and there is
            // no whole-hand selector. This matches the shipped Wheel of
            // Fortune / Windfall resolve() pattern (`lea/red.ts`).
            // `ctx.discardCard` routes through `discardToGraveyard`, so a
            // discarded card with madness is itself exiled + made castable
            // (CR 702.35c), not just binned. Blocked on: a whole-hand discard
            // selector Op (planned-migratable). tracked-by: #1279
            resolve: (ctx: SpellContext) => {
                const controller = ctx.controller;
                for (const cardId of ctx.getHandIds(controller)) {
                    ctx.discardCard(controller, cardId);
                }
                ctx.drawCards(controller, 3);
            },
        },
    ],
};

export {};
