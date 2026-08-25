// LCI — red cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { discardTrigger } from "../../abilities/triggers/discardTrigger";

// Inti, Seneschal of the Sun — {1}{R} Legendary Creature — Human Knight, 2/2
// (LCI 156, Vintage Cube FREE wave 3: keyword-residue creatures, issue
// #1527, closes #1325/#917 residue). "Whenever you attack, you may discard
// a card. When you do, put a +1/+1 counter on target attacking creature. It
// gains trample until end of turn.\nWhenever you discard one or more cards,
// exile the top card of your library. You may play that card until your
// next end step."
//
// Ability 1 — a CR 603.3c REFLEXIVE trigger (Minsc & Boo, Timeless Heroes,
// `clb/multicolor.ts`, precedent): the outer "whenever you attack, you may
// discard a card" is an untargeted `choice` (kind "choose-hand-card", count
// {min:0,max:1}) gated by `picksNonEmpty`; "when you do" is the
// `reflexiveTrigger` Op, which announces ITS OWN target ("target attacking
// creature", `combatRoleFilter: "attacking"`) only once the discard has
// actually happened (CR 603.3d) — `counters` + `grantAbility` (trample,
// until end of turn) on that target.
//
// Ability 2 — the SAME impulse-draw PROTOCOL shipped for Ragavan/Robber of
// the Rich (no Op skin, precedent: Elkin Bottle / Ice Cauldron,
// ice/colorless.ts), riding `discardTrigger`'s resolve hook.
// SIMPLIFICATION (flagged, `discardTrigger`'s own documented behavior): one (tracked-by: #2785)
// CARD_DISCARDED event fires PER discarded card (a discard of N cards fires
// this ability N times, not once for "one or more cards") — unobservable
// here since Inti's OWN ability 1 above only ever discards exactly one card
// at a time, the only golden path this catalogue produces today.
// The play-permission window is granted via
// `grantCastFromExile(..., "until-next-end-step")` (issue #1557) — exact
// CR 514.2 turn-boundary semantics for "you may play that card until your
// next end step", including the off-turn case (some other effect discarding
// on Inti's behalf outside its own attack step, e.g. an opponent's-turn
// instant-speed discard).
export const intiSeneschalOfTheSun: CardDefinition = {
    id: "fa7a55aa-ae61-4933-b7a4-dcc55dac6fcd", // LCI 156
    name: "Inti, Seneschal of the Sun",
    rarity: "rare",
    oracleText:
        "Whenever you attack, you may discard a card. When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn.\nWhenever you discard one or more cards, exile the top card of your library. You may play that card until your next end step.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "inti-attack-discard",
            oracleText:
                "Whenever you attack, you may discard a card. When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: { min: 0, max: 1 },
                    prompt: "Discard a card (Inti, Seneschal of the Sun)?",
                    bind: "$intiDiscard",
                },
                {
                    op: "if",
                    predicate: { picksNonEmpty: { ref: "$intiDiscard" } },
                    then: [
                        {
                            op: "discard",
                            player: "controller",
                            cards: { ref: "$intiDiscard" },
                        },
                        // CR 603.3c — the reflexive ability triggers off the
                        // discard having HAPPENED; its own target ("target
                        // attacking creature") is announced now, per CR
                        // 603.3d.
                        {
                            op: "reflexiveTrigger",
                            oracleText:
                                "When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn.",
                            targetRequirement: {
                                type: "Creature",
                                count: 1,
                                combatRoleFilter: "attacking",
                            },
                            effects: [
                                {
                                    op: "counters",
                                    action: "add",
                                    counter: "+1/+1",
                                    target: { target: 0 },
                                    count: 1,
                                },
                                {
                                    op: "grantAbility",
                                    target: { target: 0 },
                                    ability: "trample",
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            ...discardTrigger({
                id: "inti-discard-impulse",
                oracleText:
                    "Whenever you discard one or more cards, exile the top card of your library. You may play that card until your next end step.",
                scope: "your",
                resolve: (ctx, _event, discardingPlayerId) => {
                    const top = ctx.peekLibraryTop(discardingPlayerId, 1);
                    if (top.length === 0) return; // empty library
                    const cardId = top[0];
                    // CR 406.3 — exiled hidden to the opponent, known to
                    // controller (Ragavan / Robber of the Rich precedent).
                    ctx.exileFaceDown(
                        discardingPlayerId,
                        cardId,
                        "library",
                        discardingPlayerId
                    );
                    // CR 305.9 (issue #1689) — oracle says "you may PLAY
                    // that card until your next end step", land-inclusive.
                    ctx.grantCastFromExile(
                        cardId,
                        discardingPlayerId,
                        undefined,
                        "until-next-end-step",
                        { includesLand: true }
                    );
                },
            }),
            // aiEffects (PRD #1423, issue #1431/#1519) — bare `resolve()`
            // closure (impulse-draw off the controller's own library, the
            // Ragavan/Robber of the Rich PROTOCOL, no Op skin), so the bot's
            // value model has nothing to walk without a shadow script.
            // `lookDistribute` is this codebase's own precedent for valuing
            // "look at N, keep 1" impulse draw (`CARD_SELECTION_VALUE`,
            // `gre/ai/opValuers.ts`), standing in for the exile-and-may-cast
            // upside even though the real effect casts from exile rather
            // than hand.
            aiEffects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 1,
                },
            ],
        },
    ],
};

export {};
