// PLS (Planeshift) — black cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import {
    kickerPaidCondition,
    kickerPaidInterveningIf,
} from "../../abilities/triggers/shared";

// Warped Devotion — {2}{B} Enchantment. "Whenever a permanent is returned to
// a player's hand, that player discards a card." (CR 603.2 triggered
// ability; issue #1940, parent PRD #1935.) `PERMANENT_LEFT` (CR 603.10)
// already IS the battlefield-departure event — it's emitted for every
// battlefield→(graveyard|exile|hand|library) transition and already carries
// `toZone` and `ownerId` — so a bounce to hand is just
// `leftTrigger({ toZone: "hand" })`; no dedicated event was needed (ADR 0001
// assigns one event per zone of ORIGIN — the battlefield — not one per
// destination). `scope: "any"` makes it fire symmetrically on EITHER
// player's bounce (Warped Devotion says "a permanent", not "a permanent you
// control"), and the discarding player is read off the LEAVING permanent's
// owner (CR 108.3 — always returned to the owner's hand) via a new
// `EVENT_FIELD_REGISTRY` row (`PERMANENT_LEFT.ownerId`, ADR 0049) —
// `{ ref: "$event.ownerId" }` — rather than `ctx.controller`, since the
// discarding player need not be this ability's own controller. That keeps
// the ability a pure Effect Script — no `resolve()` needed. The discard is
// the discarding player's own choice (`choice(kind: "choose-hand-card")`),
// never engine-auto-picked, per the project's sacrifice/discard-choice
// convention; an empty hand clamps the choice to zero candidates (CR
// 608.2b) and the ability quietly does nothing, matching "discard a card"
// against no cards to discard.
//
// Divergence from the issue spec (owner-arbitrated): #1940's original text
// assumed no engine event covered "returned to hand" and asked for a new
// `PERMANENT_RETURNED_TO_HAND` event. Review read `gre/state.ts` and found
// `PERMANENT_LEFT` already covers exactly this case (it already fires with
// `toZone: "hand"` and already carries `ownerId`); the new event would have
// been strictly weaker (no `cause` / `causerControllerId` / `wasAura` /
// LKI attachment fields) and created a latent double-fire trap for any
// future card whose ability listens for both events. This ships as a
// `leftTrigger` reuse plus the one missing `ownerId` field row instead.
export const warpedDevotion: CardDefinition = {
    id: "3bce620f-799a-4ad8-9edb-6fb3d9ea1cc6", // PLS 57
    name: "Warped Devotion",
    rarity: "uncommon",
    oracleText:
        "Whenever a permanent is returned to a player's hand, that player discards a card.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        leftTrigger({
            id: "warped-devotion-bounce",
            oracleText:
                "Whenever a permanent is returned to a player's hand, that player discards a card.",
            scope: "any",
            toZone: "hand",
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$event.ownerId" },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: { ref: "$event.ownerId" },
                    cards: { ref: "$discard" },
                },
            ],
        }),
    ],
};

