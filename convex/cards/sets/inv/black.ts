// Invasion (INV) — black cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004); canonical names / costs /
// types are sourced from MTGJSON `data/json/INV.json`. Generic mana is
// encoded as `X: n` (e.g. {2}{B} → { X: 2, B: 1 }); a true variable {X} cost
// uses `X: "X"` (see Soul Burn's CardPrint below — its home definition lives
// in `sets/ice/black.ts`). Cards are classified by the colour identity of
// their mana cost (CR 202.2); the lone black-identity land (Swamp) lives in
// `colorless.ts` per the import-pipeline convention and is out of scope here.

// ═════════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#1071, parent PRD #1063) — 30 of the 38 mono-black
// Invasion cards active here:
//   • 24 new CardDefinitions + 1 CardPrint (Soul Burn, a reprint of the Ice
//     Age card already shipped) reuse only already-exercised Ops/keywords —
//     no hand-written test required (per-Op regime, ADR 0045/0046): the
//     catalogue-wide `validateEffectScript` sweep + the auto-generated
//     canned-scenario smoke test cover them.
//   • 5 cards (Annihilate, Phyrexian Reaper, Phyrexian Slayer, Spreading
//     Plague, Tsabo's Assassin) are `resolve()`, each with a recorded
//     justification — NOT an invented capability, but one of two
//     already-established architecture limits every such card in the
//     catalogue hits the same way:
//       (a) the DSL `destroy` Op has no `cantBeRegenerated` param (the
//           underlying `SpellContext.destroy` primitive fully supports it —
//           see Crumble/Detonate in atq/green.ts and atq/red.ts — but the Op
//           schema doesn't expose it). Widening the Op is a shared-file
//           change (`convex/cards/types.ts` + `interpreter.ts`) out of scope
//           for this single-colour, file-scoped tranche.
//       (b) `TriggeredAbility` has no `targetRequirement` (ADR 0002's
//           documented "choice-as-target" substitute only covers a target
//           whose characteristics don't need to be READ by a later Op —
//           Crypt Angel/Ravenous Rats use it fine); a trigger that must
//           inspect the firing event's or blocker's live characteristics
//           (color, mana value) stays imperative by design (see the Op
//           registry's own `reveal`/`moveZone` notes).
//   • 5 cards are commented stubs, tagged `tracked-by:` — none duplicated
//     from the Domain (#1066) / pile-division (#1067) / can't-be-countered
//     (#1065) capability clusters (none of those land on black):
//       - Exotic Curse shipped below as an active def with the Domain
//         capability cluster (#1066); Do or Die is a pile-division card and
//         is NOT emitted here at all (owned by its own cluster's colour file).
//         Phyrexian Infiltrator (the set's one exchange-control card,
//         issue #1068) similarly ships below, outside this 38-card tally,
//         once the control-exchange capability landed (no longer a stub).
//       - Defiling Tears, Desperate Research, Tsabo's Decree, Twilight's Call
//         → tracked-by #1085 (setColor / nameCard / choose-a-creature-type /
//         pay-more-for-flash gaps surfaced by this tranche).
//       - Yawgmoth's Agenda → tracked-by #686 (graveyard-cast permission +
//         replacement capability, already an open issue before this tranche).
// ═════════════════════════════════════════════════════════════════════════════

import type {
    CardDefinition,
    CardPrint,
    Color,
    PermanentView,
    SpellContext,
    StaticEffectContext,
    StaticEffectStateView,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    countDomain,
    EFFECT_AFFECTS_SELF,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

// Shared "most common color among all permanents" helper (Goham Djinn,
// Tsabo's Assassin) — a plain board-wide colour tally, composed entirely of
// existing accessors (no new SpellContext primitive). Two variants because
// the two call sites read different context shapes: a `pt-cda` static effect
// gets `StaticEffectStateView` + `StaticEffectContext`, while an activated
// ability's `resolve()` gets `SpellContext`.
function tallyMostCommon(perColor: (color: Color) => number): Color[] {
    const COLORS: Color[] = ["W", "U", "B", "R", "G"];
    const counts = COLORS.map((c) => [c, perColor(c)] as const);
    const max = Math.max(0, ...counts.map(([, n]) => n));
    if (max === 0) return [];
    return counts.filter(([, n]) => n === max).map(([c]) => c);
}

function mostCommonColorsStatic(
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): Color[] {
    const allPermanents: PermanentView[] = state.players.flatMap(
        (p) => p.battlefield
    );
    return tallyMostCommon(
        (color) =>
            allPermanents.filter((p) => ctx.getColors(p).includes(color)).length
    );
}

function mostCommonColors(ctx: SpellContext): Color[] {
    const allIds = ctx.allPlayerIds.flatMap((pid) =>
        ctx.getBattlefieldIds(pid)
    );
    return tallyMostCommon(
        (color) =>
            allIds.filter((id) =>
                ctx.getColors({ type: "permanent", id }).includes(color)
            ).length
    );
}

// Addle — {1}{B} Sorcery. "Choose a color. Target player reveals their hand
// and you choose a card of that color from it. That player discards that
// card." (CR 701.20a reveal, CR 701.9 discard.) The "choose a color" clause
// has no dedicated primitive, so it's expressed as a 5-mode `optionChoice`
// (one per W/U/B/R/G) — each mode is the exact Thoughtseize `reveal` +
// `choice(choose-hand-card)` + `discard` template (lrw/black.ts), just
// filtered by that mode's fixed color instead of `excludeType`. `count: {
// min: 0, max: 1 }` auto-handles "no card of that color" (CR 608.2b).
function addleMode(color: Color, label: string) {
    return {
        label,
        effects: [
            {
                op: "choice" as const,
                kind: "choose-hand-card" as const,
                player: "controller" as const,
                zoneOwnerId: { target: 0 },
                zone: "hand" as const,
                filter: { color },
                count: { min: 0, max: 1 },
                prompt: `Choose a ${label.toLowerCase()} card from that player's hand.`,
                bind: "$picked",
            },
            {
                op: "discard" as const,
                player: { target: 0 },
                cards: { ref: "$picked" },
            },
        ],
    };
}

export const addle: CardDefinition = {
    id: "e8afb9d0-affa-4599-bf29-729cfe64703b", // INV 91
    rarity: "uncommon",
    name: "Addle",
    oracleText:
        "Choose a color. Target player reveals their hand and you choose a card of that color from it. That player discards that card.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "optionChoice",
            player: "controller",
            prompt: "Choose a color.",
            modes: [
                addleMode("W", "White"),
                addleMode("U", "Blue"),
                addleMode("B", "Black"),
                addleMode("R", "Red"),
                addleMode("G", "Green"),
            ],
        },
    ],
};

