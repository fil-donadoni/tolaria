// mh2 — black cards (ADR 0043 colour split).
import type { CardDefinition, EffectOp } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { evokeTrigger } from "../../abilities/evoke";

// Archon of Cruelty — {6}{B}{B} Creature Archon, 6/6, flying (Vintage Cube
// FREE: edict/discard/hand-disruption, issue #682). "Flying. Whenever this
// creature enters or attacks, target opponent sacrifices a creature or
// planeswalker of their choice, discards a card, and loses 3 life. You draw
// a card and gain 3 life." "Target opponent" is a REAL target, announced as
// the trigger goes on the stack (CR 603.3d) through `TriggeredAbility`'s own
// `targetRequirement` — the field ADR 0002 once omitted and issue #1193
// restored. The old `"opponent"` `EffectPlayerRef` shortcut identified WHO the
// opponent is without ever asking WHETHER they may be targeted, so it bypassed
// the single player-target legality gate, ignoring both
// protection from everything (CR 702.16b)
// and shroud (CR 702.18) — each applied to a player via CR 115.4 (issue
// #2801). Two
// `TriggeredAbility` entries (enters / attacks) share the identical effect
// list: `choice(sacrifice-permanents)` + `sacrifice` for the
// creature-or-planeswalker pick, `choice(discard-hand)` + `discard` for the
// forced discard (CR 701.9a — unspecified "discards a card" is that player's
// own choice), then `loseLife`/`draw`/`gainLife`.
const archonOfCrueltyTriggerEffects: EffectOp[] = [
    {
        op: "choice",
        kind: "sacrifice-permanents",
        player: { target: 0 },
        zone: "battlefield",
        filter: { type: ["Creature", "Planeswalker"] },
        count: 1,
        prompt: "Sacrifice a creature or planeswalker of your choice.",
        bind: "$sac",
    },
    { op: "sacrifice", permanents: { ref: "$sac" } },
    {
        op: "choice",
        kind: "discard-hand",
        player: { target: 0 },
        zone: "hand",
        count: 1,
        prompt: "Discard a card.",
        bind: "$disc",
    },
    { op: "discard", player: { target: 0 }, cards: { ref: "$disc" } },
    { op: "loseLife", player: { target: 0 }, amount: 3 },
    { op: "draw", player: "controller", count: 1 },
    { op: "gainLife", player: "controller", amount: 3 },
];

export const archonOfCruelty: CardDefinition = {
    id: "1be9d9a4-d7ee-4854-abc2-85cabf993ec9",
    name: "Archon of Cruelty",
    rarity: "mythic",
    oracleText:
        "Flying\nWhenever this creature enters or attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
    manaCost: { X: 6, B: 2 },
    types: ["Creature"],
    subtypes: ["Archon"],
    power: 6,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "archon-of-cruelty-enters",
            oracleText:
                "Whenever this creature enters, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: archonOfCrueltyTriggerEffects,
        },
        {
            id: "archon-of-cruelty-attacks",
            oracleText:
                "Whenever this creature attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: archonOfCrueltyTriggerEffects,
        },
    ],
};

// Grief — {2}{B}{B} Creature Elemental Incarnation, 3/2, menace (Vintage Cube
// edict/discard/hand-disruption, issue #682/#931; ships via #900). "Menace.
// When this creature enters, target opponent reveals their hand. You choose a
// nonland card from it. That player discards that card. Evoke—Exile a black
// card from your hand." CR 702.74 Evoke: the alt cast is a pure HAND leg
// (`evoke`, reusing `AlternativeCost`'s `handCost` shape), the sacrifice-on-
// ETB half is `evokeTrigger`. "Target opponent" is a REAL target announced as
// the trigger goes on the stack (CR 603.3d), NOT a relative
// `EffectPlayerRef`: only a declared `targetRequirement` reaches the single
// player-target legality gate, so the old `player: "opponent"` shortcut
// silently ignored protection from everything and shroud (CR 702.16b /
// 702.18 via CR 115.4, issue #2801). The ETB
// effect is the canonical Thoughtseize/Duress template (`reveal` + `choice
// (choose-hand-card)` with `zoneOwnerId` — lrw/black.ts): reveal the
// opponent's hand, the CONTROLLER picks a nonland card from it, that card is
// discarded. DSL-first (ADR 0045) — every Op here is already exercised by
// Thoughtseize, so no hand-written GRE/wire test is required (per-Op regime).
const griefTriggerEffects: EffectOp[] = [
    { op: "reveal", player: { target: 0 }, zone: "hand" },
    {
        op: "choice",
        kind: "choose-hand-card",
        player: "controller",
        zoneOwnerId: { target: 0 },
        zone: "hand",
        filter: { excludeType: "Land" },
        count: 1,
        prompt: "Choose a nonland card from your opponent's hand.",
        bind: "$picked",
    },
    { op: "discard", player: { target: 0 }, cards: { ref: "$picked" } },
];