// Noxious Vapors — {1}{B}{B} Sorcery. "Each player reveals their hand,
// chooses one card of each color from it, then discards all other nonland
// cards." (CR 601.2b / 701.9, issue #1945, parent PRD #1935.) Symmetric —
// every clause runs once per side, in APNAP order (CR 101.4), each acting on
// their OWN hand only.
//
// TWO sibling `forEach { set: "players" }` blocks, not one, because the
// Oracle sequencing is "each player reveals their hand, [then] chooses …":
// ALL reveals precede ANY choice. Folding them into one loop would let the
// active player choose before the opponent's hand was revealed, deciding with
// less information than the card grants. The first loop only reveals (CR
// 701.20a); the second raises the per-player pick. Splitting is safe across
// the suspend/resume protocol precisely because the interpreter checkpoints
// each Op's own position — the reveal loop is not re-run when the choice loop
// suspends.
//
// The pick itself: `chooseCategorized` offers the five colours as categories
// (`{ color: "W"|"U"|"B"|"R"|"G" }`), `onPicked: "keep"` (a kept pick just
// survives — no move), and `sweep` discards every OTHER nonland card
// (`excludeType: "Land"` — deliberately BROADER than the categorization
// domain: a colourless nonland card matches no colour category, so it can
// never be picked, yet it is still swept; a land is never swept even if
// uncategorized). One card may be the card chosen for SEVERAL of its colours
// — a WU gold card can answer both white and blue, keeping only it — so the
// pick is validated by `categorizedPick.ts`'s COVER rule and its floor is the
// smallest covering set, not the maximum matching. A colour with no matching
// card in hand is simply not filled (CR 608.2b). Mandatory ("chooses", not
// "may choose") — `optional` defaults to false.
export const noxiousVapors: CardDefinition = {
    id: "e3cf9326-6e1c-4a05-abea-16d6b6cb2a6d", // PLS 49
    name: "Noxious Vapors",
    rarity: "uncommon",
    oracleText:
        "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.",
    manaCost: { X: 1, B: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [{ op: "reveal", player: { ref: "$each" }, zone: "hand" }],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "chooseCategorized",
                    player: { ref: "$each" },
                    zone: "hand",
                    categories: [
                        { label: "White", filter: { color: "W" } },
                        { label: "Blue", filter: { color: "U" } },
                        { label: "Black", filter: { color: "B" } },
                        { label: "Red", filter: { color: "R" } },
                        { label: "Green", filter: { color: "G" } },
                    ],
                    onPicked: "keep",
                    sweep: {
                        filter: { excludeType: "Land" },
                        action: "discard",
                    },
                    prompt: "Choose one card of each color to keep.",
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (parent PRD #1935, issue #1950) — every card below is
// expressible with already-shipped Ops/keywords, per the issue's own scope
// statement. Two cards are commented stubs instead (Dark Suspicions,
// Planeswalker's Scorn) — see each one's own comment for the specific
// tracked gap; both are stop-and-issue cases per
// `.claude/rules/gre-development.md` § DSL-first authoring ("the Op I need
// doesn't exist yet" is explicitly not a valid `resolve()` justification).
// ─────────────────────────────────────────────────────────────────────────

// Bog Down — {2}{B} Sorcery. "Kicker—Sacrifice two lands. Target player
// discards two cards. If this spell was kicked, that player discards three
// cards instead." (CR 702.33a Kicker with a non-mana PERMANENT leg, ADR
// 0079.) The first Planeshift card to actually exercise a sacrifice-shaped
// Kicker leg — the framework itself (#1937) shipped with zero cards, and
// `kicker.test.ts`'s "Kicker — Sacrifice two lands" probe is this exact
// shape (`permanent: { action: "sacrifice", filter: { types: ["Land"] },
// count: 2 }`), proven through the real cast-commit path. WHICH two lands
// pay the cost is always the caster's own explicit choice, routed through
// the unified sacrificeChoice layer (never auto-picked) — the framework's
// own guarantee, not something this card re-implements. Single Kicker →
// `{ kickerCount: true }` (Hypnotic Cloud's identical "discards N instead"
// shape, `inv/black.ts`) rather than `{ kickerPaid: "kicker" }`; both read
// the same answer for a one-Kicker card, and `kickerCount` is the
// established idiom there.
//
// DIVERGENCE (issue #1950 review, MINOR 4) — "discards two/three cards" is a
// MANDATORY discard (CR 701.9a — up to hand size), but `count: { min: 0, max:
// N }` lets the targeted player submit zero cards even with a full hand. This
// copies the shipped Hypnotic Cloud idiom verbatim (`inv/black.ts`) — a
// pre-existing class defect, not introduced here. tracked-by: #2018
export const bogDown: CardDefinition = {
    id: "8752a605-38f8-4d75-b122-063a788dff6e", // PLS 39
    name: "Bog Down",
    rarity: "common",
    oracleText:
        "Kicker—Sacrifice two lands. (You may sacrifice two lands in addition to any other costs as you cast this spell.)\nTarget player discards two cards. If this spell was kicked, that player discards three cards instead.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice two lands",
            permanent: {
                action: "sacrifice",
                filter: { types: ["Land"] },
                count: 2,
            },
        },
    ],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: { min: 0, max: 3 },
                    prompt: "Discard three cards.",
                    bind: "$picked3",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked3" },
                },
            ],
            else: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: { min: 0, max: 2 },
                    prompt: "Discard two cards.",
                    bind: "$picked2",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked2" },
                },
            ],
        },
    ],
};