// Andradite Leech — {2}{B} 2/2. "Black spells you cast cost {B} more to
// cast. {B}: This creature gets +1/+1 until end of turn." (CR 601.2f cost
// modification.) The cost-modifier is the exact Derelor template
// (fem/black.ts): `effectSource.controllerId === card.controllerId` scopes
// the tax to the Leech's OWN controller's black spells (not a Gloom-style
// blanket tax).
export const andraditeLeech: CardDefinition = {
    id: "6da0d4f3-9216-406c-8f3e-b9bb0a11dc75", // INV 93
    rarity: "rare",
    name: "Andradite Leech",
    oracleText:
        "Black spells you cast cost {B} more to cast.\n{B}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("B") &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costIncrease: { B: 1 },
        },
    ],
    activatedAbilities: [
        {
            id: "andradite-leech-pump",
            oracleText: "{B}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Annihilate — {3}{B}{B} Instant. "Destroy target nonblack creature. It
// can't be regenerated. Draw a card." (CR 701.8 destroy, CR 701.15c
// regeneration suppression, CR 121.1 draw.)
//
// protocol card: the DSL `destroy` Op has no `cantBeRegenerated` param —
// `SpellContext.destroy`'s `opts.cantBeRegenerated` is imperative-only today
// (see Crumble, atq/green.ts, for the identical pattern/comment). Composes
// only the already-shipped `destroy` + `drawCards` primitives.
export const annihilate: CardDefinition = {
    id: "4a3bf039-ecf6-477e-997c-e32c55323c01", // INV 94
    rarity: "uncommon",
    name: "Annihilate",
    oracleText:
        "Destroy target nonblack creature. It can't be regenerated.\nDraw a card.",
    manaCost: { X: 3, B: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        ctx.destroy(target, { cantBeRegenerated: true });
        ctx.drawCards(ctx.controller, 1);
    },
};

// Bog Initiate — {1}{B} 1/1. "{1}: Add {B}." (CR 605.3a mana ability.)
export const bogInitiate: CardDefinition = {
    id: "8962dc3b-24ca-4c3c-ba1d-933c29cf7b73", // INV 95
    rarity: "common",
    name: "Bog Initiate",
    oracleText: "{1}: Add {B}.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "bog-initiate-mana",
            oracleText: "{1}: Add {B}.",
            cost: { mana: { X: 1 } },
            useStack: false,
            effect: (ctx) => {
                ctx.addMana({ B: 1 });
            },
            manaProduced: { B: 1 },
        },
    ],
};

// Cremate — {B} Instant. "Exile target card from a graveyard. Draw a card."
// (CR 701.13 exile, CR 121.1 draw.) Any graveyard (`controller` omitted =
// "any"), any card type (`type: "card"`).
export const cremate: CardDefinition = {
    id: "1095cdfe-8060-4a73-bacf-9f983152b486", // INV 96
    rarity: "uncommon",
    name: "Cremate",
    oracleText: "Exile target card from a graveyard.\nDraw a card.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "card", count: 1, zone: "graveyard" },
    effects: [
        { op: "exile", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Crypt Angel — {4}{B} 3/3. "Flying, protection from white. When this
// creature enters, return target blue or red creature card from your
// graveyard to your hand." (CR 702.9 flying, CR 702.16 protection, CR
// 603.6a ETB.) `TriggeredAbility` has no `targetRequirement` (ADR 0002), so
// the "target" clause rides the choice-as-target substitute (Titania
// precedent): `choice(choose-graveyard-card)` + `moveZone` — no snapshot of
// the picked card is needed afterward, so this stays fully DSL (unlike
// Phyrexian Delver below, which needs the picked card's mana value).
export const cryptAngel: CardDefinition = {
    id: "522ddc6f-ec13-4a70-8f4c-b3c846b102fd", // INV 97
    rarity: "rare",
    name: "Crypt Angel",
    oracleText:
        "Flying, protection from white\nWhen this creature enters, return target blue or red creature card from your graveyard to your hand.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying", "protection from white"],
    triggeredAbilities: [
        enteredTrigger({
            id: "crypt-angel-etb",
            oracleText:
                "When this creature enters, return target blue or red creature card from your graveyard to your hand.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    filter: { type: "Creature", color: ["U", "R"] },
                    count: 1,
                    prompt: "Return a blue or red creature card from your graveyard to your hand.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "graveyard",
                    to: "hand",
                },
            ],
        }),
    ],
};

// Cursed Flesh — {B} Aura. "Enchant creature. Enchanted creature gets -1/-1
// and has fear." (CR 613.4c pt-buff, CR 702.36 fear keyword-grant.)
export const cursedFlesh: CardDefinition = {
    id: "fb151ae8-9281-434d-ba8d-9ce34f0875eb", // INV 98
    rarity: "common",
    name: "Cursed Flesh",
    oracleText: "Enchant creature\nEnchanted creature gets -1/-1 and has fear.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: -1,
            toughness: -1,
        },
        { kind: "keyword-grant", applies: AURA_AFFECTS_HOST, keyword: "fear" },
    ],
};

// STOP-AND-ISSUE (tracked-by: #1085) — Defiling Tears: "Until end of turn,
// target creature becomes black, gets +1/-1, and gains '{B}: Regenerate this
// creature.'" Needs the `setColor` Op, `status: "planned"` in
// EFFECT_OP_BACKLOG (mechanicsRegistry.ts) — folds SpellContext.setColorOverride,
// not yet wired to the interpreter/validator. Not invented; left a stub.
// export const defilingTears: CardDefinition = {
//     id: "db7cba29-9472-4874-bd54-37edf70645b2", // INV 99
//     name: "Defiling Tears",
//     rarity: "uncommon",
//     manaCost: { X: 2, B: 1 },
//     types: ["Instant"],
//     targetRequirement: { type: "Creature", count: 1 },
// };

