// ECL — black cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, TriggeredAbility } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// A discarded/milled card CAN be a land, so the "permanent card" check below
// needs the full CR 300.1 permanent-type list (`PERMANENT_TYPES`, incl. Land) —
// NOT `gre/constants.ts` CASTABLE_PERMANENT_TYPES, which excludes Land because
// it scopes "types a resolving STACK ITEM can be" (lands are never cast, CR
// 305.1, so never appear on the stack).

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
//
// "Put into your graveyard from anywhere" = ONE Oracle line spanning two
// engine events (CR 603.2), so it is ONE `TriggeredAbility` with an array
// `event: ["PERMANENT_LEFT", "CARD_DISCARDED"]` (the multi-event standard,
// gre-development.md) — its `matches` discriminates per firing event. Shown
// once on the stack / inspector, not as two near-duplicate lines.
//
// "One or more" batching (CR 603.3b, issue #928 fix): `oncePerEventBatch:
// true` collapses N simultaneous zone-change events from a single action — a
// board wipe killing several permanents at once, say — into exactly ONE
// counter removal, not N. Now that both event kinds live on ONE ability, the
// dedupe is per-batch OVERALL: a single action that both discards a permanent
// card AND kills a permanent in the same batch fires exactly once (the older
// two-halves-dedupe-per-type residual gap is closed by the merge).
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

function moonshadowRemoveCounter(): TriggeredAbility {
    return {
        id: "moonshadow-remove-counter",
        oracleText:
            "Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.",
        // "From anywhere" across the two zone-change sources the engine's event
        // vocabulary covers: PERMANENT_LEFT (battlefield → graveyard) and
        // CARD_DISCARDED (hand → graveyard). CR 603.2.
        event: ["PERMANENT_LEFT", "CARD_DISCARDED"],
        matches: (event, self, state) => {
            if (event.type === "PERMANENT_LEFT") {
                return (
                    event.toZone === "graveyard" &&
                    event.ownerId === self.controllerId
                );
            }
            if (event.type === "CARD_DISCARDED") {
                if (event.playerId !== self.controllerId) return false;
                // The discarded card is only a "permanent card" if its types
                // (snapshotted in the discarder's graveyard) include a
                // permanent type (CR 205, CR 110.1). Look it up in the
                // graveyard state view — CARD_DISCARDED fires after the card
                // lands there.
                const player = state?.players.find(
                    (p) => p.id === event.playerId
                );
                const gyCard = player?.graveyard?.find(
                    (c) => c.id === event.cardInstanceId
                );
                if (gyCard === undefined) return false;
                return gyCard.types.some((t) =>
                    PERMANENT_TYPES.includes(
                        t as (typeof PERMANENT_TYPES)[number]
                    )
                );
            }
            return false;
        },
        // CR 603.3b — "one or more permanent cards" collapses N simultaneous
        // matching events in the same batch (a board wipe, or discarding a full
        // hand) into ONE counter removal, not N (issue #928). One ability over
        // both event kinds → the dedupe is per-batch overall.
        oncePerEventBatch: true,
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
        moonshadowRemoveCounter(),
    ],
};

// Iron-Shield Elf — {1}{B} Creature — Elf Warrior, 3/1 (issue #1307 residue
// re-audit, 2026-07-18; originally stubbed under issue #684). "Discard a
// card: This creature gains indestructible until end of turn. Tap it." (CR
// 702.12 indestructible, CR 701.26 tap, CR 602.1/118.3 discard cost.)
//
// UNBLOCKED since the original #684 stub: `ActivatedAbility.cost.discardFilter`
// (`{ filter, count }`, issue #901) now models "discard a CHOSEN card" as a
// real, player-choice activation cost — the exact "discard N cards, chooser:
// the activating player" shape the #684 stub note said didn't exist yet. A
// match-all filter (`{}`) is the same "discard a card" idiom Arc Mage
// (nem/red.ts) already uses. `Tap it` is the ability's SECOND effect (not an
// activation cost — the ability itself isn't `{T}:`-gated, so it stays
// activatable while already tapped, and taps itself as a resolved effect via
// `tapUntap`), composed after the `grantAbility` indestructible grant — both
// Ops are already interpreter-exercised (per-Op regime, ADR 0046), no
// hand-written test required.
export const ironShieldElf: CardDefinition = {
    id: "9e0140b2-0185-4adb-b365-2611ce89a0e2",
    name: "Iron-Shield Elf",
    rarity: "uncommon",
    oracleText:
        "Discard a card: This creature gains indestructible until end of turn. Tap it.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Warrior"],
    power: 3,
    toughness: 1,
    activatedAbilities: [
        {
            id: "iron-shield-elf-discard",
            oracleText:
                "Discard a card: This creature gains indestructible until end of turn. Tap it.",
            cost: { discardFilter: { filter: {}, count: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "indestructible",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
            ],
        },
    ],
};