// Dark Suspicions — {2}{B}{B} Enchantment. "At the beginning of each
// opponent's upkeep, that player loses X life, where X is the number of
// cards in that player's hand minus the number of cards in your hand."
//
// STOP-AND-ISSUE (`.claude/rules/gre-development.md` § DSL-first authoring):
// this needs TWO Effect Script gaps together, neither of which exists today
// — (1) the `count` construct's `EffectCountSpec.zone` only counts
// `"battlefield" | "graveyard" | "library"` (`cards/types.ts`), not `"hand"`;
// (2) ADR 0045's frozen grammar has no arithmetic composition between two
// values ("no expressions" — a parameter is a literal, a `ref`, or a
// `count`, never `A - B` of two of those), and this card needs exactly that
// (opponent hand count MINUS caster hand count). Neither is an invented
// name to paper over — both are real, scoped gaps left for a deliberate
// design decision rather than a card-shaped `resolve()` ("the Op I need
// doesn't exist yet" is explicitly not a valid `resolve()` justification).
// tracked-by: #2006
// export const darkSuspicions: CardDefinition = {
//     id: "d518e2fd-7767-43d7-92e3-62a4a465154c", // PLS 40
//     name: "Dark Suspicions",
//     rarity: "rare",
//     manaCost: { X: 2, B: 2 },
//     types: ["Enchantment"],
// };

// Death Bomb — {3}{B} Instant. "As an additional cost to cast this spell,
// sacrifice a creature. Destroy target nonblack creature. It can't be
// regenerated. Its controller loses 2 life." (CR 601.2b/117.9 additional
// sacrifice cost via `additionalCosts.sacrificeFilter`, CR 701.7/701.15c
// destroy + can't-be-regenerated, CR 202.2 "nonblack" via `excludeColors`.)
// The life-loss reads the target's controller BEFORE the `destroy` Op runs
// — `{ controllerOf: { target: 0 } }` (`inv/multicolor.ts`'s precedent)
// resolves through `ctx.getController`, which throws once the permanent has
// actually left the battlefield; ordering the read first keeps the object
// live for it. Safe because the spell has exactly one target: CR 608.2b
// fizzles the whole spell if that single target is illegal at resolution,
// so by the time either Op runs the creature is guaranteed still in play.
export const deathBomb: CardDefinition = {
    id: "f8a84715-c5dc-4a19-af6a-796c6ee912c2", // PLS 41
    name: "Death Bomb",
    rarity: "common",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nDestroy target nonblack creature. It can't be regenerated. Its controller loses 2 life.",
    manaCost: { X: 3, B: 1 },
    types: ["Instant"],
    additionalCosts: { sacrificeFilter: { types: "Creature" } },
    targetRequirement: {
        type: "Creature",
        count: 1,
        excludeColors: "B",
    },
    effects: [
        {
            op: "loseLife",
            player: { controllerOf: { target: 0 } },
            amount: 2,
        },
        { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
    ],
};

// Diabolic Intent — {1}{B} Sorcery. "As an additional cost to cast this
// spell, sacrifice a creature. Search your library for a card, put that
// card into your hand, then shuffle." (CR 601.2b/117.9 additional sacrifice
// cost, CR 401.4 search.) The tutor body is Demonic Tutor's own effect body
// verbatim (`lea/black.ts`) — this card's only distinguishing clause is the
// additional cost.
export const diabolicIntent: CardDefinition = {
    id: "76d1b5c5-cc47-465f-8549-4fd1ca4280df", // PLS 42
    name: "Diabolic Intent",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a card, put that card into your hand, then shuffle.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    additionalCosts: { sacrificeFilter: { types: "Creature" } },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "hand",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Exotic Disease — {4}{B} Sorcery. "Domain — Target player loses X life and
// you gain X life, where X is the number of basic land types among lands
// you control." (CR 702 preamble Domain ability word, issue #1066's shipped
// `{ domain: { of } }` EffectValue — the exact shape Wandering Stream
// (`inv/green.ts`) already uses for "gain life for each basic land type".)
export const exoticDisease: CardDefinition = {
    id: "4e9624e5-79a2-41de-997b-12d871d4be66", // PLS 43
    name: "Exotic Disease",
    rarity: "uncommon",
    oracleText:
        "Domain — Target player loses X life and you gain X life, where X is the number of basic land types among lands you control.",
    manaCost: { X: 4, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "loseLife",
            player: { target: 0 },
            amount: { domain: { of: "controller" } },
        },
        {
            op: "gainLife",
            player: "controller",
            amount: { domain: { of: "controller" } },
        },
    ],
};

// Lord of the Undead — {1}{B}{B} Creature — Zombie, 2/2. "Other Zombie
// creatures get +1/+1. {1}{B}, {T}: Return target Zombie card from your
// graveyard to your hand." (CR 611 layer 7c Lord-style anthem, mirroring
// Lord of Atlantis's `pt-buff` shape exactly, `lea/blue.ts`; CR 400.7
// zone-change activated ability, mirroring Recover's plain graveyard target
// — `zone: "graveyard", controller: "you"` — `inv/black.ts`.)
export const lordOfTheUndead: CardDefinition = {
    id: "0a7f50f4-37a0-476e-8655-edba228aafd6", // PLS 44
    name: "Lord of the Undead",
    rarity: "rare",
    oracleText:
        "Other Zombie creatures get +1/+1.\n{1}{B}, {T}: Return target Zombie card from your graveyard to your hand.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Zombie"),
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "lord-of-the-undead-return",
            oracleText:
                "{1}{B}, {T}: Return target Zombie card from your graveyard to your hand.",
            cost: { mana: { X: 1, B: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
                subtypeFilter: "Zombie",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Maggot Carrier — {B} Creature — Zombie, 1/1. "When this creature enters,
// each player loses 1 life." (CR 603.6a self-ETB trigger; CR 119.3 life
// loss for every player via `forEach { set: "players" }` + `loseLife`,
// mirroring Noxious Vapors' own `forEach` reveal loop above.)
export const maggotCarrier: CardDefinition = {
    id: "ab2c3dc4-bb49-4ec3-a6c8-4256d1939326", // PLS 45
    name: "Maggot Carrier",
    rarity: "common",
    oracleText: "When this creature enters, each player loses 1 life.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "maggot-carrier-etb",
            oracleText: "When this creature enters, each player loses 1 life.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        { op: "loseLife", player: { ref: "$each" }, amount: 1 },
                    ],
                },
            ],
        }),
    ],
};