// STOP-AND-ISSUE (tracked-by: #1085) — Desperate Research: "Choose a card
// name other than a basic land card name. Reveal the top seven cards of your
// library and put all of them with that name into your hand. Exile the
// rest." Needs the `nameCard` Op, also `status: "planned"` in
// EFFECT_OP_BACKLOG — folds SpellContext.requestNameCard. Not invented; left
// a stub.
// export const desperateResearch: CardDefinition = {
//     id: "6a42ac7e-4a27-488c-a2e7-338b18103b02", // INV 100
//     name: "Desperate Research",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Sorcery"],
// };

// Devouring Strossus — {5}{B}{B}{B} 9/9. "Flying, trample. At the beginning
// of your upkeep, sacrifice a creature. Sacrifice a creature: Regenerate
// this creature." (CR 702.9 flying, CR 702.19 trample, CR 603.6a upkeep,
// CR 701.16 sacrifice, CR 701.15/701.19 regenerate.) The forced upkeep
// sacrifice is the Innocent Blood `choice(sacrifice-permanents)` + `sacrifice`
// template (ody/black.ts), narrowed to `count: 1` and the resolving
// controller only (no `forEach` needed — only one player's upkeep fires this
// trigger). The activated ability's cost is the existing
// `sacrificeFilter: { types: "Creature" }` shape (any creature, not
// necessarily this one) — distinct from `sacrifice: true` (which would
// sacrifice Strossus itself).
export const devouringStrossus: CardDefinition = {
    id: "064f013f-e74f-419d-8d17-7748bd91885e", // INV 101
    rarity: "rare",
    name: "Devouring Strossus",
    oracleText:
        "Flying, trample\nAt the beginning of your upkeep, sacrifice a creature.\nSacrifice a creature: Regenerate this creature.",
    manaCost: { X: 5, B: 3 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Horror"],
    power: 9,
    toughness: 9,
    staticAbilities: ["flying", "trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "devouring-strossus-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice a creature.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Sacrifice a creature.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "devouring-strossus-regen",
            oracleText: "Sacrifice a creature: Regenerate this creature.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Dredge — {B} Instant. "Sacrifice a creature or land. Draw a card." (CR
// 701.16 sacrifice, CR 121.1 draw.) Not the Dredge KEYWORD (CR 702.53) —
// this INV card predates it and is a plain sacrifice-then-draw effect;
// choice count clamps to 0 when the caster controls neither (CR 608.2b), so
// the draw still happens with no sacrifice.
export const dredge: CardDefinition = {
    id: "68bfa3d5-0f0b-4684-9567-f1478da01df7", // INV 103
    rarity: "uncommon",
    name: "Dredge",
    oracleText: "Sacrifice a creature or land.\nDraw a card.",
    manaCost: { B: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player: "controller",
            zone: "battlefield",
            filter: { type: ["Creature", "Land"] },
            count: 1,
            prompt: "Sacrifice a creature or land.",
            bind: "$sac",
        },
        { op: "sacrifice", permanents: { ref: "$sac" } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Duskwalker — {B} 1/1. "Kicker {3}{B}. If this creature was kicked, it
// enters with two +1/+1 counters on it and with fear." (CR 702.33 Kicker,
// CR 122.1/614.1c ETB counters, CR 702.36 fear.)
//
// The counters half rides `entersWith.counters` — TWO entries each
// `count: "kicker"` (kickerCount is 0/1 for a single, non-multi Kicker), so
// the placement loop (`finalizeSpellResolution`, state.ts) sums them to
// exactly 0 or 2, matching "two +1/+1 counters" without a fixed-multiplier
// field. The fear half has no `entersWith` analogue (no keyword-conditional-
// on-kicker field, and kickerCount isn't persisted onto the permanent post-
// ETB for a later static predicate to read) — instead, the `keyword-grant`'s
// `applies` reads the +1/+1 counter count the SAME entersWith application
// just placed as an exact, deterministic proxy for "was kicked" (nothing else
// can add to Duskwalker's counters between entersWith running and this
// static effect being read). Documented simplification: this would misfire
// only if some OTHER effect independently pushed a non-kicked Duskwalker to
// 2+ +1/+1 counters as it entered — no such interaction exists in the
// current catalogue.
export const duskwalker: CardDefinition = {
    id: "39a4a026-f44e-40e1-9942-a3d8448aca70", // INV 104
    rarity: "common",
    name: "Duskwalker",
    oracleText:
        "Kicker {3}{B} (You may pay an additional {3}{B} as you cast this spell.)\nIf this creature was kicked, it enters with two +1/+1 counters on it and with fear.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Minion"],
    power: 1,
    toughness: 1,
    kicker: { cost: { X: 3, B: 1 } },
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.id &&
                (target.counters?.["+1/+1"] ?? 0) >= 2,
            keyword: "fear",
        },
    ],
};

// Goham Djinn — {5}{B} 5/5. "{1}{B}: Regenerate this creature. This creature
// gets -2/-2 as long as black is the most common color among all permanents
// or is tied for most common." (CR 701.15/701.19 regenerate, CR 613.4a CDA.)
// The conditional P/T reduction is a `pt-cda` whose `compute` reads the full
// board via `StaticEffectStateView` (mirrors People of the Woods,
// drk/green.ts) through the shared `mostCommonColorsStatic` helper above.
export const gohamDjinn: CardDefinition = {
    id: "d67796c7-4d93-4c50-8839-bb69e075bc42", // INV 107
    rarity: "uncommon",
    name: "Goham Djinn",
    oracleText:
        "{1}{B}: Regenerate this creature.\nThis creature gets -2/-2 as long as black is the most common color among all permanents or is tied for most common.",
    manaCost: { X: 5, B: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 5,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state, ctx) => {
                const mostCommon = mostCommonColorsStatic(state, ctx);
                return mostCommon.includes("B")
                    ? { power: -2, toughness: -2 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "goham-djinn-regen",
            oracleText: "{1}{B}: Regenerate this creature.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Hate Weaver — {1}{B} 2/1. "{2}: Target blue or red creature gets +1/+0
// until end of turn." (CR 613.4c temporary pump.)
export const hateWeaver: CardDefinition = {
    id: "8328e131-b44d-4dd0-9ce4-454c6afe6fa6", // INV 108
    rarity: "uncommon",
    name: "Hate Weaver",
    oracleText:
        "{2}: Target blue or red creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Wizard"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "hate-weaver-pump",
            oracleText:
                "{2}: Target blue or red creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["U", "R"],
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Hypnotic Cloud — {1}{B} Sorcery. "Kicker {4}. Target player discards a
// card. If this spell was kicked, that player discards three cards
// instead." (CR 702.33 Kicker, CR 701.9 discard.) The `kickerCount`
// comparison uses `ge 1` rather than `gt 0` — a literal `EffectValue`
// operand must be a positive int (validator), so `0` isn't expressible —
// `kickerCount >= 1` is equivalent to "was kicked".

export const hypnoticCloud: CardDefinition = {
    id: "a7502ea2-7555-449e-baee-6ecef5573a3b", // INV 109
    rarity: "common",
    name: "Hypnotic Cloud",
    oracleText:
        "Kicker {4} (You may pay an additional {4} as you cast this spell.)\nTarget player discards a card. If this spell was kicked, that player discards three cards instead.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    kicker: { cost: { X: 4 } },
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
                    count: { min: 0, max: 1 },
                    prompt: "Discard a card.",
                    bind: "$picked1",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked1" },
                },
            ],
        },
    ],
};

// Marauding Knight — {2}{B}{B} 2/2. "Protection from white. This creature
// gets +1/+1 for each Plains your opponents control." (CR 702.16 protection,
// CR 613.4a CDA.) Mirrors Goham Djinn's `pt-cda` shape — a plain permanent
// count over `StaticEffectStateView.players[].battlefield`, no shared-color
// tally needed here.
export const maraudingKnight: CardDefinition = {
    id: "cea2a7de-c67e-4541-be8c-e5ef7b64d94a", // INV 110
    rarity: "rare",
    name: "Marauding Knight",
    oracleText:
        "Protection from white\nThis creature gets +1/+1 for each Plains your opponents control.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from white"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let plains = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId !== source.controllerId &&
                            p.subtypes.includes("Plains")
                        ) {
                            plains++;
                        }
                    }
                }
                return { power: plains, toughness: plains };
            },
        },
    ],
};

