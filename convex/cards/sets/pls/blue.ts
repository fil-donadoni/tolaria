// PLS (Planeshift) — blue cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import {
    AURA_AFFECTS_HOST,
    BASIC_LAND_SUBTYPES,
    PERMANENT_TYPES,
} from "../../types";
import { chooseColorEffects } from "../../abilities/chooseColor";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Planar Overlay — {2}{U} Sorcery. "Each player chooses a land they control
// of each basic land type. Return those lands to their owners' hands." (CR
// 601.2b / 701.10, issue #1945, parent PRD #1935.) Symmetric —
// `forEach { set: "players" }` runs the clause once per side, in APNAP order
// (CR 101.4), each choosing among their OWN battlefield only (no player
// chooses for another). Per player, `chooseCategorized` offers the five
// basic land types as categories (`{ subtype: "Plains"|"Island"|"Swamp"|
// "Mountain"|"Forest" }`) over `zone: "battlefield"` (already public — no
// preceding `reveal`), `onPicked: "returnToHand"` bounces each nominated land
// via `SpellContext.returnToHand` (CR 701.10); no `sweep` — the Oracle text
// never mentions the unpicked lands, so they are left exactly where they
// are. A land with several basic land types may be chosen as EACH of those
// types with the same physical nomination — Gatherer: "If you have a land
// which counts as multiple land types, you can choose that land as each of
// those types. For example, a dual land could be chosen as two of your land
// types." So a player controlling a Plains and a Tundra may return the
// Tundra ALONE; the pick runs `categorizedPick.ts`'s COVER rule (every
// non-empty type answered, no gratuitous extra) with its floor at the
// smallest covering set, never the maximum matching, which would have forced
// two lands back. Categories are read through the layer pipeline via
// `getBattlefieldIds`; a type with no matching land is simply not filled (CR
// 608.2b). Mandatory ("chooses", not "may choose") — `optional` defaults to
// false.
export const planarOverlay: CardDefinition = {
    id: "1315fef0-234e-44f5-a7a3-bf3db78943c3", // PLS 28
    name: "Planar Overlay",
    rarity: "rare",
    oracleText:
        "Each player chooses a land they control of each basic land type. Return those lands to their owners' hands.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "chooseCategorized",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    categories: [
                        { label: "Plains", filter: { subtype: "Plains" } },
                        { label: "Island", filter: { subtype: "Island" } },
                        { label: "Swamp", filter: { subtype: "Swamp" } },
                        { label: "Mountain", filter: { subtype: "Mountain" } },
                        { label: "Forest", filter: { subtype: "Forest" } },
                    ],
                    onPicked: "returnToHand",
                    prompt: "Choose a land of each basic land type to return to hand.",
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (parent PRD #1935, issue #1949) — reuse-only cards, every
// clause enforced with already-shipped Ops/keywords.
// ─────────────────────────────────────────────────────────────────────────

// Allied Strategies — {4}{U} Sorcery. "Domain — Target player draws a card
// for each basic land type among lands they control." (CR 702 preamble
// Domain ability word, CR 121.1 draw.) The `{ domain: { of } }` EffectValue's
// `of` selector is a PLAYER ref, so the announced target itself (`{ target:
// 0 }`) drives BOTH the draw's player and the Domain count — no separate
// wiring needed. Ability words carry no rules text of their own (CR 207.2c),
// so "Domain" is not declared in `staticAbilities[]`.
export const alliedStrategies: CardDefinition = {
    id: "51d4f211-10e8-486d-b982-287ab0c060c9", // PLS 20
    name: "Allied Strategies",
    rarity: "uncommon",
    oracleText:
        "Domain — Target player draws a card for each basic land type among lands they control.",
    manaCost: { X: 4, U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "draw",
            player: { target: 0 },
            count: { domain: { of: { target: 0 } } },
        },
    ],
};