// Morgue Toad — {2}{B} Creature — Frog, 2/2. "Sacrifice this creature: Add
// {U}{R}." (CR 605.1a mana ability, sacrifice-self cost, NO tap component.)
//
// STOP-AND-ISSUE (issue #1950 review round 2, BLOCKER 3) — this is a genuine
// ENGINE BUG, not a card-data problem: neither mutation that can activate a
// mana ability correctly handles a cost that is sacrifice-only with no `{T}`.
// `tapUntap`'s redirect guard (`convex/game.ts`) only sends a `!cost.tap &&
// cost.mana` shape to `activateManaAbility`; a `!cost.tap && cost.sacrifice`
// shape (this card) falls through into `tapUntap`'s sacrifice branch, which
// looks up the produced mana via `getActivatedManaColor`/
// `getActivatedManaProduced` (`gre/constants.ts`) — BOTH of which require
// `cost.tap` to match at all — so it silently produces NO mana while still
// sacrificing the source. `activateManaAbility` explicitly REJECTS
// `cost.sacrifice` outright ("Use tapUntap for tap mana abilities"), so
// there is no working path today. Confirmed the SAME bug already affects the
// shipped Tinder Wall (`ice/green.ts`, "Sacrifice this creature: Add
// {R}{R}.") — Lotus Petal (`tmp/colorless.ts`) is NOT a counter-example,
// its cost is `{T}, Sacrifice...` (tap-based, sacrifice merely additional),
// which both functions already handle via the `cost.tap` branch. Left as a
// commented stub rather than shipped with a broken ability. tracked-by: #2021
// export const morgueToad: CardDefinition = {
//     id: "77d8ae73-70d1-4082-8581-5f74c1aaa63b", // PLS 46
//     name: "Morgue Toad",
//     rarity: "common",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Frog"],
//     power: 2,
//     toughness: 2,
// };