// Mourning — {1}{B} Aura. "Enchant creature. Enchanted creature gets -2/-0.
// {B}: Return this Aura to its owner's hand." (CR 613.4c pt-buff, CR 701.10
// return-to-hand self-bounce.)
export const mourning: CardDefinition = {
    id: "4649d881-709f-4ed0-91de-744d232a82f5", // INV 111
    rarity: "common",
    name: "Mourning",
    oracleText:
        "Enchant creature\nEnchanted creature gets -2/-0.\n{B}: Return this Aura to its owner's hand.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: -2,
            toughness: 0,
        },
    ],
    activatedAbilities: [
        {
            id: "mourning-return",
            oracleText: "{B}: Return this Aura to its owner's hand.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// Phyrexian Battleflies — {B} 0/1. "Flying. {B}: This creature gets +1/+0
// until end of turn. Activate no more than twice each turn." (CR 702.9
// flying, CR 602.5 activation cap.) The "twice" cap has no `oncePerTurn`-
// style boolean field (that caps at exactly 1) — `canActivate` reads the
// generic per-source `activationsThisTurn` tally the engine already tracks
// for EVERY activated ability (game.ts `recordActivation`), the same
// extension point Clockwork Beast-style conditional abilities use. Per the
// bot-move-enumerator's own documented limitation (moves.ts: "Conditional
// abilities need a runtime predicate we don't replicate"), a `canActivate`
// gate is skipped by the bot — consistent with every other conditional
// ability in the catalogue, not a new gap.
export const phyrexianBattleflies: CardDefinition = {
    id: "da27c489-c541-4b0d-a844-71aa65e55ceb", // INV 114
    rarity: "common",
    name: "Phyrexian Battleflies",
    oracleText:
        "Flying\n{B}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "phyrexian-battleflies-pump",
            oracleText:
                "{B}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            canActivate: (source) =>
                (source.activationsThisTurn?.["phyrexian-battleflies-pump"] ??
                    0) < 2,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Phyrexian Delver — {3}{B}{B} 3/2. "When this creature enters, return
// target creature card from your graveyard to the battlefield. You lose
// life equal to that card's mana value." (CR 603.6a ETB, CR 400.7
// reanimation, CR 202.3 mana value, CR 119.3b life loss.)
//
// protocol card: `TriggeredAbility` has no `targetRequirement` (ADR 0002), so
// the "target" clause needs the choice-as-target substitute — but unlike
// Crypt Angel above, the mana-value snapshot needed for the life-loss clause
// has no DSL path: a `choice` Op's `bind` is a bare picks array (no
// `ref.manaValue` snapshot the way an ANNOUNCED target's `moveZone.bind`
// provides — see Reanimate, tmp/black.ts, for the announced-target version
// of this exact "lose life equal to mana value" template). Composes only
// already-shipped SpellContext primitives: `requestChoice` (the same
// primitive the DSL `choice` Op wraps), `getManaValue`, `returnToBattlefield`,
// `loseLife`.
export const phyrexianDelver: CardDefinition = {
    id: "e66d87a5-7b67-4ec5-b5e2-518d67123118", // INV 115
    rarity: "rare",
    name: "Phyrexian Delver",
    oracleText:
        "When this creature enters, return target creature card from your graveyard to the battlefield. You lose life equal to that card's mana value.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "phyrexian-delver-etb",
            oracleText:
                "When this creature enters, return target creature card from your graveyard to the battlefield. You lose life equal to that card's mana value.",
            scope: "self",
            resolve: (ctx) => {
                const controller = ctx.controller;
                const picks = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `phyrexian-delver-${ctx.sourceInstanceId}`,
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Return a creature card from your graveyard to the battlefield.",
                });
                if (picks === undefined) return; // suspended
                const id = picks[0];
                if (!id) return; // nothing to return, CR 608.2b
                const mv = ctx.getManaValue({
                    type: "graveyard-card",
                    id,
                    playerId: controller,
                });
                const moved = ctx.returnToBattlefield(
                    controller,
                    id,
                    "graveyard"
                );
                if (moved) ctx.loseLife(controller, mv);
            },
        }),
    ],
};