// Arctic Merfolk — {1}{U} Creature — Merfolk, 1/1. "Kicker—Return a creature
// you control to its owner's hand.\nIf this creature was kicked, it enters
// with a +1/+1 counter on it." (CR 702.33a Kicker with a PERMANENT leg — the
// plural-Kicker framework's `KickerCost.permanent` (`action: "return"`),
// ADR 0079, unblocked by #1937. `SacrificeSelection.playerId` scopes the
// return leg to the CASTER's own battlefield, so a bare `{ types: "Creature"
// }` filter already means "a creature you control" — no `controller` field
// needed on a cost-leg `PermanentFilter`. The Kicker is single (non-multi),
// so `count: "kicker"` on `entersWith.counters` (0 or 1, CR 702.33e) is the
// exact Pincer Spider / Llanowar Elite template, `inv/green.ts`.)
export const arcticMerfolk: CardDefinition = {
    id: "86369fe5-d86d-4f4c-8f3d-dedc174f2032", // PLS 21
    rarity: "common",
    name: "Arctic Merfolk",
    oracleText:
        "Kicker—Return a creature you control to its owner's hand. (You may return a creature you control to its owner's hand in addition to any other costs as you cast this spell.)\nIf this creature was kicked, it enters with a +1/+1 counter on it.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "kicker",
            description:
                "Kicker—Return a creature you control to its owner's hand",
            permanent: {
                action: "return",
                filter: { types: "Creature" },
                count: 1,
            },
        },
    ],
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
};

// Dralnu's Pet — {1}{U}{U} Creature — Shapeshifter, 2/2. "Kicker—{2}{B},
// Discard a creature card.\nIf this creature was kicked, it enters with
// flying and with X +1/+1 counters on it, where X is the discarded card's
// mana value." STOP-AND-ISSUE (gre-development.md § DSL-first authoring):
// the Kicker's mana+discard cost is payable today (`KickerCost.hand`,
// `gre/kicker.ts`, wired into the cast pipeline), but paying it discards the
// chosen card with NO snapshot of which card paid it — unlike the card's own
// additional-sacrifice cost, which DOES snapshot mana value onto the
// resulting `StackItem` (`additionalSacrificeSnapshot`). There is no
// EffectValue / `entersWith.counters` shape that can read "the mana value of
// the card discarded to pay this Kicker's hand leg" — `entersWith.counters[
// ].count` only accepts `number | "X" | "kicker"`, no dynamic per-instance
// read. This is a genuine missing engine capability (a StackItem snapshot),
// not an Op-wiring gap, so it is NOT a `resolve()` case ("the Op I need
// doesn't exist yet" is not a valid resolve() justification) — left as a
// tracked stub. tracked-by: #2008
// export const dralnusPet: CardDefinition = {
//     id: "cd5f4daf-7b54-4425-a93a-19532dfb83ca", // PLS 23
//     name: "Dralnu's Pet",
//     rarity: "rare",
//     manaCost: { X: 1, U: 2 },
//     types: ["Creature"],
//     subtypes: ["Shapeshifter"],
//     power: 2,
//     toughness: 2,
// };

// Escape Routes — {2}{U} Enchantment. "{2}{U}: Return target white or black
// creature you control to its owner's hand." (CR 701.10 bounce via the
// target-shape `moveZone` Op.)
export const escapeRoutes: CardDefinition = {
    id: "dbc9062e-ddd9-41ac-a88a-33f5a7b22103", // PLS 25
    rarity: "common",
    name: "Escape Routes",
    oracleText:
        "{2}{U}: Return target white or black creature you control to its owner's hand.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "escape-routes-bounce",
            oracleText:
                "{2}{U}: Return target white or black creature you control to its owner's hand.",
            cost: { mana: { X: 2, U: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["W", "B"],
                controller: "you",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Gainsay — {1}{U} Instant. "Counter target blue spell." (CR 701.5a counter,
// `colorFilter` restricting the stack-spell target to blue.)
export const gainsay: CardDefinition = {
    id: "a70a2092-5048-49c0-9351-a3f882c2f56e", // PLS 26
    rarity: "uncommon",
    name: "Gainsay",
    oracleText: "Counter target blue spell.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1, colorFilter: "U" },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Hunting Drake — {4}{U} Creature — Drake, 2/2. "Flying\nWhen this creature
// enters, put target red or green creature on top of its owner's library."
// (CR 702.9b flying; CR 603.6a ETB; CR 603.3d announcement-time target on
// the `enteredTrigger` factory, issue #1193; `moveZone` to `"library"` with
// no `position` puts the permanent on TOP by default, issue #1726.)
export const huntingDrake: CardDefinition = {
    id: "5b0293a9-48fe-4018-bd25-3e02c227a3dd", // PLS 27
    rarity: "common",
    name: "Hunting Drake",
    oracleText:
        "Flying\nWhen this creature enters, put target red or green creature on top of its owner's library.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "hunting-drake-etb",
            oracleText:
                "When this creature enters, put target red or green creature on top of its owner's library.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["R", "G"],
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "library" }],
        }),
    ],
};

