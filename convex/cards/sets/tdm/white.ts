// TDM — white cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// TODO(issue #684 stub — Sage of the Skies' defining ability, "When you cast
// this spell, if you've cast another spell this turn, copy this spell,"
// requires spell-copying. Storm (CR 702.40, the closest existing keyword
// census for "copy this spell N times") is `status: "planned"` in
// mechanicsRegistry.ts with zero engine hits — there is no copy-a-spell
// primitive/Op anywhere in the codebase to build on. Flying + lifelink
// (lifelink itself also `planned`/decorative, precedent: avr/black.ts) are
// individually free, but shipping just the vanilla stat line while dropping
// the storm-style copy — the card's entire reason for being in a Cube —
// would misrepresent it (gre-development.md "never ship partial"). Stop-
// and-issue; tracked stub.
// export const sageOfTheSkies: CardDefinition = {
//     id: "6ade6918-6d1d-448d-ab56-93996051e9a9",
//     name: "Sage of the Skies",
//     rarity: "rare",
//     manaCost: { X: 2, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Monk"],
//     power: 2,
//     toughness: 3,
// };

// Elspeth, Storm Slayer — {3}{W}{W} Legendary Planeswalker — Elspeth, loyalty 5
// (TDM, issue #3230).
// "If one or more tokens would be created under your control, twice that many
//  of those tokens are created instead.
//  +1: Create a 1/1 white Soldier creature token.
//  0: Put a +1/+1 counter on each creature you control. Those creatures gain
//     flying until your next turn.
//  -3: Destroy target creature an opponent controls with mana value 3 or
//     greater."
//
// THE STATIC IS A REPLACEMENT EFFECT (CR 614.1a — "instead"), not a triggered
// ability, and it needed a `ReplacementEventKind` that did not exist: issue
// #3230 added `"token-created"`, fired once per CREATION at the single
// `createTokenPermanents` chokepoint (`gre/state.ts`). Sited there rather than
// on `"enters-battlefield"` because a permanent merely entering is not a token
// being created (CR 111.1) — a reanimated creature and a blinked permanent must
// not double, while a token created and then redirected to exile by Containment
// Priest still WAS created.
//
// "UNDER YOUR CONTROL" scopes on the event's `controllerId`, which is the
// token's prospective CONTROLLER (CR 111.2), never the creating effect's
// controller — so an opponent's effect that creates a token under Elspeth's
// controller's control is doubled, and Elspeth's controller creating a token
// under an opponent's control is not. There is no other filter: "one or more
// tokens" covers creature tokens, Treasures and copy tokens alike (CR 707.5 —
// a token copy is still a token being created).
//
// HER OWN +1 IS DOUBLED. Nothing special makes that work and nothing may be
// added to make it work: the +1's `createToken` Op reaches the same chokepoint
// as every other token creation, with Elspeth on the battlefield, so the
// replacement finds itself. CR 614.5 caps it at one application per event, so
// two Elspeths give four Soldiers, not infinitely many.
//
// THE 0 IS ONE `forEach` OVER "each creature you control", not two passes.
// "Those creatures" is the set the counters went on, so the flying grant must
// iterate the SAME snapshot — a second `forEach` would re-select the board
// after the counters landed and could differ (a creature that died to an SBA
// mid-resolution, a token that stopped being a creature). `duration: { phase:
// "untap", player: "controller" }` is "until your next turn", the mapping
// Azure Beastbinder and Orcish Farmer already use (CR 502.1 — the grant ends as
// the controller's next untap step begins).
//
// THE -3 IS `mvFilter: { min: 3 }` + `controller: "opponent"` (CR 202.3 — mana
// value 3 or greater, with X counting 0 on the battlefield).

// compiler-gap: "If one or more tokens would be created under your control, twice that many of those tokens are created instead." (#2693)
// compiler-gap: "+1: Create a 1/1 white Soldier creature token." (#2693)
// compiler-gap: "0: Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn." (#2693)
// compiler-gap: "-3: Destroy target creature an opponent controls with mana value 3 or greater." (#2693)
export const elspethStormSlayer: CardDefinition = {
    id: "73a065e3-b530-4e62-ab3c-4f6f908184ec",
    name: "Elspeth, Storm Slayer",
    rarity: "mythic",
    oracleText:
        "If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n+1: Create a 1/1 white Soldier creature token.\n0: Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn.\n\u22123: Destroy target creature an opponent controls with mana value 3 or greater.",
    manaCost: { X: 3, W: 2 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Elspeth"],
    loyalty: 5,
    replacementEffects: [
        {
            id: "elspeth-storm-slayer-token-doubling",
            oracleText:
                "If one or more tokens would be created under your control, twice that many of those tokens are created instead.",
            eventKind: "token-created",
            appliesTo: (event, self) =>
                event.kind === "token-created" &&
                event.controllerId === self.controllerId,
            replace: (event) => {
                if (event.kind !== "token-created") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, count: event.count * 2 },
                };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "elspeth-storm-slayer-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText: "+1: Create a 1/1 white Soldier creature token.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Soldier",
                        types: ["Creature"],
                        subtypes: ["Soldier"],
                        colors: ["W"],
                        power: 1,
                        toughness: 1,
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "elspeth-storm-slayer-zero",
            cost: { loyalty: 0 },
            useStack: true,
            oracleText:
                "0: Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: 1,
                        },
                        {
                            op: "grantAbility",
                            target: { ref: "$each" },
                            ability: "flying",
                            duration: {
                                phase: "untap",
                                player: "controller",
                            },
                        },
                    ],
                },
            ],
        },
        {
            id: "elspeth-storm-slayer-minus3",
            cost: { loyalty: -3 },
            useStack: true,
            oracleText:
                "\u22123: Destroy target creature an opponent controls with mana value 3 or greater.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "opponent",
                mvFilter: { min: 3 },
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