// Phyrexian Reaper — {4}{B} 3/3. "Whenever this creature becomes blocked by
// a green creature, destroy that creature. It can't be regenerated." (CR
// 509.1h becomes-blocked, CR 701.8 destroy, CR 701.15c regen suppression.)
//
// protocol card: (a) the trigger CONDITION itself depends on the blocker's
// live color, which isn't carried on `BLOCKERS_CONFIRMED` — read via
// `TriggerStateView.players[].battlefield[].colors` in `matches` so the
// ability doesn't even go on the stack when blocked by a non-green creature
// (CR 603.2); (b) `destroy`'s DSL Op has no `cantBeRegenerated` param (see
// Annihilate above). `combatPairKillTrigger` doesn't fit — it destroys at
// END of combat (a delayed trigger) and has no color filter; this is an
// IMMEDIATE destroy, one direction only ("becomes blocked by", not "blocks
// or becomes blocked by"), matching Lim-Dûl's Cohort's precedent of
// declaring the BLOCKERS_CONFIRMED trigger directly (ice/black.ts).
export const phyrexianReaper: CardDefinition = {
    id: "ccdd498b-1081-43fe-8193-518337a5a3ea", // INV 117
    rarity: "common",
    name: "Phyrexian Reaper",
    oracleText:
        "Whenever this creature becomes blocked by a green creature, destroy that creature. It can't be regenerated.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "phyrexian-reaper-blocked",
            oracleText:
                "Whenever this creature becomes blocked by a green creature, destroy that creature. It can't be regenerated.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                if (event.attackerId !== self.id) return false;
                const blocker = state?.players
                    .flatMap((p) => p.battlefield)
                    .find((p) => p.id === event.blockerId);
                return blocker?.colors?.includes("G") ?? false;
            },
            resolve: (ctx, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                ctx.destroy(
                    { type: "permanent", id: event.blockerId },
                    { cantBeRegenerated: true }
                );
            },
        },
    ],
};

// Phyrexian Slayer — {3}{B} 2/2. "Flying. Whenever this creature becomes
// blocked by a white creature, destroy that creature. It can't be
// regenerated." (Same shape as Phyrexian Reaper above, filtered to white.)
export const phyrexianSlayer: CardDefinition = {
    id: "5fa8c604-343f-4c94-ac25-439ab1845c19", // INV 118
    rarity: "common",
    name: "Phyrexian Slayer",
    oracleText:
        "Flying\nWhenever this creature becomes blocked by a white creature, destroy that creature. It can't be regenerated.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Minion"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        {
            id: "phyrexian-slayer-blocked",
            oracleText:
                "Whenever this creature becomes blocked by a white creature, destroy that creature. It can't be regenerated.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                if (event.attackerId !== self.id) return false;
                const blocker = state?.players
                    .flatMap((p) => p.battlefield)
                    .find((p) => p.id === event.blockerId);
                return blocker?.colors?.includes("W") ?? false;
            },
            resolve: (ctx, event) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return;
                ctx.destroy(
                    { type: "permanent", id: event.blockerId },
                    { cantBeRegenerated: true }
                );
            },
        },
    ],
};

// Plague Spitter — {2}{B} 2/2. "At the beginning of your upkeep, this
// creature deals 1 damage to each creature and each player. When this
// creature dies, it deals 1 damage to each creature and each player." (CR
// 603.6a upkeep, CR 120.3 damage, CR 700.4/603.2 dies.) The upkeep half is
// the exact Pestilence `forEach` template (lea/black.ts). `diedTrigger`
// requires a `resolve` callback (no `effects:` DSL support on that factory
// yet), so the dies half is written imperatively but composes only the same
// already-exercised `dealDamage` primitive in a loop.
export const plagueSpitter: CardDefinition = {
    id: "8845e6bd-40ee-45ca-a099-53f19ff20a8a", // INV 119
    rarity: "uncommon",
    name: "Plague Spitter",
    oracleText:
        "At the beginning of your upkeep, this creature deals 1 damage to each creature and each player.\nWhen this creature dies, it deals 1 damage to each creature and each player.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Horror"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "plague-spitter-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 1 damage to each creature and each player.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                    ],
                },
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
        }),
        diedTrigger({
            id: "plague-spitter-dies",
            oracleText:
                "When this creature dies, it deals 1 damage to each creature and each player.",
            scope: "self",
            resolve: (ctx) => {
                for (const pid of ctx.allPlayerIds) {
                    for (const id of ctx.getBattlefieldIds(pid, {
                        types: "Creature",
                    })) {
                        ctx.dealDamage({ type: "permanent", id }, 1);
                    }
                    ctx.dealDamage({ type: "player", id: pid }, 1);
                }
            },
        }),
    ],
};

// Ravenous Rats — {1}{B} 1/1. "When this creature enters, target opponent
// discards a card." (CR 603.6a ETB, CR 701.9 discard.) "Target opponent" in
// a 2-player game is a relative `EffectPlayerRef`, so no `choice-as-target`
// substitute is needed at all — `player: "opponent"` addresses it directly
// (the discarding player also chooses which card, CR 701.8a default).
export const ravenousRats: CardDefinition = {
    id: "89e29069-add5-4099-b800-9f1e4402cc1a", // INV 120
    rarity: "common",
    name: "Ravenous Rats",
    oracleText: "When this creature enters, target opponent discards a card.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "ravenous-rats-etb",
            oracleText:
                "When this creature enters, target opponent discards a card.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "opponent",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: "opponent",
                    cards: { ref: "$picked" },
                },
            ],
        }),
    ],
};

