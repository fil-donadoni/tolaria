// WOE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as woe from "./sets/woe"` resolves through woe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Agatha's Soul Cauldron — {2} Legendary Artifact (WOE 242, issue #2945,
// parent PRD #1324). "You may spend mana as though it were mana of any color
// to activate abilities of creatures you control. Creatures you control with
// +1/+1 counters on them have all activated abilities of all creature cards
// exiled with Agatha's Soul Cauldron. {T}: Exile target card from a graveyard.
// When a creature card is exiled this way, put a +1/+1 counter on target
// creature you control."
//
// Three clauses, three previously-shipped foundations — no new Op, no
// `resolve()` (ADR 0045):
//
//   - Clause 1, the fixing. `mana-substitution` with `breadth: "any-color"`
//     and the ACTIVATION scope issue #2944 added (CR 609.4b — "If an effect
//     allows a player to spend mana 'as though it were mana of any [type or
//     color],' this affects only how the player may pay a cost"). The scope's
//     `applies` is the printed narrowing, "abilities of creatures you
//     control"; the battlefield-zone gate belongs to
//     `manaSubstitutionScopeMatches`, not to this predicate (CR 110.1), so it
//     is deliberately absent here.
//   - Clause 2, the ability copy. `activated-grant` with the `abilitiesOf`
//     arm issue #2943 added (CR 607.2a — an "exiled with [this object]"
//     ability is LINKED to the ability that exiled the cards, and names
//     exactly that pile; CR 613.1f layer 6). `applies` is the RECIPIENT half
//     ("creatures you control with +1/+1 counters on them", CR 122.1) and
//     `abilitiesOf` the ABILITY half — the linked pile, re-read at every
//     `syncLayer6` derivation, which is what makes a card exiled at instant
//     speed grant its abilities on the next stable transition (ADR 0112).
//     `dependsOnCounters: true` is mandatory for a MATERIALIZED kind whose
//     predicate reads counters (`counterGatedStatics.test.ts`, issue #1711):
//     without it `recomputeContinuousEffects` never re-evaluates the gate and
//     a creature that gains its first +1/+1 counter mid-turn stays abilityless.
//   - Clause 3, the exile. The announced-target `moveZone` + `linkToSource`
//     shape Emperor of Bones already ships (`mh3/black.ts`, issues #1947 /
//     #1323): "a graveyard" is `controller: "any"`, "target card" is
//     `type: "card"`, and the CR 607.2a link is what clause 2's selector reads
//     back. "When a creature card is exiled this way" is a REFLEXIVE trigger
//     (CR 603.12 — "a resolving spell or ability may … create a triggered
//     ability that triggers when [something happens] this way"), so it goes on
//     the stack above the ability that made it and announces its OWN target
//     knowing what was exiled; its gate is `boundMatchesFilter` over the
//     `moveZone` bind, the zone-free CR 608.2h snapshot read — the card is in
//     EXILE by the time the predicate runs, so neither a graveyard lookup
//     (`targetMatchesGraveyardFilter`, which would also need to name one
//     graveyard's owner where the Oracle names any) nor a battlefield one
//     (`objectMatchesFilter`) can see it.
// The Oracle compiler (PRD #2693) reads back none of the three lines: two are
// continuous statics whose grammar it has no rule for, and the third is an
// activated ability with a reflexive trigger nested in its own sentence.
// compiler-gap: "You may spend mana as though it were mana of any color to activate abilities of creatures you control." (#2693)
// compiler-gap: "Creatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with {self}." (#2693)
// compiler-gap: "{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control." (#2693)
export const agathasSoulCauldron: CardDefinition = {
    id: "019b51b0-e5c6-4208-922b-7736686dddcd", // WOE 242
    name: "Agatha's Soul Cauldron",
    rarity: "mythic",
    oracleText:
        "You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with Agatha's Soul Cauldron.\n{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control.",
    // `ManaCost.X` doubles as the generic slot when it is a number
    // (`cards/types.ts`) — `{2}` is `{ X: 2 }`, as every other colourless
    // artifact in this set writes it.
    manaCost: { X: 2 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    staticEffects: [
        {
            kind: "mana-substitution",
            breadth: "any-color",
            scope: {
                kind: "activated-ability",
                applies: (target, source, ctx) =>
                    ctx.isCreature(target) &&
                    target.controllerId === source.controllerId,
            },
        },
        {
            kind: "activated-grant",
            // CR 122.1 — the recipient gate, read live: `dependsOnCounters`
            // below is what re-runs it when the counter arrives.
            applies: (target, source, ctx) =>
                target.controllerId === source.controllerId &&
                ctx.isCreature(target) &&
                ctx.getCounterCount(target, "+1/+1") > 0,
            dependsOnCounters: true,
            // CR 607.2a — the pile linked by this card's OWN {T} ability.
            abilitiesOf: { exiledWithSource: true },
        },
    ],
    activatedAbilities: [
        {
            id: "agathas-soul-cauldron-exile",
            oracleText:
                "{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control.",
            cost: { tap: true },
            useStack: true,
            // "target card from A graveyard" — either player's (CR 400.7: the
            // pile may span owners, and a card exiled from an opponent's
            // graveyard stays in THEIR exile).
            targetRequirement: {
                type: "card",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "exile",
                    linkToSource: true,
                    // CR 608.2h — snapshot the card's types BEFORE the move,
                    // read back by the reflexive gate below.
                    bind: "$exiled",
                },
                {
                    op: "if",
                    predicate: {
                        boundMatchesFilter: { ref: "$exiled" },
                        filter: { type: "Creature" },
                    },
                    then: [
                        {
                            op: "reflexiveTrigger",
                            oracleText:
                                "When a creature card is exiled this way, put a +1/+1 counter on target creature you control.",
                            // CR 603.3d — announced as the reflexive ability
                            // goes on the stack, independently of the exile
                            // target above.
                            targetRequirement: {
                                type: "Creature",
                                count: 1,
                                controller: "you",
                            },
                            effects: [
                                {
                                    op: "counters",
                                    action: "add",
                                    counter: "+1/+1",
                                    target: { target: 0 },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
