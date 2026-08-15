// TLA — green cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// Badgermole Cub (issue #1317, closes #917's Earthbend/mana-doubling stub).
// Oracle (Scryfall, tla #167): "When this creature enters, earthbend 1.
// (Target land you control becomes a 0/0 creature with haste that's still a
// land. Put a +1/+1 counter on it. When it dies or is exiled, return it to
// the battlefield tapped.)\nWhenever you tap a creature for mana, add an
// additional {G}."
//
// Earthbend N is censused in mechanicsRegistry.ts (`SET_KEYWORDS`, id
// "earthbend") — a new TLA-set keyword-action, not a CR 701/702 entry, but
// its own reminder-text-carrying rule, CR 701.66a: "'Earthbend N' means
// 'Target land you control becomes a 0/0 land creature with haste in
// addition to its other types. Put N +1/+1 counters on it. When that land
// dies or is put into exile, return it to the battlefield tapped under your
// control.'" Decomposes into the `animate` Op (issue #1317, CR 208.2/611.1 —
// 0/0 base, no `subtype` — the rule grants the CARD TYPE Creature, "in
// addition to its other types", not a creature subtype; `grantedAbilities:
// ["haste"]`, no `duration` = CR 611.2b indefinite) + the pre-existing
// `counters` Op ("+1/+1" × N) on a `targetRequirement: { type: "Land",
// count: 1, controller: "you" }` ETB trigger (CR 603.3d, issue #1193 — the
// target is chosen when the trigger is put on the stack). No new Op for the
// keyword itself (primitive-reuse mandate).
//
// The reminder text's THIRD sentence — "When it dies or is exiled, return it
// to the battlefield tapped." — is a delayed triggered ability (CR 603.7a)
// watching that one land for the rest of the game, built as a third
// `delayedTrigger` Op with the INDEFINITE instance leave-watch timing
// `leaves-battlefield-indefinite` (issue #1470): the same `watch` +
// PERMANENT_LEFT machinery as `leaves-battlefield`, minus the CLEANUP purge,
// so the watch survives end of turn. Its body is TWO `moveZone`
// return-a-departed-object Ops (issue #1469) — one `from: "graveyard"` (dies)
// and one `from: "exile"` (exiled, or a `graveyardDestinationFor` graveyard →
// exile redirect), both `tapped: true` (CR 110.5a) and both `controller:
// "controller"` (CR 701.66a's own "return it to the battlefield tapped
// UNDER YOUR CONTROL" clause — "you" is the earthbending player, fixed at
// scheduling time as the DelayedTriggerInstance's `controller`
// (`item.castById` when the ETB trigger resolved), NOT re-derived from the
// land's owner or from whoever controls it at fire time). Exactly one
// `moveZone` Op can find the card, the other is a CR 608.2b no-op — as is
// the whole body if the land has since moved on (regenerated, or scooped
// out of the graveyard). The land comes back as a NEW object (CR 400.7): a
// plain land, no +1/+1 counters, no haste, no animation —
// `resetBattlefieldTransientState` (`gre/state.ts`) reverts the indefinite
// animation and strips the granted keyword at the shared reanimation-entry
// chokepoint.
//
// CR 701.66b ("An ability that triggers whenever a player earthbends
// triggers when the delayed triggered ability described in rule 701.66a is
// created") is N/A: Badgermole Cub is the ONLY card in the catalogue that
// reaches "earthbend" (grep confirms no other card cites the keyword), so no
// "whenever a player earthbends" trigger exists to fire — there is nothing
// for 701.66b to wire up yet. Recorded here so the next TLA earthbend card
// inherits the answer instead of re-deriving it.
//
// The mana-doubling clause ("Whenever you tap a creature for mana, add an
// additional {G}") reuses the pre-existing Wild-Growth-style triggered-mana-
// ability machinery (`tappedTrigger` + `manaBonusForPotential`,
// `gre/tapManaBonus.ts`) — every prior user scopes the bonus to a LAND; here
// `filter: { types: "Creature" }` + `scope: "yours"` scopes it to any
// creature the controller taps for mana instead. NOT DSL-migratable (ADR
// 0045): `tappedTrigger` hardcodes its `resolve` and exposes no `effects[]`
// site (same documented limitation as every other `tappedTrigger` card in the
// catalogue, e.g. Wild Growth, lea/green.ts).
export const badgermoleCub: CardDefinition = {
    id: "340c5799-4964-44dd-8c48-8f3f3aba5211",
    name: "Badgermole Cub",
    rarity: "mythic",
    oracleText:
        "When this creature enters, earthbend 1. (Target land you control becomes a 0/0 creature with haste that's still a land. Put a +1/+1 counter on it. When it dies or is exiled, return it to the battlefield tapped.)\nWhenever you tap a creature for mana, add an additional {G}.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Badger", "Mole"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "badgermole-cub-earthbend",
            oracleText:
                "When this creature enters, earthbend 1. (Target land you control becomes a 0/0 creature with haste that's still a land. Put a +1/+1 counter on it. When it dies or is exiled, return it to the battlefield tapped.)",
            scope: "self",
            targetRequirement: { type: "Land", count: 1, controller: "you" },
            effects: [
                {
                    op: "animate",
                    target: { target: 0 },
                    power: 0,
                    toughness: 0,
                    grantedAbilities: ["haste"],
                },
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: 1,
                    target: { target: 0 },
                },
                {
                    op: "delayedTrigger",
                    timing: "leaves-battlefield-indefinite",
                    oracleText:
                        "When it dies or is exiled, return it to the battlefield tapped.",
                    watch: { target: 0 },
                    capture: { $land: { target: 0 } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$land" },
                            from: "graveyard",
                            to: "battlefield",
                            tapped: true,
                            controller: "controller",
                        },
                        {
                            op: "moveZone",
                            target: { ref: "$land" },
                            from: "exile",
                            to: "battlefield",
                            tapped: true,
                            controller: "controller",
                        },
                    ],
                },
            ],
        }),
        tappedTrigger({
            id: "badgermole-cub-mana-doubler",
            oracleText:
                "Whenever you tap a creature for mana, add an additional {G}.",
            scope: "yours",
            filter: { types: "Creature" },
            forMana: true,
            manaAbility: true, // CR 605.1b / 605.4 — resolves without the stack
            // CR 605.4 — teach the predictive potential-mana models
            // (castability gate + auto-tap solver) that any creature the
            // controller taps for mana yields an extra {G}.
            manaBonusForPotential: {
                appliesTo: { filter: { types: "Creature" } },
                amount: { kind: "fixed", mana: { G: 1 } },
            },
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ G: 1 });
            },
        }),
    ],
};