// Planeswalker's Mischief — {2}{U} Enchantment. "{3}{U}: Target opponent
// reveals a card at random from their hand. If it's an instant or sorcery
// card, exile it. You may cast it without paying its mana cost for as long
// as it remains exiled. At the beginning of the next end step, if you
// haven't cast it, return it to its owner's hand. Activate only as a
// sorcery." (CR 701.20a public reveal, CR 701.13 exile, CR 601.3e temporary
// cast permission, CR 603.7a delayed trigger.)
//
// protocol card (gre-development.md § DSL-first authoring): a PUBLIC
// "reveal a card at random from hand" has no Op skin — only the PRIVATE
// sibling `lookRandomHand` (a single-knower look) is wired into the
// interpreter; `SpellContext.revealRandomHandCard` (the public primitive
// this card needs) has no DSL wrapper. tracked-by: #2004 (opened for
// Planeswalker's Scorn, the black member of this same "Planeswalker's ___"
// cycle — the Op this card needs is the identical gap). The exile →
// grant-cast → conditional-return sequence composes `revealRandomHandCard` +
// `moveCardById` + `grantCastFromExile` + a legacy `delayedTriggers[]`
// template exactly like the established Elkin Bottle / Ice Cauldron /
// Robber of the Rich precedent (`ice/colorless.ts`, `eld/red.ts`) — no Op
// wraps that composition either, and it is the SAME "no Op skin, protocol"
// shape those cards already carry, not a novel imperative invention.
// `grantCastFromExile`'s `"until-next-end-step"` window (issue #1557)
// already expires the CAST PERMISSION at the right boundary; it does not
// itself return the card (most impulse-cast cards intentionally leave the
// card exiled forever), so the delayed trigger below adds the RETURN this
// card's Oracle text uniquely asks for, gated on the card still sitting in
// exile (i.e. "if you haven't cast it") via `getExileCardOwner`.
export const planeswalkersMischief: CardDefinition = {
    id: "79aa232c-3f16-4c68-99dc-09a7aeef477b", // PLS 29
    rarity: "rare",
    name: "Planeswalker's Mischief",
    oracleText:
        "{3}{U}: Target opponent reveals a card at random from their hand. If it's an instant or sorcery card, exile it. You may cast it without paying its mana cost for as long as it remains exiled. At the beginning of the next end step, if you haven't cast it, return it to its owner's hand. Activate only as a sorcery.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "planeswalkers-mischief-reveal",
            oracleText:
                "{3}{U}: Target opponent reveals a card at random from their hand. If it's an instant or sorcery card, exile it. You may cast it without paying its mana cost for as long as it remains exiled. At the beginning of the next end step, if you haven't cast it, return it to its owner's hand. Activate only as a sorcery.",
            cost: { mana: { X: 3, U: 1 } },
            useStack: true,
            sorcerySpeedOnly: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx) => {
                const opponent = ctx.targets[0];
                if (!opponent || opponent.type !== "player") return;
                const opponentId = opponent.id;
                const cardId = ctx.revealRandomHandCard(opponentId);
                if (cardId === undefined) return; // empty hand, CR 608.2b
                const revealed = ctx
                    .getHandCards(opponentId)
                    .find((c) => c.id === cardId);
                const isInstantOrSorcery =
                    revealed?.types.some(
                        (t) => t === "Instant" || t === "Sorcery"
                    ) ?? false;
                if (!isInstantOrSorcery) return; // Oracle only exiles instant/sorcery
                ctx.moveCardById(opponentId, cardId, "hand", "exile");
                ctx.grantCastFromExile(
                    cardId,
                    ctx.controller,
                    opponentId,
                    "until-next-end-step",
                    { withoutPayingManaCost: true }
                );
                ctx.scheduleDelayedTrigger(
                    ctx.sourceCardId,
                    "planeswalkers-mischief-return",
                    "next-end-step",
                    { cardId, ownerId: opponentId }
                );
            },
            // aiEffects (PRD #1423, issue #1519) — bare `resolve()` closure
            // (no Op skin for the public random-hand-reveal primitive, see
            // the card-level protocol note), so the bot's value model has
            // nothing to walk without a shadow script. `reveal` with no
            // `cards` (a whole-hand reveal) targeting the announced opponent
            // is the closest already-exercised, structurally valid Op for
            // an information-disruption effect against that player's hand —
            // a loose analogue, not a mechanical match, mirroring how Inti's
            // own shadow (`digToHand`, `lci/red.ts`) stands in for a
            // differently-shaped impulse effect.
            aiEffects: [{ op: "reveal", player: { target: 0 }, zone: "hand" }],
        },
    ],
    delayedTriggers: [
        {
            id: "planeswalkers-mischief-return",
            oracleText:
                "At the beginning of the next end step, if you haven't cast it, return it to its owner's hand.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const cardId = payload.cardId;
                const ownerId = payload.ownerId;
                if (!cardId || !ownerId) return;
                // Still in exile ⇒ never cast (CR 608.2b) — a cast card has
                // already left exile for the stack, so this is a no-op then.
                if (ctx.getExileCardOwner(cardId) === undefined) return;
                ctx.moveCardById(ownerId, cardId, "exile", "hand");
            },
            // aiEffects (PRD #1423, issue #1519, MINOR 7 of PR #2010's
            // review): `delayedTriggers[]` is a bare `resolve()` body with no
            // Op skin either (same protocol note as the scheduling ability
            // above). Its own incremental value for the bot's search is near
            // zero either way — reaching this step means the exiled card was
            // never cast, i.e. the opportunity the FIRST ability's own
            // `aiEffects` already values is already gone; giving the card
            // back merely restores the status quo. `amount: 0` is an honest
            // near-neutral placeholder, not a real valuation.
            aiEffects: [{ op: "gainLife", player: "controller", amount: 0 }],
        },
    ],
};