// Nightscape Battlemage — {2}{B} Creature — Zombie Wizard, 2/2. "Kicker
// {2}{U} and/or {2}{R}. When this creature enters, if it was kicked with
// its {2}{U} kicker, return up to two target nonblack creatures to their
// owners' hands. When this creature enters, if it was kicked with its
// {2}{R} kicker, destroy target land." (CR 702.33 plural Kicker, ADR 0079 —
// the Battlemage cycle's own headline shape: two INDEPENDENTLY payable
// Kickers, each with its own CR 603.4d intervening-if ETB trigger.)
//
// The per-Kicker gate is `kickerPaidCondition("<id>")` — the shared predicate
// over `PermanentView.kickerPayments` (issue #1950), the per-Kicker-id twin of
// the aggregate `wasKicked` boolean (`CardInstanceState.wasKicked`), which can
// only say "kicked at all", never WHICH of two. Declared BOTH as
// `conditionOnSelf` (fire-time — CR 603.4: an unmet condition means the
// ability never triggers at all, never even reaches the stack) AND as
// `kickerPaidInterveningIf` (the CR 603.4d resolution-time re-check) with the
// SAME predicate, exactly Ravenous's own two-leg pattern for a one-shot fact
// (`blc/white.ts`'s Jacked Rabbit) — the value cannot change between the two
// checks, but CR 603.4's fire-time gate is still real and observable (an
// unkicked cast never even prompts for the bounce/land target). This card
// wrote the predicate as a raw inline closure until issue #2015 extracted it,
// so all three shipped Battlemages share one gate (`conditionOnSelf` over
// `condition` so `withTriggerGate` stamps a DECIDED gate the bot can
// evaluate, issue #1936).
export const nightscapeBattlemage: CardDefinition = {
    id: "d5389643-4cc0-4a17-bc2d-7f9b76d30f9f", // PLS 47
    name: "Nightscape Battlemage",
    rarity: "uncommon",
    oracleText:
        "Kicker {2}{U} and/or {2}{R} (You may pay an additional {2}{U} and/or {2}{R} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {2}{U} kicker, return up to two target nonblack creatures to their owners' hands.\nWhen this creature enters, if it was kicked with its {2}{R} kicker, destroy target land.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Wizard"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "kicker-u",
            description: "Kicker {2}{U}",
            mana: { X: 2, U: 1 },
        },
        {
            id: "kicker-r",
            description: "Kicker {2}{R}",
            mana: { X: 2, R: 1 },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "nightscape-battlemage-bounce",
            oracleText:
                "When this creature enters, if it was kicked with its {2}{U} kicker, return up to two target nonblack creatures to their owners' hands.",
            scope: "self",
            conditionOnSelf: kickerPaidCondition("kicker-u"),
            interveningIf: kickerPaidInterveningIf("kicker-u"),
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 2 },
                excludeColors: "B",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "hand" },
                { op: "moveZone", target: { target: 1 }, to: "hand" },
            ],
        }),
        enteredTrigger({
            id: "nightscape-battlemage-destroy-land",
            oracleText:
                "When this creature enters, if it was kicked with its {2}{R} kicker, destroy target land.",
            scope: "self",
            conditionOnSelf: kickerPaidCondition("kicker-r"),
            interveningIf: kickerPaidInterveningIf("kicker-r"),
            targetRequirement: { type: "Land", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        }),
    ],
};

