// ECL — black cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, CardType, TriggeredAbility } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// `gre/constants.ts` PERMANENT_TYPES deliberately excludes "Land" (it scopes
// "types a resolving STACK ITEM can be" — lands are never cast, CR 305.1, so
// never appear on the stack). A discarded/milled card CAN be a land, so the
// "permanent card" check below needs the full CR 300.1 permanent-type list.
const CR_300_1_PERMANENT_CARD_TYPES: ReadonlyArray<CardType> = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Land",
    "Planeswalker",
    "Battle",
];

// Moonshadow — {B} Creature — Elemental (issue #684, Cube FREE evasion/
// protection statics). "Menace\nThis creature enters with six -1/-1 counters
// on it.\nWhenever one or more permanent cards are put into your graveyard
// from anywhere while this creature has a -1/-1 counter on it, remove a
// -1/-1 counter from this creature." (CR 702.111 menace; CR 122.1 counters;
// CR 603.2 zone-change trigger.)
//
// Deviation (documented, CR-compliance default per gre-development.md): the
// "put into your graveyard from anywhere" clause is implemented across the
// two zone-change sources the engine's event vocabulary actually covers —
// PERMANENT_LEFT (battlefield → graveyard, i.e. dies/sacrifice/destroy) and
// CARD_DISCARDED (hand → graveyard). It does NOT fire for a permanent card
// milled from library, because mill is not implemented anywhere in the
// engine yet (mechanicsRegistry.ts lists it "planned"/backlog, issue #684
// audit note) — no card in the catalogue currently triggers off a mill
// event, so this is a project-wide gap, not a Moonshadow-specific
// regression. The "while this creature has a -1/-1 counter on it" guard
// needs no explicit condition: `counters` (remove) is clamped to the
// counters actually present (SpellContext.removeCounter), so firing with
// zero counters on the creature is a safe no-op — CR-equivalent to gating
// the trigger itself.
function moonshadowEntersWithCounters(): TriggeredAbility {
    return enteredTrigger({
        id: "moonshadow-enters-with-counters",
        oracleText: "This creature enters with six -1/-1 counters on it.",
        scope: "self",
        effects: [
            {
                op: "counters",
                action: "add",
                counter: "-1/-1",
                target: { ref: "$source" },
                count: 6,
            },
        ],
    });
}

function moonshadowRemoveCounterOnDeath(): TriggeredAbility {
    return {
        id: "moonshadow-remove-counter-on-left",
        oracleText:
            "Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.",
        event: "PERMANENT_LEFT",
        matches: (event, self) =>
            event.type === "PERMANENT_LEFT" &&
            event.toZone === "graveyard" &&
            event.ownerId === self.controllerId,
        effects: [
            {
                op: "counters",
                action: "remove",
                counter: "-1/-1",
                target: { ref: "$source" },
                count: 1,
            },
        ],
    };
}

function moonshadowRemoveCounterOnDiscard(): TriggeredAbility {
    return {
        id: "moonshadow-remove-counter-on-discard",
        oracleText:
            "Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.",
        event: "CARD_DISCARDED",
        matches: (event, self, state) => {
            if (event.type !== "CARD_DISCARDED") return false;
            if (event.playerId !== self.controllerId) return false;
            // The discarded card is only a "permanent card" if its types
            // (snapshotted in the discarder's graveyard) include a permanent
            // type (CR 205, CR 110.1). Look it up in the graveyard state
            // view — CARD_DISCARDED fires after the card lands there.
            const player = state?.players.find((p) => p.id === event.playerId);
            const gyCard = player?.graveyard?.find(
                (c) => c.id === event.cardInstanceId
            );
            if (gyCard === undefined) return false;
            return gyCard.types.some((t) =>
                CR_300_1_PERMANENT_CARD_TYPES.includes(t as CardType)
            );
        },
        effects: [
            {
                op: "counters",
                action: "remove",
                counter: "-1/-1",
                target: { ref: "$source" },
                count: 1,
            },
        ],
    };
}

export const moonshadow: CardDefinition = {
    id: "2573e694-eaa0-42ca-b470-2ab507cbcec1",
    name: "Moonshadow",
    rarity: "mythic",
    oracleText:
        "Menace\nThis creature enters with six -1/-1 counters on it.\nWhenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 7,
    toughness: 7,
    staticAbilities: ["menace"],
    triggeredAbilities: [
        moonshadowEntersWithCounters(),
        moonshadowRemoveCounterOnDeath(),
        moonshadowRemoveCounterOnDiscard(),
    ],
};

// TODO(issue #684 stub — Iron-Shield Elf's activation cost is "Discard a
// card" (the activating player's OWN choice of card, not a fixed/random
// one). ActivatedAbility.cost (cards/types.ts) has no such primitive:
// `discardLastDrawn` only discards a specific tracked card (Jandor's Ring)
// and `discardAtRandom` discards randomly-chosen cards (Coral Helm) — there
// is no "discard N cards, chooser: the activating player" cost shape.
// Modelling the discard as an `effects[]` op instead of a cost would let the
// ability resolve (for free) even with an empty hand, which isn't
// rules-accurate (CR 602.1 costs must be payable to activate) — not a valid
// workaround. Stop-and-issue: this is a genuine activation-cost gap, not a
// keyword/Op naming issue, so it isn't papered over with resolve(). Tracked
// stub.
// export const ironShieldElf: CardDefinition = {
//     id: "9e0140b2-0185-4adb-b365-2611ce89a0e2",
//     name: "Iron-Shield Elf",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Elf", "Warrior"],
//     power: 3,
//     toughness: 1,
// };