// Rushing River — {2}{U} Instant. "Kicker—Sacrifice a land.\nReturn target
// nonland permanent to its owner's hand. If this spell was kicked, return
// another target nonland permanent to its owner's hand." (CR 702.33a Kicker
// with a PERMANENT leg — a sacrifice, `KickerCost.permanent.action:
// "sacrifice"`, ADR 0079/#1937 — the same shape as Arctic Merfolk's return
// leg above, just the other action.) The kick is ADDITIVE (2 targets instead
// of 1), not a widened filter, so `kickedTargetRequirement` bumps `count`
// only; `forEach { set: "targets" }` (the Distorting Wake / #1083
// X-multi-target shape, `inv/blue.ts`) then bounces WHICHEVER targets were
// actually announced — 1 unkicked, 2 kicked — with one Op, no runtime
// kicker-count branch needed.
export const rushingRiver: CardDefinition = {
    id: "52ddf7bf-de9c-4657-8d5b-79869d36fa63", // PLS 30
    rarity: "common",
    name: "Rushing River",
    oracleText:
        "Kicker—Sacrifice a land. (You may sacrifice a land in addition to any other costs as you cast this spell.)\nReturn target nonland permanent to its owner's hand. If this spell was kicked, return another target nonland permanent to its owner's hand.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice a land",
            permanent: {
                action: "sacrifice",
                filter: { types: "Land" },
                count: 1,
            },
        },
    ],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        excludeTypes: "Land",
    },
    kickedTargetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 2,
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

// Sea Snidd — {4}{U} Creature — Beast, 3/3. "{T}: Target land becomes the
// basic land type of your choice until end of turn." (CR 305.7 layer-4
// land-type change via the `setSubtype` Op over `SpellContext.
// setSubtypesUntil`; the "choose the basic land type" half reuses the
// pre-existing `optionChoice` Op, one mode per `BASIC_LAND_SUBTYPES` entry —
// the EXACT Dream Thrush template, `inv/blue.ts`, just without flying and at
// this card's own cost/stats.)
export const seaSnidd: CardDefinition = {
    id: "ca11015e-200b-488c-8bf5-662dcc03cd2d", // PLS 31
    rarity: "common",
    name: "Sea Snidd",
    oracleText:
        "{T}: Target land becomes the basic land type of your choice until end of turn.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "sea-snidd-land-type",
            oracleText:
                "{T}: Target land becomes the basic land type of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a basic land type (Sea Snidd).",
                    modes: BASIC_LAND_SUBTYPES.map((subtype) => ({
                        id: subtype,
                        label: subtype,
                        effects: [
                            {
                                op: "setSubtype" as const,
                                target: { target: 0 },
                                subtypes: [subtype],
                                duration: { phase: "end-of-turn" as const },
                            },
                        ],
                    })),
                },
            ],
        },
    ],
};