// Nightscape Familiar — {1}{B} Creature — Zombie, 1/1. "Blue spells and red
// spells you cast cost {1} less to cast. {1}{B}: Regenerate this creature."
// (CR 601.2f `cost-modifier` static effect, two-colour `appliesToSpell`
// filter — Derelor's single-colour shape (`fem/black.ts`) widened to an OR
// of two colours; CR 701.15/701.19 regenerate, Goham Djinn's `{1}{B}:
// Regenerate` shape, `inv/black.ts`.)
export const nightscapeFamiliar: CardDefinition = {
    id: "24fa6853-09b0-4c9f-a138-9dd005780255", // PLS 48
    name: "Nightscape Familiar",
    rarity: "common",
    oracleText:
        "Blue spells and red spells you cast cost {1} less to cast.\n{1}{B}: Regenerate this creature.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId &&
                (ctx.getColors(card).includes("U") ||
                    ctx.getColors(card).includes("R")),
            costReduction: { X: 1 },
        },
    ],
    activatedAbilities: [
        {
            id: "nightscape-familiar-regen",
            oracleText: "{1}{B}: Regenerate this creature.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Phyrexian Bloodstock — {4}{B} Creature — Phyrexian Zombie, 3/3. "When this
// creature leaves the battlefield, destroy target white creature. It can't
// be regenerated." (CR 603.10 leaves-the-battlefield trigger with a CR
// 603.3d announcement-time target — `leftTrigger`'s `targetRequirement`,
// added this issue (#1950) mirroring `EnteredTriggerArgs.targetRequirement`
// exactly: no leaves-trigger in the catalogue had needed one before this
// card. `scope: "self"`, no `toZone` filter — Bloodstock's own Oracle text
// has no destination restriction, unlike Warped Devotion above.)
export const phyrexianBloodstock: CardDefinition = {
    id: "785e1a67-af94-48e8-bb37-4999d1fb4c66", // PLS 50
    name: "Phyrexian Bloodstock",
    rarity: "common",
    oracleText:
        "When this creature leaves the battlefield, destroy target white creature. It can't be regenerated.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        leftTrigger({
            id: "phyrexian-bloodstock-ltb",
            oracleText:
                "When this creature leaves the battlefield, destroy target white creature. It can't be regenerated.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilter: "W",
            },
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                },
            ],
        }),
    ],
};

// Phyrexian Scuta — {3}{B} Creature — Phyrexian Zombie, 3/3. "Kicker—Pay 3
// life. If this creature was kicked, it enters with two +1/+1 counters on
// it." (CR 702.33a Kicker with a non-mana LIFE leg, ADR 0079 — the second
// leg PLS's own PRD names as a headline non-mana Kicker card, alongside Bog
// Down; `kicker.test.ts`'s "Kicker — LIFE leg" probe is this exact
// `life: 3` shape. CR 122.1/614.1c ETB counters via `entersWith`'s
// `count: "kicker"`, the Duskwalker shape (`inv/black.ts`) — TWO entries so
// the placement loop sums them to exactly 0 or 2.)
export const phyrexianScuta: CardDefinition = {
    id: "eb57e656-c94e-4cc2-ae8d-9300f51f941f", // PLS 51
    name: "Phyrexian Scuta",
    rarity: "rare",
    oracleText:
        "Kicker—Pay 3 life. (You may pay 3 life in addition to any other costs as you cast this spell.)\nIf this creature was kicked, it enters with two +1/+1 counters on it.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie"],
    power: 3,
    toughness: 3,
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Pay 3 life",
            life: 3,
        },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
};

// Planeswalker's Scorn — {2}{B} Enchantment. "{3}{B}: Target opponent
// reveals a card at random from their hand. Target creature gets -X/-X
// until end of turn, where X is the revealed card's mana value. Activate
// only as a sorcery."
//
// STOP-AND-ISSUE (`.claude/rules/gre-development.md` § DSL-first authoring):
// the engine has the underlying primitive
// (`SpellContext.revealRandomHandCard`, CR 701.20a public reveal, used today
// only from a `resolve()` closure in `tmp/colorless.ts`) but no Effect
// Script Op wraps it. The DSL's only random-hand-card Op is `lookRandomHand`
// — deliberately the PRIVATE CR 701.18a "look" sibling
// (`lookRandomHandCard`, known to the looker alone); using it here for a
// card whose Oracle text says "reveals" would be a silent CR/visibility
// violation, not a valid substitute, and it has no `bind` to read the
// picked card's mana value back afterward regardless. Left as a stub
// rather than a card-shaped `resolve()` ("the Op I need doesn't exist yet"
// is explicitly not a valid `resolve()` justification).
// tracked-by: #2004
// export const planeswalkersScorn: CardDefinition = {
//     id: "8ed08376-836f-4313-83d0-481895ead9da", // PLS 52
//     name: "Planeswalker's Scorn",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };

