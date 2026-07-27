// C21 — red cards, split by colour per ADR 0043. The registry's
// `import * as c21 from "./sets/c21"` resolves through c21/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { cardsExiledTrigger } from "../../abilities/triggers/cardsExiledTrigger";

// Laelia, the Blade Reforged — {2}{R} Legendary Creature — Spirit Warrior,
// 2/2, haste (issue #1558, closing the residue split from #1527's Cube FREE
// wave 3). "Haste. Whenever Laelia attacks, exile the top card of your
// library. You may play that card this turn. Whenever one or more cards are
// put into exile from your library and/or your graveyard, put a +1/+1
// counter on Laelia."
//
// ABILITY 1 — PROTOCOL (impulse-draw off your own library — no Op skin,
// precedent: Elkin Bottle / Ice Cauldron, ice/colorless.ts; the SAME idiom
// shipped for Ragavan / Robber of the Rich / Headliner Scarlett): composes
// `peekLibraryTop` + `exileFaceDown` + `grantCastFromExile(..., "this-turn")`.
//
// ABILITY 2 — `cardsExiledTrigger` (issue #1558's new `CARDS_EXILED` event,
// `cards/types.ts` / `state.ts`): fires once per exile OCCURRENCE from
// Laelia's controller's library and/or graveyard (CR 603.3b / 608.2i — the
// official ruling: once per occurrence, never once per card). Notably this
// fires off Laelia's OWN first ability — attacking impulse-exiles a card
// from her controller's library, which is itself a qualifying occurrence —
// the card's core growth loop (attack → exile → +1/+1 counter).
export const laeliaTheBladeReforged: CardDefinition = {
    id: "a3bb2881-e8fb-4fba-a9f9-d93e6ca24378",
    name: "Laelia, the Blade Reforged",
    rarity: "rare",
    oracleText:
        "Haste\nWhenever Laelia attacks, exile the top card of your library. You may play that card this turn.\nWhenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on Laelia.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Spirit", "Warrior"],
    power: 2,
    toughness: 2,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        {
            id: "laelia-attack",
            oracleText:
                "Whenever Laelia attacks, exile the top card of your library. You may play that card this turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx: SpellContext) => {
                const top = ctx.peekLibraryTop(ctx.controller, 1);
                if (top.length === 0) return; // empty library
                const cardId = top[0];
                // CR 406.3 — the impulse idiom exiles face down (a no-op
                // secrecy distinction here, since it's the controller's own
                // top card, but keeps this identical to the shared sibling
                // cards' shape).
                ctx.exileFaceDown(
                    ctx.controller,
                    cardId,
                    "library",
                    ctx.controller
                );
                ctx.grantCastFromExile(
                    cardId,
                    ctx.controller,
                    undefined,
                    "this-turn"
                );
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — bare `resolve()`
            // closure (own-library impulse-draw; no Op skin exists for the
            // exile-and-grant-cast protocol — see the PROTOCOL note above),
            // so the bot's value model has nothing to walk without a shadow
            // script. Same sketch as Ragavan's combat-damage ability
            // (mh2/red.ts) minus the Treasure token: `digToHand` is this
            // codebase's precedent for valuing "look at N, keep 1" impulse
            // draw, standing in for the exile-and-may-cast upside.
            aiEffects: [{ op: "digToHand", player: "controller", look: 1 }],
        },
        cardsExiledTrigger({
            id: "laelia-cards-exiled",
            oracleText:
                "Whenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on Laelia, the Blade Reforged.",
            scope: "you",
            fromZones: ["library", "graveyard"],
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
};