// Shifting Sky — {2}{U} Enchantment. "As this enchantment enters, choose a
// color.\nAll nonland permanents are the chosen color." STOP-AND-ISSUE
// (gre-development.md § DSL-first authoring): the "choose a color as it
// enters" half is free (the existing modal-choice machinery, `chosenModeId`
// — the exact Psychic Allergy shape, `drk/blue.ts`), but "all nonland
// permanents ARE the chosen color" is a layer-5 color REPLACEMENT
// (Gatherer: this changes colors, it doesn't add one) applied BOARD-WIDE and
// continuously — no such static effect kind exists. The layer system has a
// layer-5 color GRANT (`StaticColorGrant`, additive) and a layer-4 subtype
// SET with both fixed and per-source-computed forms (`StaticSubtypeSet`,
// ADR 0050), but no layer-5 color-SET sibling. This is a new continuous
// STATIC EFFECT KIND (types.ts + two state.ts materialization passes +
// layers.ts), not a card-shaped `resolve()` gap — a `resolve()` closure
// cannot express a continuous effect that must keep applying to permanents
// that enter LATER. tracked-by: #2009
// export const shiftingSky: CardDefinition = {
//     id: "1071726d-48f0-46d6-802b-dd9589489580", // PLS 32
//     name: "Shifting Sky",
//     rarity: "uncommon",
//     manaCost: { X: 2, U: 1 },
//     types: ["Enchantment"],
// };

// Sisay's Ingenuity — {U} Enchantment — Aura. "Enchant creature.\nWhen this
// Aura enters, draw a card.\nEnchanted creature has '{2}{U}: Target creature
// becomes the color of your choice until end of turn.'" (CR 303.4 Aura; CR
// 603.6a self-ETB cantrip, the Coveted Jewel `enteredTrigger` template,
// `c18/colorless.ts`; CR 611.2c layer-6 `activated-grant` — the Mystic Might
// template, `ice/blue.ts` — granting a `grantTemplates[]` ability to the
// host via `AURA_AFFECTS_HOST`. The granted ability's own body reuses
// `chooseColorEffects` — the SAME `setColor` Op + `optionChoice` "choose one
// of five colors" composition Blind Seer already uses, `inv/blue.ts`.)
export const sisaysIngenuity: CardDefinition = {
    id: "bbe20cc1-621a-4813-9bbb-ace006e173ff", // PLS 33
    rarity: "common",
    name: "Sisay's Ingenuity",
    oracleText:
        'Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature has "{2}{U}: Target creature becomes the color of your choice until end of turn."',
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "sisays-ingenuity-etb-draw",
            oracleText: "When this Aura enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "sisays-ingenuity-color",
        },
    ],
    grantTemplates: [
        {
            id: "sisays-ingenuity-color",
            oracleText:
                "{2}{U}: Target creature becomes the color of your choice until end of turn.",
            cost: { mana: { X: 2, U: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: chooseColorEffects(
                { target: 0 },
                { phase: "end-of-turn" },
                "Choose a color (Sisay's Ingenuity)."
            ),
        },
    ],
};

// Sleeping Potion — {1}{U} Enchantment — Aura. "Enchant creature.\nWhen this
// Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap
// during its controller's untap step.\nWhen enchanted creature becomes the
// target of a spell or ability, sacrifice this Aura." (CR 303.4 Aura; CR
// 502.1 untap-lock via `keyword-grant`'ing the engine-internal
// "does-not-untap" marker to the host — the exact Venarian Gold template,
// `leg/blue.ts`, minus its counter-gating (this lock is unconditional); CR
// 603.2b/115.5 `BECAME_TARGET` — the Phantasmal Image self-sacrifice
// template, `m12/blue.ts`, re-keyed to the AURA'S HOST via `self.attachedTo`
// instead of `self.id`.)
//
// The ETB "tap enchanted creature" trigger stays `resolve()`: NOT
// DSL-migratable (ADR 0045) — there is no attached-host `EffectObjectSelector`
// in the DSL (only announced target slots, `$source`, `$each`), the exact,
// already-established gap Venarian Gold's own ETB trigger documents (leaving
// it unticketed there was the PR #2010 review's MINOR 6 finding).
// tracked-by: #2016.
export const sleepingPotion: CardDefinition = {
    id: "6f79f4b2-71cd-4f78-a161-d75b162c745e", // PLS 34
    rarity: "common",
    name: "Sleeping Potion",
    oracleText:
        "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step.\nWhen enchanted creature becomes the target of a spell or ability, sacrifice this Aura.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "does-not-untap",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "sleeping-potion-etb-tap",
            oracleText: "When this Aura enters, tap enchanted creature.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.tap({ type: "permanent", id: hostId });
            },
            // aiEffects (PRD #1423, issue #1519) — bare `resolve()` closure
            // (no attached-host `EffectObjectSelector` exists to express
            // "tap enchanted creature" declaratively, see the card-level
            // note), so the bot's value model has nothing to walk without a
            // shadow script. The one-time tap-down's own value is minor next
            // to the CONTINUOUS "doesn't untap" lock (a real `staticEffects[]`
            // entry, already walkable on its own) — `{ ref: "$source" }`
            // (tapping the Aura itself, always legal, always near-zero
            // impact) is an honest low-value stand-in rather than a
            // fabricated host reference the interpreter would never resolve.
            aiEffects: [
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
            ],
        }),
        {
            id: "sleeping-potion-sacrifice",
            oracleText:
                "When enchanted creature becomes the target of a spell or ability, sacrifice this Aura.",
            event: "BECAME_TARGET",
            matches: (event, self) =>
                event.type === "BECAME_TARGET" &&
                event.target.type === "permanent" &&
                !!self.attachedTo &&
                event.target.id === self.attachedTo,
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        },
    ],
};