// Shriek of Dread — {1}{B} Instant. "Target creature gains fear until end
// of turn." (CR 702.14b fear, CR 611.1b temporary keyword grant via the
// shipped `grantAbility` Op — Hooded Kavu's own self-targeted shape
// (`inv/multicolor.ts`) with an announced target instead of `$source`.)
export const shriekOfDread: CardDefinition = {
    id: "54a7fb3b-8e81-4763-b2a1-7c2108a00afe", // PLS 53
    name: "Shriek of Dread",
    rarity: "common",
    oracleText: "Target creature gains fear until end of turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "grantAbility",
            ability: "fear",
            target: { target: 0 },
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Sinister Strength — {1}{B} Enchantment — Aura. "Enchant creature.
// Enchanted creature gets +3/+1 and is black." (CR 303.4 aura; CR 611 layer
// 7c pt-buff + layer 5 color-grant, both scoped via the shared
// `AURA_AFFECTS_HOST` predicate — Kormus Bell's own pt-cda + color-grant
// pairing, `lea/colorless.ts`, adapted to a per-instance `pt-buff` the way
// Unholy Strength does, `lea/black.ts`.)
//
// DIVERGENCE (issue #1950 review round 2, BLOCKER 1) — colour is ADDED, not
// SET (host keeps its printed colours). CR 613.1e / 105.2 make "is black" a
// layer-5 colour SET (replaces every other colour derivation outright); the
// engine's only layer-5 static effect today, `color-grant`
// (`gre/layers.ts`'s `STATIC_EFFECT_CTX.getColors`), is additive — it UNIONS
// the granted colour with the host's printed colours rather than replacing
// them. Reviewed and confirmed the additive shape DOMINATES dropping the
// grant entirely: on every interaction a bare +3/+1 (no grant at all) gets
// wrong (`excludeColors: "B"` — Death Bomb/Terror, this file and
// `lea/black.ts` — wrongly treats an enchanted non-black host as illegal;
// `colorFilter: "B"` wrongly treats it as an illegal "target black creature"
// target; protection from black wouldn't apply when it should), the additive
// grant gets it right too, while ALSO getting `colorFilter: "G"`
// (Slay, this file) wrong the same way a bare-hued host would (Slay destroys
// the green host under BOTH shapes — the additive grant does not make that
// interaction any worse). Ships the additive grant now; the colour-SET
// clause needs the CR 613.1e colour-SET static effect tracked by sibling
// issue #2009 ("[engine] Layer 5 color-SET continuous static effect
// (Shifting Sky)"). tracked-by: #2009
export const sinisterStrength: CardDefinition = {
    id: "afe487b8-c1ae-483d-bcd5-62c62b66a22e", // PLS 54
    name: "Sinister Strength",
    rarity: "common",
    oracleText: "Enchant creature\nEnchanted creature gets +3/+1 and is black.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 3,
            toughness: 1,
        },
        {
            kind: "color-grant",
            applies: AURA_AFFECTS_HOST,
            colors: ["B"],
        },
    ],
};

// Slay — {2}{B} Instant. "Destroy target green creature. It can't be
// regenerated. Draw a card." (CR 701.7/701.15c destroy + can't-be-
// regenerated — Terror's shape (`lea/black.ts`) with a positive
// `colorFilter: "G"` instead of `excludeColors`; CR 120.1 draw.)
export const slay: CardDefinition = {
    id: "eccda747-2680-4793-8a13-35e49b4de12f", // PLS 55
    name: "Slay",
    rarity: "uncommon",
    oracleText:
        "Destroy target green creature. It can't be regenerated.\nDraw a card.",
    manaCost: { X: 2, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, colorFilter: "G" },
    effects: [
        { op: "destroy", target: { target: 0 }, cantBeRegenerated: true },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Volcano Imp — {3}{B} Creature — Imp, 2/2. "Flying. {1}{R}: This creature
// gains first strike until end of turn." (CR 702.9b flying keyword; CR
// 611.1b temporary keyword grant via `grantAbility`, self-targeted through
// `$source` — the same shape as every other activated "gains X until end of
// turn" pump ability in the catalogue.)
export const volcanoImp: CardDefinition = {
    id: "a8281cc6-2132-4f76-841e-d1ade9cafb84", // PLS 56
    name: "Volcano Imp",
    rarity: "common",
    oracleText:
        "Flying\n{1}{R}: This creature gains first strike until end of turn.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "volcano-imp-first-strike",
            oracleText:
                "{1}{R}: This creature gains first strike until end of turn.",
            cost: { mana: { X: 1, R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
