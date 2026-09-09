// J25 (Foundations Jumpstart) — red cards, split by colour per ADR 0043.
// The registry's `import * as j25 from "./sets/j25"` resolves through
// j25/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggerStateView,
} from "../../types";
import { createBloodTokenOp } from "../../abilities/tokens/bloodToken";
import {
    isDamageDealtEvent,
    matchesSourceScope,
} from "../../abilities/triggers/shared";

const IVORA_BLOOD_TRIGGER =
    'When this creature enters and whenever it deals combat damage to a player, create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")';

// Ivora, Insatiable Heir — {1}{R} Legendary Creature — Vampire Warrior, 1/1.
// "Trample / When Ivora enters and whenever it deals combat damage to a
// player, create a Blood token. / Whenever you discard a card, put a +1/+1
// counter on Ivora." (Modern Scryfall oracle text, ADR 0004.) Authored
// DSL-first (ADR 0045): both triggers resolve through Effect Script bodies
// built from already-shipped Ops — no new Op, no `resolve()`.
//
// ONE Oracle line = ONE `TriggeredAbility` (CR 603.2). The first line names
// two engine events — the self-ETB (`PERMANENT_ENTERED`) and its own combat
// damage to a player (`DAMAGE_DEALT`) — so it is a single ability over an
// ARRAY of events, the Orcish Bowmasters shape (`ltr/black.ts`), never two
// near-duplicate entries. The body is identical for both firings and reads
// nothing off the event, which is what makes an Effect Script legal here (an
// array-`event` ability whose effect must inspect `$event` would have to stay
// imperative — `cards/types.ts` § `TriggeredAbility.event`).
//
// `matches` discriminates per firing event and reuses the shared damage
// helpers rather than re-deriving them: `matchesSourceScope(…, "self")` is
// "this permanent is the damage source" (CR 119.3 / 120.3), `isCombat` is the
// CR 510 combat-damage narrowing, and `target.type === "player"` is the
// recipient half — a creature or planeswalker Ivora hits makes no Blood.
//
// The Blood token (CR 111.1 / 707.2) is the shared `BLOOD_TOKEN_SPEC` via
// `createBloodTokenOp`, so this card's Bloods are the SAME synthesized token
// definition as Voldaren Epicure's (`vow/red.ts`) and render with the printed
// Blood art the spec pins (`imagePrintId`, issue #778).
//
// The discard line is a plain `CARD_DISCARDED` trigger with an `effects[]`
// body (the `discardTrigger` factory takes only an imperative `resolve`, so
// the DSL-first default is written out here — Emrakul's graveyard trigger in
// `roe/colorless.ts` is the same hand-written shape). Scope is "your"
// discards from ANY source, cost discards included — notably the Blood
// token's own "{1}, {T}, Discard a card, Sacrifice this token" activation,
// which discards as a COST (CR 601.2h) and so fires this trigger. The counter
// lands on Ivora herself, `{ ref: "$source" }` (CR 122.1a +1/+1).
//
// Guard C (issue #2701): the grammar consumes neither trigger — the Blood
// token creation is unparsed even in its plain single-event form, and so is
// the discard-triggered counter.
// compiler-gap: "When this creature enters and whenever it deals combat damage to a player, create a Blood token." (#2693)
// compiler-gap: "Whenever you discard a card, put a +1/+1 counter on this creature." (#2693)
export const ivoraInsatiableHeir: CardDefinition = {
    id: "2ba70366-b6ae-423a-a8d8-29d2b8afd939",
    name: "Ivora, Insatiable Heir",
    rarity: "uncommon",
    oracleText: `Trample\n${IVORA_BLOOD_TRIGGER}\nWhenever you discard a card, put a +1/+1 counter on this creature.`,
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Vampire", "Warrior"],
    power: 1,
    toughness: 1,
    // CR 702.19 — Trample.
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            id: "ivora-blood",
            oracleText: IVORA_BLOOD_TRIGGER,
            // CR 603.2 — one Oracle sentence, two engine events.
            event: ["PERMANENT_ENTERED", "DAMAGE_DEALT"],
            matches: (
                event: GameEvent,
                self: PermanentView,
                _state?: TriggerStateView
            ): boolean => {
                if (event.type === "PERMANENT_ENTERED") {
                    return event.instanceId === self.id;
                }
                if (!isDamageDealtEvent(event)) return false;
                // CR 510 — combat damage only, dealt BY this creature (CR
                // 120.3 source scope) TO a player.
                if (!event.isCombat) return false;
                if (!matchesSourceScope(event, self, "self")) return false;
                return event.target.type === "player";
            },
            effects: [createBloodTokenOp()],
        },
        {
            id: "ivora-discard-counter",
            oracleText:
                "Whenever you discard a card, put a +1/+1 counter on this creature.",
            event: "CARD_DISCARDED",
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "CARD_DISCARDED" &&
                event.playerId === self.controllerId,
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
};
