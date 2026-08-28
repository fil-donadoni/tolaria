// DSK — red cards, split by colour per ADR 0043. The registry's
// `import * as dsk from "./sets/dsk"` resolves through dsk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, TriggerStateView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";

/** Delirium's threshold — "four or more card types among cards in your
 *  graveyard". Delirium is an ability word (CR 207.2c): pure flavour framing,
 *  no rules meaning of its own and no Mechanics Registry row. */
const DELIRIUM_CARD_TYPES = 4;

/** True when `controllerId`'s graveyard holds four or more distinct card types.
 *
 *  The DSL twin of this read is the `count` reader's `countTypes: true` branch
 *  (Unholy Heat, `sets/mh2/red.ts`) — but an intervening-if (CR 603.4) is a
 *  TypeScript predicate the engine re-runs at resolution, and no Effect Script
 *  can be one, so this is the catalogue's FIRST TS-side delirium read. Kept
 *  local per the closure-on-card-#1 convention; a second TS-predicate delirium
 *  card is what extracts it into a shared helper.
 *
 *  FAIL-CLOSED: a view carrying no graveyard for this player reads zero
 *  distinct types, so a missing field can only fail to fire the ability, never
 *  fire it spuriously — the strictly safer error for a trigger that announces
 *  a target on reaching the stack. */
function hasDelirium(controllerId: string, state?: TriggerStateView): boolean {
    const player = state?.players.find((p) => p.id === controllerId);
    if (!player?.graveyard) return false;
    const cardTypes = new Set<string>();
    for (const card of player.graveyard) {
        for (const type of card.types) cardTypes.add(type);
    }
    return cardTypes.size >= DELIRIUM_CARD_TYPES;
}

// Fear of Missing Out — {1}{R} Enchantment Creature — Nightmare, 2/3.
// "When this creature enters, discard a card, then draw a card."
// "Delirium — Whenever this creature attacks for the first time each turn, if
//  there are four or more card types among cards in your graveyard, untap
//  target creature. After this phase, there is an additional combat phase."
//
// FIX (issue #2421): the ETB clause is a real CR 603.2 triggered ability, not
// the permanent's own spell-resolution effect — it was previously wired as
// top-level `effects`, which the engine runs ONLY once, at cast-resolution
// time, immediately before the permanent hits the battlefield. Any non-cast
// entry (reanimation, blink, exile-and-return — e.g. Aang's Iceberg
// sacrificing itself and returning this card) never re-ran it. Rebuilt as an
// `enteredTrigger` (idiom: Aang's Iceberg, tla/white.ts) so the discard-then-
// draw fires off the generic PERMANENT_ENTERED event on every entry path.
//
// The attack trigger (issue #2885) is three already-shipped pieces plus the
// CR 500.8 extra-phase primitive that issue #2886 built:
//
//  - "for the first time each turn" is `maxTriggersPerTurn: 1` (CR 603.2),
//    tallied per source object and reset at the TURN boundary — so the extra
//    combat this card creates does not hand it a second firing.
//  - the delirium clause is an intervening "if" (CR 603.4): checked when the
//    attack is declared AND again on resolution; false at either moment and
//    the ability does not trigger / is removed from the stack doing nothing.
//    Both halves of the effect are behind it — a removed trigger grants no
//    extra combat.
//  - "untap target creature" is a CR 603.3d target announced as the trigger
//    goes on the stack, untapped by the shipped `tapUntap` Op (CR 701.26b).
//  - "After this phase, there is an additional combat phase" is the
//    `extraCombat` Op (CR 500.8), which queues one combat phase consumed at
//    the END_OF_COMBAT exit.
export const fearOfMissingOut: CardDefinition = {
    id: "9d48aaff-46ab-411b-9456-171d4709f951",
    rarity: "rare",
    name: "Fear of Missing Out",
    oracleText:
        "When this creature enters, discard a card, then draw a card.\nDelirium — Whenever this creature attacks for the first time each turn, if there are four or more card types among cards in your graveyard, untap target creature. After this phase, there is an additional combat phase.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Nightmare"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "fear-of-missing-out-etb",
            oracleText:
                "When this creature enters, discard a card, then draw a card.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    player: "controller",
                    zone: "hand",
                    kind: "discard-hand",
                    count: 1,
                    prompt: "Discard a card",
                    bind: "$disc",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$disc" },
                },
                {
                    op: "draw",
                    player: "controller",
                    count: 1,
                },
            ],
        }),
        attacksTrigger({
            id: "fear-of-missing-out-attacks",
            oracleText:
                "Delirium — Whenever this creature attacks for the first time each turn, if there are four or more card types among cards in your graveyard, untap target creature. After this phase, there is an additional combat phase.",
            // CR 508.1m — fires off the one batch event the declare-attackers
            // step emits; `self` narrows it to "THIS creature attacks".
            scope: "self",
            // CR 603.2 — "for the first time each turn". Turn-scoped, not
            // combat-scoped: the second combat phase this card creates is the
            // same turn, so the cap is already spent there.
            maxTriggersPerTurn: 1,
            // CR 603.4 intervening "if", both halves: check-time…
            condition: (_event, self, state) =>
                hasDelirium(self.controllerId, state),
            // …and again as it resolves. False here removes the ability from
            // the stack with no effect — no untap AND no extra combat.
            interveningIf: (_event, self, state) =>
                hasDelirium(self.controllerId, state),
            // CR 603.3d — a real target, announced as the trigger is put on
            // the stack (subject to hexproof/protection/ward). Any creature:
            // the Oracle text names no controller.
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                { op: "extraCombat" },
            ],
        }),
    ],
};