export const grief: CardDefinition = {
    id: "e6befbc4-1320-4f26-bd9f-b1814fedda10",
    rarity: "mythic",
    name: "Grief",
    oracleText:
        "Menace\nWhen this creature enters, target opponent reveals their hand. You choose a nonland card from it. That player discards that card.\nEvoke—Exile a black card from your hand.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 2,
    staticAbilities: ["menace"],
    evoke: {
        id: "evoke",
        description: "Evoke—Exile a black card from your hand",
        hand: {
            action: "exile",
            requirements: [{ filter: { color: "B" }, count: 1 }],
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "grief-etb",
            oracleText:
                "When this creature enters, target opponent reveals their hand. You choose a nonland card from it. That player discards that card.",
            scope: "self",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: griefTriggerEffects,
        }),
        evokeTrigger("Grief"),
    ],
};

/** Bone Shards — {B} Sorcery. "As an additional cost to cast this spell,
 *  sacrifice a creature or discard a card. Destroy target creature or
 *  planeswalker."
 *
 *  CR 601.2b — the "sacrifice a creature OR discard a card" clause is a
 *  CASTER-CHOSEN disjunction of ADDITIONAL costs: "the player announces their
 *  intentions to pay any or all of those costs". Both legs are paid ALONGSIDE
 *  the mana cost (CR 601.2f), never instead of it, and the caster names which
 *  one at ANNOUNCEMENT — before targets and before anything is paid. That is
 *  `additionalCosts.oneOf`, the shape Bitter Triumph (`lci/black.ts`) shipped:
 *  the engine flattens the named leg onto the spec (`resolveAdditionalCosts`,
 *  `convex/gre/additionalCost.ts`) and the ordinary cost machinery pays it —
 *  the sacrifice through the cast's permanent picker (CR 701.21), the discard
 *  through its hand-cost picker (CR 701.9).
 *
 *  With no creature on the battlefield AND an empty hand NEITHER leg is
 *  payable, so the spell is not castable at all (CR 601.2f — the total cost
 *  includes every additional cost, and an unpayable one stops the cast). The
 *  cast card itself is never eligible for the discard leg (it is on the stack
 *  by then); it is not a creature, so it is never a sacrifice candidate
 *  either. */