// Reckless Spite — {1}{B}{B} Instant. "Destroy two target nonblack
// creatures. You lose 5 life." (CR 701.8 destroy, CR 601.2c "two target" —
// exact count, not "up to two".) Two announced targets addressed by
// position (Force of Vigor precedent, mh1/green.ts).
export const recklessSpite: CardDefinition = {
    id: "2412497b-cae5-444d-9beb-7761d15cd5c5", // INV 121
    rarity: "uncommon",
    name: "Reckless Spite",
    oracleText: "Destroy two target nonblack creatures. You lose 5 life.",
    manaCost: { X: 1, B: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 2, excludeColors: "B" },
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "destroy", target: { target: 1 } },
        { op: "loseLife", player: "controller", amount: 5 },
    ],
};

// Recover — {2}{B} Sorcery. "Return target creature card from your
// graveyard to your hand." (CR 400.7 zone change.) A plain spell target
// (`zone: "graveyard", controller: "you"`) — no capability needed.
export const recover: CardDefinition = {
    id: "771e695b-24e1-4c65-81e0-1624bda646e7", // INV 122
    rarity: "common",
    name: "Recover",
    oracleText: "Return target creature card from your graveyard to your hand.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
};

// Scavenged Weaponry — {2}{B} Aura. "Enchant creature. When this Aura
// enters, draw a card. Enchanted creature gets +1/+1." (CR 603.6a ETB, CR
// 613.4c pt-buff.)
export const scavengedWeaponry: CardDefinition = {
    id: "4e8072a9-2699-4c6c-9556-67d91bd67a4b", // INV 123
    rarity: "common",
    name: "Scavenged Weaponry",
    oracleText:
        "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature gets +1/+1.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "scavenged-weaponry-etb",
            oracleText: "When this Aura enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 1 },
    ],
};

// Soul Burn — a reprint of the Ice Age card already implemented as
// `soulBurn` in `sets/ice/black.ts` (id eb8e00d2-…, including its documented
// "spend only black/red mana on X" SIMPLIFICATION). ADR 0043/0014: a
// cross-set reprint is a `CardPrint` referencing the original
// `CardDefinition`, not a duplicate definition. Only the primary English
// printing (#124) is modelled — the two Chinese alt-art variants (#124s,
// #124★) are out of scope (promo/alt-art variants generally aren't modelled
// 1:1 in this catalogue).
export const soulBurnInv: CardPrint = {
    printId: "70515cd2-97d5-4491-a758-bc7188fdc6dc", // INV 124
    definitionId: "eb8e00d2-2381-4d45-bed8-c9bf738a9419", // ICE Soul Burn
    setCode: "inv",
    rarity: "common",
};

// Spreading Plague — {4}{B} Enchantment. "Whenever a creature enters,
// destroy all other creatures that share a color with it. They can't be
// regenerated." (CR 603.6a ETB — watching ANY creature, CR 701.8 destroy,
// CR 701.15c regen suppression.)
//
// protocol card: needs the entering creature's live color, which isn't
// carried on `PERMANENT_ENTERED` and can't be read from a script (an Effect
// Script never sees the firing event — see the `reveal`/`moveZone` Op
// registry notes); `destroy`'s DSL Op also has no `cantBeRegenerated` param
// (see Annihilate above). Composes only already-shipped primitives:
// `getColors`, `allPlayerIds`/`getBattlefieldIds`, `destroy`.
export const spreadingPlague: CardDefinition = {
    id: "ac86055d-ce08-4b05-a92c-45e007ca0ba4", // INV 125
    rarity: "rare",
    name: "Spreading Plague",
    oracleText:
        "Whenever a creature enters, destroy all other creatures that share a color with it. They can't be regenerated.",
    manaCost: { X: 4, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "spreading-plague-enters",
            oracleText:
                "Whenever a creature enters, destroy all other creatures that share a color with it. They can't be regenerated.",
            scope: "any",
            filter: { types: "Creature" },
            resolve: (ctx, _event, entered) => {
                const enteredColors = ctx.getColors({
                    type: "permanent",
                    id: entered.id,
                });
                if (enteredColors.length === 0) return; // colorless shares nothing
                const toDestroy = ctx.allPlayerIds
                    .flatMap((pid) =>
                        ctx.getBattlefieldIds(pid, { types: "Creature" })
                    )
                    .filter((id) => id !== entered.id)
                    .filter((id) =>
                        ctx
                            .getColors({ type: "permanent", id })
                            .some((c) => enteredColors.includes(c))
                    );
                for (const id of toDestroy) {
                    ctx.destroy(
                        { type: "permanent", id },
                        { cantBeRegenerated: true }
                    );
                }
            },
        }),
    ],
};

// Tainted Well — {2}{B} Aura. "Enchant land. When this Aura enters, draw a
// card. Enchanted land is a Swamp." (CR 603.6a ETB, CR 305.7/611 layer-4
// subtype ADDITION — Urborg, Tomb of Yawgmoth precedent, plc/colorless.ts:
// "is a Swamp" ADDS the type, it doesn't replace the land's other types.)
export const taintedWell: CardDefinition = {
    id: "2eec00a1-7e12-42d2-8f46-de8ab7323c2c", // INV 126
    rarity: "common",
    name: "Tainted Well",
    oracleText:
        "Enchant land\nWhen this Aura enters, draw a card.\nEnchanted land is a Swamp.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "tainted-well-etb",
            oracleText: "When this Aura enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: AURA_AFFECTS_HOST,
            subtypes: ["Swamp"],
        },
    ],
};

// Tsabo's Assassin — {2}{B}{B} 1/1. "{T}: Destroy target creature if it
// shares a color with the most common color among all permanents or a
// color tied for most common. A creature destroyed this way can't be
// regenerated." (CR 701.8 destroy, CR 701.15c regen suppression.)
//
// protocol card: the frozen `if` predicate (ADR 0045) is only a boolean
// binding or a numeric comparison — "shares a color with the board's
// most-common-color set" is neither form, and `destroy`'s DSL Op has no
// `cantBeRegenerated` param regardless (see Annihilate above). Composes
// only already-shipped primitives via the shared `mostCommonColors` helper.
export const tsabosAssassin: CardDefinition = {
    id: "0047302d-4e3d-4327-9bb2-ecd5b00b00e3", // INV 128
    rarity: "rare",
    name: "Tsabo's Assassin",
    oracleText:
        "{T}: Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common. A creature destroyed this way can't be regenerated.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Zombie", "Assassin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "tsabos-assassin-destroy",
            oracleText:
                "{T}: Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common. A creature destroyed this way can't be regenerated.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                const mostCommon = mostCommonColors(ctx);
                if (mostCommon.length === 0) return;
                const targetColors = ctx.getColors(target);
                if (targetColors.some((c) => mostCommon.includes(c))) {
                    ctx.destroy(target, { cantBeRegenerated: true });
                }
            },
        },
    ],
};

