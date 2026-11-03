// MSH — black cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Black Widow, Super Spy — {1}{B} Legendary Creature — Human Spy Hero, 2/1
// (Vintage Cube, issue #7228). "Menace. Whenever Black Widow deals combat
// damage to a player, that player exiles cards from the top of their library
// until they exile a nonland card. You may put a +1/+1 counter on Black
// Widow. If you don't, you may cast the exiled nonland card until end of turn
// and mana of any type can be spent to cast that spell."
//
// Pure Effect Script, every verb already exercised:
//   - the damaged player walks their OWN library: `revealUntilMatch` with
//     `player: $event.damagedPlayer`, match and rest both to exile (CR 406.3,
//     face up) and the nonland hit bound to `$hit`;
//   - "you may put a +1/+1 counter. If you don't, …" is a cost-free `mayPay`
//     gating `counters`, the `else` arm taking the cast;
//   - "cast it until end of turn" is `grantCastFromExile` `this-turn`, the
//     card owner's exile resolved through `getExileCardOwner`; "mana of any
//     type can be spent" is its `manaSubstitution: "any-type"` (CR 609.4b /
//     CR 118.14 — scoped to this one spell, a `{C}` pip included). The library
//     owner is the damaged player, the caster Black Widow's controller.
//
// hand-tail: That player exiles cards from the top of their library until they exile a nonland card (#7228)
export const blackWidowSuperSpy = defineCard(() => ({
    id: "63ce0909-7d7d-410d-ab6c-c87fa3e23877",
    name: "Black Widow, Super Spy",
    rarity: "rare",
    oracleText:
        "Menace\nWhenever Black Widow deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card. You may put a +1/+1 counter on Black Widow. If you don't, you may cast the exiled nonland card until end of turn and mana of any type can be spent to cast that spell.",
    manaCost: { X: 1, B: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Spy", "Hero"],
    power: 2,
    toughness: 1,
    staticAbilities: ["menace"],
    triggeredAbilities: [
        damageDealtTrigger({
            id: "black-widow-super-spy-combat-damage",
            oracleText:
                "Whenever Black Widow deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card. You may put a +1/+1 counter on Black Widow. If you don't, you may cast the exiled nonland card until end of turn and mana of any type can be spent to cast that spell.",
            source: "self",
            isCombat: true,
            target: { kind: "player", player: { relation: "any" } },
            effects: [
                {
                    op: "revealUntilMatch",
                    player: { ref: "$event.damagedPlayer" },
                    filter: { excludeType: "Land" },
                    match: "exile",
                    rest: "exile",
                    bind: "$hit",
                },
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Put a +1/+1 counter on Black Widow?",
                    bind: "$counter",
                },
                {
                    op: "if",
                    predicate: { binding: "$counter" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                    else: [
                        {
                            op: "grantCastFromExile",
                            card: { ref: "$hit" },
                            player: "controller",
                            window: "this-turn",
                            manaSubstitution: "any-type",
                        },
                    ],
                },
            ],
        }),
    ],
}));