// Stormscape Battlemage — {2}{U} Creature — Metathran Wizard, 2/2. "Kicker
// {W} and/or {2}{B}\nWhen this creature enters, if it was kicked with its
// {W} kicker, you gain 3 life.\nWhen this creature enters, if it was kicked
// with its {2}{B} kicker, destroy target nonblack creature. That creature
// can't be regenerated." (CR 702.33a "Kicker {A} and/or {B}" — TWO
// independently-payable Kickers, ADR 0079/#1937's flagship shape, each with
// its own `{ kickerPaid: "<id>" }` intervening-if — the EXACT Thunderscape
// Battlemage template (`pls/red.ts`, issue #1951/PR #2005), the cycle's
// first-landed sibling.)
//
// Each trigger's `targetRequirement` is announced when the creature enters
// REGARDLESS of which Kicker(s) were paid — there is no per-Kicker check-time
// predicate reachable before the ability hits the stack (only the aggregate
// `wasKicked` boolean is, `PermanentView.wasKicked`'s own doc); the `if {
// kickerPaid }` gate inside `effects[]` then no-ops the UNPAID trigger at
// resolution. This is the ADR-documented shape (ADR 0079: "a new frozen
// Effect Script value `{ kickerPaid: "<id>" }` answers the Battlemages'
// per-kicker intervening-ifs") — a target is still requested for a trigger
// that may resolve to nothing, the accepted divergence from a literal CR
// 603.4d "never hits the stack" intervening-if. `{ kickerPaid }` reads
// `ctx.getKickerPaidCount()` off the RESOLVING stack item's own
// `kickerPayments` (`StackItem.kickerPayments`, a properly TYPED, and —
// while the item sits on the stack — SERIALIZED field, `serialize.ts`'s
// `compactStackItem`) — `buildTriggerItem` (`gre/triggers.ts`) spreads the
// entering permanent's fields onto each new triggered-ability stack item it
// raises, carrying `kickerPayments` along without any card-level cast. No
// `conditionOnSelf`/raw-field read needed here — an earlier draft of this
// card gated the black-kicker trigger's ANNOUNCEMENT with `conditionOnSelf`
// reading an untyped stray `kickerPayments` off `PermanentView`, which PR
// #2010's review (MAJOR 3) flagged as relying on a field not yet promoted to
// a typed, serialized one (tracked-by #2014) — this shape sidesteps that
// gap entirely by reading the value the same way every other Kicker card's
// `{ kickerCount }`/`{ kickerPaid }` intervening-if already does.
export const stormscapeBattlemage: CardDefinition = {
    id: "7d46a39d-c6f4-4281-b31f-f0a0c9fba887", // PLS 35
    rarity: "uncommon",
    name: "Stormscape Battlemage",
    oracleText:
        "Kicker {W} and/or {2}{B} (You may pay an additional {W} and/or {2}{B} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {W} kicker, you gain 3 life.\nWhen this creature enters, if it was kicked with its {2}{B} kicker, destroy target nonblack creature. That creature can't be regenerated.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Metathran", "Wizard"],
    power: 2,
    toughness: 2,
    kickers: [
        { id: "kicker-w", description: "Kicker {W}", mana: { W: 1 } },
        // The SECOND leg of "Kicker {W} and/or {2}{B}" keeps the CANONICAL
        // "Kicker {cost}" description — the cast-cost dialog's per-Kicker
        // toggle renders `description` verbatim (`CastCostKickerField`), so
        // it must read "Pay Kicker {2}{B}", not a bare "Pay {2}{B}", for the
        // toggle to be legible standalone. The catalogue-wide
        // description-matches-Oracle guard (`kickerDeclarations.test.ts`)
        // checks a non-first mana-only kicker's cost PORTION (stripped of
        // its own "Kicker " prefix) as a substring of the combined "and/or"
        // Oracle line, not as a literal prefix of the whole line.
        { id: "kicker-b", description: "Kicker {2}{B}", mana: { X: 2, B: 1 } },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "stormscape-battlemage-white-kicker",
            oracleText:
                "When this creature enters, if it was kicked with its {W} kicker, you gain 3 life.",
            scope: "self",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-w" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 3 }],
                },
            ],
        }),
        enteredTrigger({
            id: "stormscape-battlemage-black-kicker",
            oracleText:
                "When this creature enters, if it was kicked with its {2}{B} kicker, destroy target nonblack creature. That creature can't be regenerated.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeColors: "B",
            },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-b" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "destroy",
                            target: { target: 0 },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
        }),
    ],
};