// STOP-AND-ISSUE (tracked-by: #1085) — Tsabo's Decree: "Choose a creature
// type. Target player reveals their hand and discards all creature cards of
// that type. Then destroy all creatures of that type that player controls.
// They can't be regenerated." Needs a "choose a creature type" capability
// that doesn't exist anywhere in the registry or engine — distinct from
// `nameCard` (which names a printed CARD, not an abstract creature type).
// Not invented; left a stub.
// export const tsabosDecree: CardDefinition = {
//     id: "0c1a0ebd-1add-49e6-b5e6-5b26abb1de88", // INV 129
//     name: "Tsabo's Decree",
//     rarity: "rare",
//     manaCost: { X: 5, B: 1 },
//     types: ["Instant"],
//     targetRequirement: { type: "player", count: 1 },
// };

// STOP-AND-ISSUE (tracked-by: #1085) — Twilight's Call: "You may cast this
// spell as though it had flash if you pay {2} more to cast it. Each player
// returns all creature cards from their graveyard to the battlefield." The
// mass-reanimation clause is free (a `forEach` over players + `moveZone`),
// but the "pay {N} more to cast with flash" cast-timing rider has no home:
// `AlternativeCost` REPLACES the mana cost (Force of Will-style), it doesn't
// ADD to it, and there's no existing "conditional flash for extra mana"
// capability. Not invented; left a stub.
// export const twilightsCall: CardDefinition = {
//     id: "3c97c8a5-33b3-4f7f-a224-bb4df7b4bcc0", // INV 130
//     name: "Twilight's Call",
//     rarity: "rare",
//     manaCost: { X: 4, B: 2 },
//     types: ["Sorcery"],
// };

// Urborg Shambler — {2}{B}{B} 4/3. "Other black creatures get -1/-1." (CR
// 613.4c board-wide pt-buff — the Contamination/Anathema-cycle shape:
// applies to every OTHER black creature regardless of controller, not just
// "you control".)
export const urborgShambler: CardDefinition = {
    id: "eaedd5c8-03c6-4bbb-bf83-632551830bd4", // INV 133
    rarity: "uncommon",
    name: "Urborg Shambler",
    oracleText: "Other black creatures get -1/-1.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 4,
    toughness: 3,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                target.id !== source.id &&
                ctx.isCreature(target) &&
                ctx.getColors(target).includes("B"),
            power: -1,
            toughness: -1,
        },
    ],
};

