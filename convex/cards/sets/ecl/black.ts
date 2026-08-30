// ECL — black cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    SpellContext,
    TriggeredAbility,
} from "../../types";
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
// The six -1/-1 counters are a REPLACEMENT effect (CR 121.6 / 614.1c, issue
// #1693), declared as `entersWith.counters` — NOT a `PERMANENT_ENTERED`
// trigger, which is how this card originally shipped. As a trigger, a printed
// 7/7 briefly sat on the battlefield as an actual 7/7 with a respondable stack
// item pending; as a replacement it is a 1/1 the first instant it is
// observable, which is also what the layer system (CR 613) and state-based
// actions (CR 704.5) must see on their first read.
//
// Deviation (tracked-by: #2785) (documented, CR-compliance default per gre-development.md): the
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
function moonshadowRemoveCounter(): TriggeredAbility {
    return {
        id: "moonshadow-remove-counter",
        oracleText:
            "Whenever one or more permanent cards are put into your graveyard from anywhere while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.",
        // "From anywhere" across the FOUR events that partition graveyard entry
        // (CR 603.2): PERMANENT_LEFT (battlefield → graveyard), CARD_DISCARDED
        // (CR 701.8), CARD_MILLED (CR 701.17) and CARD_PUT_INTO_GRAVEYARD (the
        // residual — any other general zone move into a graveyard, e.g. a "put
        // the rest into your graveyard" dig, which is NOT a mill per CR
        // 701.17a). The last two were missing: this card predates both events,
        // so milling or binning a permanent card removed no counter.
        event: [
            "PERMANENT_LEFT",
            "CARD_DISCARDED",
            "CARD_MILLED",
            "CARD_PUT_INTO_GRAVEYARD",
        ],
        matches: (event, self, state) => {
            if (event.type === "PERMANENT_LEFT") {
                return (
                    event.toZone === "graveyard" &&
                    event.ownerId === self.controllerId
                );
            }
            if (
                event.type === "CARD_DISCARDED" ||
                event.type === "CARD_MILLED" ||
                event.type === "CARD_PUT_INTO_GRAVEYARD"
            ) {
                // All three name the card's owner differently (`playerId` vs
                // `ownerId`) but mean the same player — the graveyard the card
                // landed in (CR 404.3).
                const landedIn =
                    event.type === "CARD_DISCARDED"
                        ? event.playerId
                        : event.ownerId;
                if (landedIn !== self.controllerId) return false;
                // Only a "permanent card" counts (CR 205, CR 110.1). All three
                // events fire AFTER the card lands, so its types are readable
                // off the graveyard state view.
                const player = state?.players.find((p) => p.id === landedIn);
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
    entersWith: { counters: [{ type: "-1/-1", count: 6 }] },
    triggeredAbilities: [moonshadowRemoveCounter()],
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

// Twilight Diviner — {2}{B} Creature — Elf Cleric, 3/3 (ECL, Vintage Cube FREE
// residue #1533, split from the #1526 surveil cluster). "When this creature
// enters, surveil 2. Whenever one or more other creatures you control enter,
// if they entered or were cast from a graveyard, create a token that's a copy
// of one of them. This ability triggers only once each turn."
//
// ETB surveil 2 (CR 701.25): the `scryReorder` Op with `destination:
// "graveyard"`, the same shape as Master of Death (mh2/multicolor.ts).
//
// The second ability is a raw `TriggeredAbility` rather than `enteredTrigger`
// — that factory exposes neither `oncePerEventBatch` nor `maxTriggersPerTurn`.
//   - "another-yours" is the `matches` filter: controller match, self-
//     exclusion, and a Creature type check (CR 603.2).
//   - "entered or were cast from a graveyard" is an intervening-if (CR 603.4)
//     reading the `PERMANENT_ENTERED.enteredFromGraveyard` provenance flag
//     (issue #1533), stamped at the graveyard reanimation chokepoints
//     (`returnToBattlefield` / `returnGraveyardSetToBattlefield` / Animate
//     Dead) and the cast-from-graveyard chokepoint (`finalizeSpellResolution`
//     → `castFromGraveyard`).
//   - "one or more" is `oncePerEventBatch: true` (CR 603.3b); "only once each
//     turn" is `maxTriggersPerTurn: 1` (CR 603.2, per-source tallied).
//   - the copy is `resolve()` (imperative): the token must copy a RUNTIME
//     source (the entering creature) named by the firing event, which a DSL
//     `effects` body cannot see (`enteredTrigger` docs). A simultaneous batch
//     copies the first staged creature — the Oracle's "one of them" choice
//     among a simultaneous batch is out of scope (tracked-by: #1533 note).
function twilightDivinerGraveyardCopy(): TriggeredAbility {
    return {
        id: "twilight-diviner-graveyard-copy",
        oracleText:
            "Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.",
        event: "PERMANENT_ENTERED",
        matches: (event, self) =>
            event.type === "PERMANENT_ENTERED" &&
            event.controllerId === self.controllerId &&
            event.instanceId !== self.id &&
            event.types.includes("Creature") &&
            // CR 603.4 — "if they entered or were cast from a graveyard": the
            // condition is checked at TRIGGER time, so a creature that entered
            // from anywhere else never fires this ability at all.
            event.enteredFromGraveyard === true,
        // CR 603.3b — "one or more" collapses a simultaneous batch (Living
        // Death) into ONE firing.
        oncePerEventBatch: true,
        // CR 603.2 — "only once each turn".
        maxTriggersPerTurn: 1,
        resolve: (ctx: SpellContext, event) => {
            if (event.type !== "PERMANENT_ENTERED") return;
            // CR 707.2 — copy the entering creature; `$controller` is Twilight
            // Diviner's controller ("you").
            ctx.createTokenCopyOf(event.instanceId, ctx.controller);
        },
        // aiEffects (PRD #1423, issue #1519) — a bare `resolve()` body is
        // invisible to the bot's Effect Script value model. The real body
        // copies an unknowable entering creature, so a representative 2/2
        // stands in — the SAME convention Sin (`fin/multicolor.ts`) and
        // `createTokenCopy`'s own valuer use.
        aiEffects: [
            {
                op: "createToken",
                token: {
                    name: "Copy",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                },
                controller: "controller",
            },
        ],
    };
}

export const twilightDiviner: CardDefinition = {
    id: "443b6f30-1493-4d48-93d9-a91e22a7ebb3",
    name: "Twilight Diviner",
    rarity: "rare",
    oracleText:
        "When this creature enters, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)\nWhenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Cleric"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "twilight-diviner-etb-surveil",
            oracleText: "When this creature enters, surveil 2.",
            scope: "self",
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "graveyard",
                    prompt: "Surveil 2 — keep cards on top or put them into your graveyard.",
                },
            ],
        }),
        twilightDivinerGraveyardCopy(),
    ],
};