export const boneShards: CardDefinition = {
    id: "1ee98955-4c47-4d45-9377-608dfa755337",
    name: "Bone Shards",
    rarity: "common",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature or discard a card.\nDestroy target creature or planeswalker.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    additionalCosts: {
        oneOf: [
            {
                id: "sacrifice-creature",
                label: "Sacrifice a creature",
                sacrificeFilter: { types: "Creature" },
            },
            { id: "discard", label: "Discard a card", discard: { count: 1 } },
        ],
    },
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

// TODO(issue #676 stub — Overload, CR 702.96, is `planned` in
// mechanicsRegistry.ts: no alternative-cost "change target to each"
// primitive exists, and Damn's overload mode (destroy each creature) is half
// the card. Stop-and-issue; tracked stub.
// export const damn: CardDefinition = {
//     id: "efeae088-9ac5-4d2f-a15c-d8675a471ac5",
//     name: "Damn",
//     rarity: "rare",
//     manaCost: { B: 2 },
//     types: ["Sorcery"],
// };

// Dauthi Voidwalker — {1}{B} Creature Dauthi Rogue, 3/2, shadow (MH2 81,
// Vintage Cube FREE tranche, issue #686). "Shadow. If a card would be put
// into an opponent's graveyard from anywhere, exile it with a void counter on
// it instead. {T}, Sacrifice this creature: Choose an exiled card an opponent
// owns with a void counter on it. You may play it this turn without paying
// its mana cost. Activate only as a sorcery."
//
// Ability 1 (the graveyard-bound redirect) shipped as engine infra via
// #1145 — the `"graveyard-bound"` `ReplacementEventKind` + apply-loop hook
// (`gre/replacements.ts::applyGraveyardBoundReplacements`), already tested
// end to end against a synthetic Dauthi-shaped permanent
// (`gre/__tests__/graveyardBoundReplacement.test.ts`). Wired here as a
// `replacementEffects[]` entry, opponent-scoped (`event.ownerId !==
// self.controllerId`), tagging the redirected card `{ void: 1 }`.
//
// Ability 2 ships via #1156 with three new general engine primitives (each
// reusable by future cards, not Dauthi-specific):
//  - `choose-exile-card` — the exile-zone `choice` kind (`gre/types.ts`
//    `ZonePickKind`, `cards/types.ts` `EffectChoiceKind`), generalizing
//    `choose-graveyard-card`'s public-zone-allow-list shape to exile.
//  - `EffectCardFilter.hasCounter` — "has a counter of type X" filter
//    dimension, matched against the new `SpellContext.getExileCards`'
//    `counters` field (the graveyard-bound replacement's `tagCounters` stamp
//    lands directly on the exiled `CardInstanceState`).
//  - `ActivatedAbility.sorcerySpeedOnly` — "activate only as a sorcery" (CR
//    602.3b), checked via the engine's `isSorceryTiming` at the shared
//    `assertActivationTimingLegal` chokepoint (`convex/game.ts`).
//  - `SpellContext.grantCastFromExile`'s `withoutPayingManaCost` option (+
//    the new `grantCastFromExile` Op skin wrapping it, issue #1145's
//    addendum comment flagged this as the natural follow-up) — the free-cast
//    waiver, consulted by `castRawManaCost` (the ONE place a cast's mana
//    cost is computed) and `getLegalActions`'s exile-cast affordability
//    branch. Fixed as part of the same issue: the cast-from-exile pipeline
//    (`findCastableExileCard` / `locateCastSource` / the `removeFromZone`
//    commit sites / `applyPlayLandFromExile`) was SAME-PLAYER-ONLY before
//    this card — Dauthi's grant is the first CROSS-PLAYER one to actually
//    exercise the `zoneOwnerId` path end to end (Robber of the Rich,
//    eld/red.ts, declared the same shape earlier but nothing drove it
//    through `announceCast`/`playCard`), so those choke points now search
//    every player's exile for the granted card instead of assuming the
//    caster's own.
//
// Shadow (CR 702.28) also ships here — Dauthi is the FIRST shadow creature —
// via a new `combatRegistry.ts` `EvasionRule` (the attacker-has-shadow half,
// attacker-keyed like Fear/Flying) plus a direct blocker-keyed check in
// `combat.ts::validateBlockerEligibility` (the reverse half — a shadow
// creature can't block a non-shadow attacker either — not expressible by the
// attacker-keyed `EvasionRule` shape). See the `mechanicsRegistry.ts` "shadow"
// row for the split.
export const dauthiVoidwalker: CardDefinition = {
    id: "dce5db87-4a78-4b8d-b5c2-918ccd1ba4e3", // MH2 81
    name: "Dauthi Voidwalker",
    rarity: "rare",
    oracleText:
        "Shadow (This creature can block or be blocked by only creatures with shadow.)\nIf a card would be put into an opponent's graveyard from anywhere, exile it with a void counter on it instead.\n{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost. Activate only as a sorcery.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Dauthi", "Rogue"],
    power: 3,
    toughness: 2,
    staticAbilities: ["shadow"],
    replacementEffects: [
        {
            id: "dauthi-voidwalker-void-exile",
            oracleText:
                "If a card would be put into an opponent's graveyard from anywhere, exile it with a void counter on it instead.",
            eventKind: "graveyard-bound",
            appliesTo: (event, self) => {
                if (event.kind !== "graveyard-bound") return false;
                // CR 400.7 — "an opponent's graveyard": scoped to a card whose
                // OWNER (not necessarily controller) differs from Dauthi's
                // controller.
                return event.ownerId !== self.controllerId;
            },
            replace: (event) => {
                if (event.kind !== "graveyard-bound") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        destination: "exile",
                        tagCounters: { void: 1 },
                    },
                };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "dauthi-voidwalker-cast",
            oracleText:
                "{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost. Activate only as a sorcery.",
            cost: { tap: true, sacrifice: true },
            sorcerySpeedOnly: true,
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-exile-card",
                    player: "controller",
                    zoneOwnerId: "opponent",
                    zone: "exile",
                    filter: { hasCounter: { type: "void" } },
                    count: 1,
                    prompt: "Choose an exiled card your opponent owns with a void counter on it.",
                    bind: "$picked",
                },
                {
                    op: "grantCastFromExile",
                    card: { ref: "$picked" },
                    player: "controller",
                    window: "this-turn",
                    withoutPayingManaCost: true,
                    // CR 305.9 (issue #1689) — oracle says "you may PLAY it",
                    // land-inclusive (a void-countered card need not be a
                    // creature/artifact/planeswalker — any card redirected
                    // to exile by the replacement effect above qualifies).
                    includesLand: true,
                },
            ],
        },
    ],
};