// Urborg Skeleton — {B} 0/1. "Kicker {3}. {B}: Regenerate this creature. If
// this creature was kicked, it enters with a +1/+1 counter on it." (CR
// 702.33 Kicker, CR 122.1/614.1c ETB counter, CR 701.15/701.19 regenerate.)
// A single `entersWith.counters` entry with `count: "kicker"` is exact here
// (kickerCount is 0/1 for a single Kicker, matching "a +1/+1 counter" 1:1) —
// unlike Duskwalker, no keyword grant is involved, so no proxy is needed.
export const urborgSkeleton: CardDefinition = {
    id: "6e522a62-fbca-4362-9006-d4356c525704", // INV 134
    rarity: "common",
    name: "Urborg Skeleton",
    oracleText:
        "Kicker {3} (You may pay an additional {3} as you cast this spell.)\n{B}: Regenerate this creature.\nIf this creature was kicked, it enters with a +1/+1 counter on it.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Skeleton"],
    power: 0,
    toughness: 1,
    kicker: { cost: { X: 3 } },
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
    activatedAbilities: [
        {
            id: "urborg-skeleton-regen",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// STOP-AND-ISSUE (tracked-by: #1238) — Yawgmoth's Agenda: "You can't cast
// more than one spell each turn. You may play lands and cast spells from
// your graveyard. If a card would be put into your graveyard from anywhere,
// exile it instead." #1149 SHIPPED Yawgmoth's Will's TURN-SCOPED shape
// (`grantGraveyardPlay` Op + `armGraveyardRedirect` Op), but Agenda's clauses
// are INDEFINITE (a static enchantment ability, no "until end of turn") —
// needs a battlefield-derived (not turn-scoped) graveyard-cast permission
// (generalizing the LAND-only `playsLandsFromGraveyard`, #1190, to cover
// spells) and confirmation the redirect composes with the already-shipped
// permanent-bound `graveyard-bound` replacement (Dauthi Voidwalker precedent,
// `mh2/black.ts`, stub #1156). PLUS a third, wholly new capability: "can't
// cast more than one spell each turn" has no restriction primitive today
// (only an unenforced `spellsCastThisTurn` counter). Split out of #686 once
// the Vintage Cube FREE tranche confirmed none of the three had shipped; the
// whole card stays one stub (every clause must be enforced together). Not
// invented; left a stub. See #1238 for the full design notes.
// export const yawgmothsAgenda: CardDefinition = {
//     id: "50f7ea7f-4f17-4f78-b68e-693e265ca829", // INV 135
//     name: "Yawgmoth's Agenda",
//     rarity: "rare",
//     manaCost: { X: 3, B: 2 },
//     types: ["Enchantment"],
// };

// ─────────────────────────────────────────────────────────────────────────
// Exchange-control cluster (parent PRD #1063, issue #1068, CR 701.12)
// ─────────────────────────────────────────────────────────────────────────

// Phyrexian Infiltrator — {2}{B} Creature — Phyrexian Minion, 2/2. "{2}{U}{U}:
// Exchange control of Phyrexian Infiltrator and target creature. (This effect
// lasts indefinitely.)" (CR 701.12e Exchange, CR 611.2b/613.1b layer-2 control
// change, issue #1068.) Colour identity is mono-black by mana cost (CR 202.2)
// even though the ability's OWN cost is blue — a card's color reads its mana
// cost only, not activated-ability costs, so this lives here, not blue.ts.
//
// Decomposed as TWO already-shipped `gainControl` Ops (issue #848) rather than
// a new "exchange" Op (primitive-reuse mandate — see the `exchange` row in
// mechanicsRegistry.ts for the full reasoning). `ctx.controller` is captured
// ONCE per stack-item resolution (`buildSpellContext`, CR 608.2b) and stays
// fixed across both Ops in this list, so the order below is load-bearing:
//   1. `$source` (this creature) -> whoever CURRENTLY controls the target
//      creature, read live via `{ controllerOf: { target: 0 } }` BEFORE
//      either mutation lands.
//   2. the target creature -> the ability's resolving controller (the fixed
//      `"controller"` selector) — unaffected by step 1 already having moved
//      `$source` to a new battlefield.
// Both omit `duration` (indefinite reassignment — never auto-reverts, matching
// "This effect lasts indefinitely."). No target exclusion: the oracle text
// doesn't say "another target creature" (contrast Sorceress Queen's "target
// creature OTHER THAN Sorceress Queen"), so Phyrexian Infiltrator can legally
// target itself — both `gainControl` calls then no-op against an unchanged
// controller (CR 608.2b), which is also the printed ruling for targeting a
// creature already under the same controller as this card.
//
// CR 701.12e atomicity fix (issue #1068 review): the target creature staying
// a legal target does NOT guarantee `$source` (this creature) is still
// around — the opponent can remove it in response. If it's gone, op1 already
// silently no-ops (`resolveObjectRef` skips a vanished object), but op2 would
// still fire unconditionally and steal the target ONE-WAY with no exchange
// back. CR 701.12e requires the swap to happen for BOTH permanents or
// NEITHER, so both Ops are wrapped in an `if` guarding on `$source` still
// being on the battlefield — reusing the EXACT `count` + `name` filter +
// `acrossAllPlayers` shape Accumulated Knowledge already uses to count copies
// of itself (`nem/blue.ts`, issue #985), just pointed at `zone: "battlefield"`
// instead of `"graveyard"` (both are legal `EffectCountSpec.zone` values — no
// new predicate/condition shape invented). The target's own presence is
// already guaranteed by `targetLegalityGate`, so the guard only needs to
// check the source.
export const phyrexianInfiltrator: CardDefinition = {
    id: "224b8254-553d-4d88-8163-1f15e1244bd2", // INV 116
    name: "Phyrexian Infiltrator",
    rarity: "rare",
    oracleText:
        "{2}{U}{U}: Exchange control of this creature and target creature. (This effect lasts indefinitely.)",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Minion"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "phyrexian-infiltrator-exchange",
            oracleText:
                "{2}{U}{U}: Exchange control of this creature and target creature. (This effect lasts indefinitely.)",
            cost: { mana: { X: 2, U: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    // CR 701.12e — both gainControl Ops fire together, or
                    // neither does (no one-way steal if $source died in
                    // response).
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                acrossAllPlayers: true,
                                filter: { name: "Phyrexian Infiltrator" },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "gainControl",
                            target: { ref: "$source" },
                            controller: { controllerOf: { target: 0 } },
                        },
                        {
                            op: "gainControl",
                            target: { target: 0 },
                            controller: "controller",
                        },
                    ],
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Exotic Curse — {2}{B} Enchantment — Aura. "Enchant creature. Domain —
// Enchanted creature gets -1/-1 for each basic land type among lands you
// control." (CR 303.4 aura, CR 604.3 CDA, CR 702 preamble Domain ability
// word, issue #1066.) Mirrors Strength of Unity's `pt-cda` shape exactly
// (`inv/white.ts`) with a NEGATED delta — the shared `countDomain` helper
// read against the Aura's OWN controller (`source.controllerId`).
export const exoticCurse: CardDefinition = {
    id: "8ee35d99-9a8a-421b-bf43-74446909d87d",
    name: "Exotic Curse",
    rarity: "common",
    oracleText:
        "Enchant creature\nDomain — Enchanted creature gets -1/-1 for each basic land type among lands you control.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                const domain = countDomain(state, source.controllerId);
                return { power: -domain, toughness: -domain };
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Pile-division cluster (parent PRD #1063, issue #1067, ADR 0053)
// ─────────────────────────────────────────────────────────────────────────

// Do or Die — {1}{B} Sorcery. "Separate all creatures target player controls
// into two piles. Destroy all creatures in the pile of that player's choice.
// They can't be regenerated." (CR 701.8 destroy, CR 701.15c regeneration
// suppression, ADR 0053 pile division.) Divider = the caster (`controller`,
// the one doing the separating); chooser = the TARGET player (whose own
// creatures are being divided) — the pile-division table's "Divider: you /
// Chooser: that player" row. The chosen pile is destroyed via `forEach {
// set: "bound" }` + `destroy` with `cantBeRegenerated: true` (the widened Op,
// ADR 0053); the other pile has no consequence (an empty `otherEffect`).
export const doOrDie: CardDefinition = {
    id: "05f63cd9-e82b-4cf8-b8ce-f0aa0157692b",
    name: "Do or Die",
    rarity: "rare",
    oracleText:
        "Separate all creatures target player controls into two piles. Destroy all creatures in the pile of that player's choice. They can't be regenerated.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "divideIntoPiles",
            objects: {
                set: "permanents",
                zone: "battlefield",
                controller: { target: 0 },
                filter: { type: "Creature" },
            },
            divider: "controller",
            chooser: { target: 0 },
            dividePrompt: "Do or Die — divide the creatures into two piles.",
            pickPrompt:
                "Choose a pile: creatures in it are destroyed and can't be regenerated.",
            chosenBind: "$doOrDieChosen",
            otherBind: "$doOrDieOther",
            chosenEffect: [
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$doOrDieChosen" },
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$each" },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
            otherEffect: [],
        },
    ],
};
