// sth — white cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import {
    causedByOpponent,
    leftTrigger,
} from "../../abilities/triggers/leftTrigger";

// Sacred Ground — {1}{W} Enchantment (Stronghold #12, rare).
// "Whenever a spell or ability an opponent controls causes a land to be put
//  into your graveyard from the battlefield, return that card to the
//  battlefield."
//
// CR 603.10 leave-the-battlefield trigger keyed on the causer (issue #1054):
// `leftTrigger`'s `condition` is exactly `causedByOpponent`
// (`event.causerControllerId` set to a player other than this permanent's
// controller — a plain LTB trigger would wrongly fire on the controller's OWN
// sacrifice of their own land, which the oracle text explicitly excludes).
// `scope: "yours"` + `toZone: "graveyard"` + `filter: { types: "Land" }` cover
// "a land [you control] put into your graveyard from the battlefield". No
// `cause` restriction: unlike Karmic Justice this fires on ANY opponent-caused
// removal into the graveyard (destroy OR a forced sacrifice), matching "causes
// ... to be put into your graveyard" (broader than "destroys").
//
// resolve() justification (ADR 0045 DSL-first): the effect acts on the very
// permanent that fired the trigger ("return THAT card to the battlefield") —
// its identity/owner is only available via `leftTrigger`'s `resolve(ctx,
// event, leaving)` last-known-information payload. `TriggeredAbility.effects`
// (the DSL site) does NOT thread the firing event into the script (see the
// field doc on `TriggeredAbility.effects` / `enteredTrigger`'s `effects` —
// "the firing event is not threaded into a script"), so a trigger that must
// act on the departed object stays imperative. Mirrors every existing
// leftTrigger card that reads `leaving.id` / `leaving.ownerId` (Personal
// Incarnation's `pinc-ltb`, lea/white.ts).
export const sacredGround: CardDefinition = {
    id: "37ae4b01-a9c1-4eec-9204-78cb2508e0df",
    rarity: "rare",
    name: "Sacred Ground",
    oracleText:
        "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        leftTrigger({
            id: "sacred-ground-return",
            oracleText:
                "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Land" },
            condition: causedByOpponent,
            resolve: (ctx: SpellContext, _event, leaving) => {
                ctx.returnToBattlefield(
                    leaving.ownerId,
                    leaving.id,
                    "graveyard"
                );
            },
        }),
    ],
};
