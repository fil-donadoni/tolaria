// DSK — red cards, split by colour per ADR 0043. The registry's
// `import * as dsk from "./sets/dsk"` resolves through dsk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, TriggerStateView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";

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

// Enduring Courage — {2}{R}{R} Enchantment Creature — Dog Glimmer, 3/3
// (issue #2085, the DSK "Enduring" cycle; the shared dies-trigger and its
// CR 205.1a / 613.1d derivation live in `abilities/enduringReturn.ts`).
//
// "Whenever another creature you control enters, it gets +2/+0 and gains haste
// until end of turn." — CR 603.6a entry trigger; "another … you control" is
// `enteredTrigger`'s `another-yours` scope, which compares the entering
// permanent's instance id against `self.id` so this card's own arrival never
// pumps itself.
//
// "IT" is the TRIGGERING permanent, not a target — the clause announces
// nothing (CR 603.3d), so there is no `targetRequirement` and no
// hexproof/protection interaction. The Effect Script names it with the
// censused `$event.instanceId` object ref (ADR 0049, `EVENT_FIELD_REGISTRY`),
// which is legal here precisely because `enteredTrigger` declares a SCALAR
// `event: "PERMANENT_ENTERED"` — the array-`event` form has no single event
// type to census a field against. A permanent that left in response resolves
// to nothing and both Ops skip (CR 608.2b).
//
// Two already-exercised Ops, no new verb: `pump` +2/+0 (layer 7c, CR 613.4c)
// and `grantAbility` haste (layer 6, CR 613.1f / 702.10a), both expiring at
// the CR 514.2 cleanup boundary. Haste matters on the ENTERING creature
// (CR 702.10b/c — it may attack and pay {T} costs the turn it arrives), which
// is the whole point of the clause.
//
// Guard C (issue #2701) — the Oracle compiler's grammar has no slot for
// either half of this card yet, so the fragments are named here for the
// corpus backlog PRD #2693 ranks the next grammar rule by. The shared
// dies-trigger line is the cycle's; Enduring Innocence carries it in the
// one-time baseline instead, which only ever shrinks.
// compiler-gap: Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn. (#2693)
// compiler-gap: When {self} dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (#2693)
export const enduringCourage: CardDefinition = {
    id: "f46ac55f-d68e-4d5d-af0a-3879f97f705e",
    name: "Enduring Courage",
    rarity: "rare",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Dog", "Glimmer"],
    power: 3,
    toughness: 3,
    oracleText:
        "Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.\nWhen Enduring Courage dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)",
    triggeredAbilities: [
        enteredTrigger({
            id: "enduring-courage-pump",
            oracleText:
                "Whenever another creature you control enters, it gets +2/+0 and gains haste until end of turn.",
            scope: "another-yours",
            filter: { types: ["Creature"] },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$event.instanceId" },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { ref: "$event.instanceId" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
        // The cycle's shared dies-trigger (CR 700.4 / 603.4 intervening-if,
        // CR 205.1a / 613.1d type-line SET) — `abilities/enduringReturn.ts`.
        enduringReturnTrigger({
            id: "enduring-courage-return",
            cardName: "Enduring Courage",
        }),
    ],
};
