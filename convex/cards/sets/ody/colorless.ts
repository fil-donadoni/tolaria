// ody — colorless cards (ADR 0043 colour split).

import type { CardDefinition } from "../../../../convex/cards/types";

// Barbarian Ring — "{T}: Add {R}. Barbarian Ring deals 1 damage to you.
// Threshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any
// target. Activate only if seven or more cards are in your graveyard."
// Premodern Burn staple (PRD #979, issue #992).
export const barbarianRing: CardDefinition = {
    id: "1809361e-ae1a-4c47-8464-e6496e94d962",
    name: "Barbarian Ring",
    rarity: "uncommon",
    oracleText:
        "{T}: Add {R}. Barbarian Ring deals 1 damage to you.\nThreshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any target. Activate only if seven or more cards are in your graveyard.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "barbarian-ring-mana",
            oracleText: "{T}: Add {R}. Barbarian Ring deals 1 damage to you.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => {
                ctx.addMana({ R: 1 });
            },
            manaProduced: { R: 1 },
            dealsDamageToControllerOnTap: 1,
        },
        {
            id: "barbarian-ring-sac",
            oracleText:
                "Threshold — {R}, {T}, Sacrifice Barbarian Ring: It deals 2 damage to any target. Activate only if seven or more cards are in your graveyard.",
            cost: { mana: { R: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            canActivate: (_source, state) => {
                const graveyard = state.players.find(
                    (p) => p.id === _source.controllerId
                )?.graveyard;
                return (graveyard?.length ?? 0) >= 7;
            },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Cephalid Coliseum — "{T}: Add {U}. This land deals 1 damage to you.
// Threshold — {U}, {T}, Sacrifice this land: Target player draws three cards,
// then discards three cards. Activate only if there are seven or more cards in
// your graveyard." Barbarian Ring's twin one colour over (Premodern Psychatog
// staple, PRD #2693 / issue #2714): a pain-land mana ability plus a
// threshold-gated sacrifice ability.
//
// Threshold is an ABILITY WORD (CR 207.2c) — italic flavour with no rules
// meaning of its own, so it is not a `staticAbilities[]` keyword and earns no
// Mechanics Registry row; the whole clause lives in `canActivate`, which is
// where "Activate only if …" (CR 602.1b) belongs.
//
// The draw-then-discard pair is Dack Fayden's shape (`sets/cns/multicolor.ts`):
// CR 701.9b makes the DISCARDING player choose which cards go, so the discard
// is a `choice` Op on the targeted player followed by the `discard` Op that
// applies their pick. "then" is sequencing inside one resolution, not two
// events — a player who draws into a full hand still discards three of it.
//
// compiler-gap: "Threshold — {U}, {T}, Sacrifice this land: Target player draws three cards, then discards three cards. Activate only if there are seven or more cards in your graveyard." (#2693)
export const cephalidColiseum: CardDefinition = {
    id: "d5d74112-7244-4c3f-a5eb-b6be671aefe8",
    name: "Cephalid Coliseum",
    rarity: "uncommon",
    oracleText:
        "{T}: Add {U}. This land deals 1 damage to you.\nThreshold — {U}, {T}, Sacrifice this land: Target player draws three cards, then discards three cards. Activate only if there are seven or more cards in your graveyard.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "cephalid-coliseum-mana",
            oracleText: "{T}: Add {U}. This land deals 1 damage to you.",
            // CR 605.1a — adds mana, needs no target, moves no card to or from
            // a library, so it is a mana ability and never uses the stack.
            cost: { tap: true },
            useStack: false,
            manaProduced: { U: 1 },
            dealsDamageToControllerOnTap: 1,
        },
        {
            id: "cephalid-coliseum-threshold",
            oracleText:
                "Threshold — {U}, {T}, Sacrifice this land: Target player draws three cards, then discards three cards. Activate only if there are seven or more cards in your graveyard.",
            cost: { mana: { U: 1 }, tap: true, sacrifice: true },
            useStack: true,
            // CR 115.2 — a player is a legal target when the ability says so;
            // "target player" names any player, the controller included.
            targetRequirement: { type: "player", count: 1 },
            // CR 602.1b — activation instructions may restrict WHEN a player
            // can activate; "your graveyard" is the ACTIVATING player's (CR 109.5).
            canActivate: (source, state) => {
                const graveyard = state.players.find(
                    (p) => p.id === source.controllerId
                )?.graveyard;
                return (graveyard?.length ?? 0) >= 7;
            },
            effects: [
                { op: "draw", player: { target: 0 }, count: 3 },
                {
                    // CR 701.9b — the DISCARDING player chooses which cards go.
                    // A plain numeric `count` is floor and ceiling alike,
                    // clamped down to the hand actually held.
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 3,
                    prompt: "Cephalid Coliseum: discard three cards.",
                    bind: "$coliseumDiscard",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$coliseumDiscard" },
                },
            ],
        },
    ],
};