// Stormscape Familiar — {1}{U} Creature — Bird, 1/1. "Flying\nWhite spells
// and black spells you cast cost {1} less to cast." (CR 702.9b flying; CR
// 601.2f cost reduction via `cost-modifier`, the exact Multicolored-spells /
// Instant-and-enchantment cost-reducer template — `inv/colorless.ts` /
// `leg/colorless.ts` — restricted to the caster's OWN spells and to EITHER
// of two colours via `.some`.)
export const stormscapeFamiliar: CardDefinition = {
    id: "4c831c42-77a0-4f4f-9628-ad630541cf66", // PLS 36
    rarity: "common",
    name: "Stormscape Familiar",
    oracleText:
        "Flying\nWhite spells and black spells you cast cost {1} less to cast.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                !!effectSource &&
                card.controllerId === effectSource.controllerId &&
                ctx.getColors(card).some((c) => c === "W" || c === "B"),
            costReduction: { X: 1 },
        },
    ],
};

// Sunken Hope — {3}{U}{U} Enchantment. "At the beginning of each player's
// upkeep, that player returns a creature they control to its owner's hand."
// (CR 603.6a each-player upkeep trigger, `scope: "each"` reading the firing
// player off `{ ref: "$event.activePlayerId" }` — issue #1066/ADR 0049, the
// Mana Vortex "each player sacrifices a land of their choice" template,
// `drk/blue.ts` — with a mandatory `choose-permanents` pick over the firing
// player's OWN battlefield creatures, then a `forEach` bounce of the single
// bound pick — the Teferi, Hero of Dominaria "+1" delayed-body template,
// `dom/multicolor.ts`, reused for an immediate effect body instead of an
// inline delayed one.)
export const sunkenHope: CardDefinition = {
    id: "5f12ac0c-cfe6-4f08-b6df-20be4ce83e8c", // PLS 37
    rarity: "rare",
    name: "Sunken Hope",
    oracleText:
        "At the beginning of each player's upkeep, that player returns a creature they control to its owner's hand.",
    manaCost: { X: 3, U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "sunken-hope-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, that player returns a creature they control to its owner's hand.",
            phase: "UPKEEP",
            scope: "each",
            effects: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Sunken Hope: return a creature you control to its owner's hand.",
                    bind: "$creature",
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$creature" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "hand",
                        },
                    ],
                },
            ],
        }),
    ],
};
