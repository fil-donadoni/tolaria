// DMC (Dominaria United Commander) — multicolor cards (ADR 0043 colour
// split). The registry's `import * as dmc from "./sets/dmc"` resolves
// through dmc/index.ts. Only one card is scaffolded so far (Torsten,
// Founder of Benalia — Vintage Cube residue, issue #1305, parent PRD #620);
// its earliest paper printing is Dominaria United Commander (ADR 0041).

import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

const TORSTEN_FOUNDER_ID = "0783b426-a527-42c1-9271-be28b229e1c6";

// Torsten, Founder of Benalia — {5}{G}{W} Legendary Creature — Human
// Soldier, 7/7. "When Torsten enters, reveal the top seven cards of your
// library. Put any number of creature and/or land cards from among them into
// your hand and the rest on the bottom of your library in a random order.
// When Torsten dies, create seven 1/1 white Soldier creature tokens."
//
// ETB (CR 603.6a self-ETB): the `lookDistribute` Op (issue #984, extended #1101)
// already models "look N, take up to K matching, bottom the rest randomly"
// in one suspend — `look: 7`, `take: 7` + `optional: true` ("any number" =
// min 0, max 7, clamped to however many looked-at cards actually match),
// `filter: { type: ["Creature", "Land"] }` (an array-valued `type` field is
// an OR within the field, CR 205 "creature and/or land"), `randomBottom:
// true` (the un-kept cards are bottomed WITHOUT a player-ordering pick or
// `markKnown`, matching "in a random order" — CR 401.4's random order is
// unobservable for face-down library cards). `destination` omitted =
// library-bottom, the correct leg here.
//
// DIES (CR 700.4 / 603.2 death trigger): a plain `createToken` Op, `count:
// 7`. Modeled as a raw `TriggeredAbility` literal (mirrors Haywire Mite,
// bro/colorless.ts's Third Path Iconoclast) rather than the `diedTrigger`
// factory, since that factory only exposes a `resolve` closure, not
// `effects` — the DSL-first site.
export const torstenFounderOfBenalia: CardDefinition = {
    id: TORSTEN_FOUNDER_ID,
    name: "Torsten, Founder of Benalia",
    rarity: "mythic",
    oracleText:
        "When Torsten enters, reveal the top seven cards of your library. Put any number of creature and/or land cards from among them into your hand and the rest on the bottom of your library in a random order.\nWhen Torsten dies, create seven 1/1 white Soldier creature tokens.",
    manaCost: { X: 5, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 7,
    toughness: 7,
    triggeredAbilities: [
        enteredTrigger({
            id: "torsten-founder-etb",
            oracleText:
                "When Torsten enters, reveal the top seven cards of your library. Put any number of creature and/or land cards from among them into your hand and the rest on the bottom of your library in a random order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 7,
                    take: 7,
                    optional: true,
                    filter: { type: ["Creature", "Land"] },
                    // "REVEAL the top seven cards" (CR 701.20a) — all seven are
                    // shown to every player in the reveal dialog. Only the KEPT
                    // creatures/lands stay known-to-all (they enter hand); the
                    // rest go to a RANDOM bottom and are NOT tracked there, so
                    // the reveal doesn't leak their hidden new positions.
                    reveal: "window",
                    randomBottom: true,
                },
            ],
        }),
        {
            id: "torsten-founder-dies",
            oracleText:
                "When Torsten dies, create seven 1/1 white Soldier creature tokens.",
            event: "CREATURE_DIED",
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "CREATURE_DIED" &&
                event.creatureInstanceId === self.id,
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
                        // No registered token-print art yet (issue #1305 —
                        // `scripts/fetch-token-prints.mjs` clobbers the whole
                        // generated file on every run, so it needs a full
                        // set-file list, not just this file; deferred to a
                        // follow-up regeneration). Omitted `imagePrintId`
                        // falls back to `TokenPlaceholder` client-side.
                    },
                    controller: "controller",
                    count: 7,
                },
            ],
        },
    ],
};
