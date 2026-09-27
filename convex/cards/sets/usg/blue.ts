// usg — blue cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Annul — {U} Instant. "Counter target artifact or enchantment spell."
// (CR 701.6a counter; CR 114.1 spell targeting.) A conditional Counterspell
// restricted to a subset of spell CARD TYPES. Expressed DSL-first (ADR 0045):
// the `counter` Op reused unchanged, and the artifact-OR-enchantment
// restriction rides the existing `spellTypeFilter` on a `type: "spell"`
// target — the same filter Fork uses for "instant or sorcery spell". An array
// filter matches a spell whose `types` include AT LEAST ONE of the listed
// types (OR semantics, CR 202.2 / 114.1), and abilities on the stack are never
// legal spell targets (CR 701.6a). No new Op or TargetRequirement type.
//
// First Premodern-legal printing in Tolaria's pool is Urza's Saga (usg); Annul
// was NOT printed in Nemesis despite the umbrella issue's file hint, so it
// lives here to keep the print id (`id`) consistent with its set.
export const annul: CardDefinition = {
    id: "3f8c73ff-be92-41ca-93a7-76f9823adb38",
    rarity: "common",
    name: "Annul",
    oracleText: "Counter target artifact or enchantment spell.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Artifact", "Enchantment"],
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Hibernation — {2}{U} Instant. "Return all green permanents to their owners'
// hands." (CR 400.7 zone change; CR 105 / 202.2 colour; CR 111.7 a bounced
// token ceases to exist, SBA-enforced.) A colour-filtered mass bounce — the
// Upheaval pattern (forEach over EVERY battlefield + `moveZone` to hand,
// ody/blue.ts) narrowed by a `filter: { color: "G" }` on the `forEach`
// selector. No `controller` scope — "all green permanents", every player's;
// no type restriction — any permanent type that is green. The colour predicate
// rides the existing `EffectCardFilter.color` field, matched against EFFECTIVE
// colours (`getBattlefieldIds` populates layer-5 colour via the shared
// static-effect derivation, CR 202.2), so a permanent made green by another
// effect is caught and a green card made colourless is spared. Reuse-only Ops
// (`forEach` + `moveZone`, both censused): the interpreter suite already
// exercises forEach-with-filter and the forEach+moveZone mass bounce; a
// dedicated colour-filtered-bounce assertion lives in the interpreter test.
//
// First printing is Urza's Saga (usg), 1998 — Hibernation was NOT printed in
// Nemesis despite the umbrella issue's nem/blue.ts file hint, so it lives here
// to keep the print id (`id`) consistent with its set (cf. Annul above).
export const hibernation: CardDefinition = {
    id: "68b7444c-fabb-4437-8db9-a1008ea09415", // USG 79
    rarity: "uncommon",
    name: "Hibernation",
    oracleText: "Return all green permanents to their owners' hands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { color: "G" },
            },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

// Show and Tell — {2}{U} Sorcery (Cube FREE residue, issue #1308). "Each
// player may put an artifact, creature, enchantment, or land card from their
// hand onto the battlefield." A per-player OPTIONAL hand-to-battlefield put —
// the Sneak Attack `moveZone.cards` shape (usg/red.ts's `sneakAttack`),
// scoped to EVERY player instead of just the controller: a `forEach { set:
// "players" }` (CR 101.4 APNAP order, the Innocent Blood shape,
// ody/black.ts) whose body raises a `choose-hand-card` choice with
// `count: { min: 0, max: 1 }` ("may put ... a card", CR 608.2b — a 0-count
// pick is a legal decline) restricted to the four named card types (`type`
// is an OR-within-field array, issue #677), then moves the pick from hand to
// the battlefield via the SAME `moveZone` shape Sneak Attack uses (no `bind`
// needed here — nothing acts on the entered permanent afterward).
export const showAndTell: CardDefinition = {
    id: "4b851c17-55ed-4671-b471-dc7b34944432", // USG 96
    rarity: "rare",
    name: "Show and Tell",
    oracleText:
        "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$each" },
                    zone: "hand",
                    filter: {
                        type: ["Artifact", "Creature", "Enchantment", "Land"],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Show and Tell: put an artifact, creature, enchantment, or land card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: { ref: "$each" },
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Time Spiral — {4}{U}{U} Sorcery (Cube FREE residue, issue #1308). "Exile
// Time Spiral. Each player shuffles their hand and graveyard into their
// library, then draws seven cards. You untap up to six lands."
//
// An Effect Script (ADR 0045) on three already-shipped shapes, in Oracle order:
//   • "Exile Time Spiral" (CR 608.2m) — the `exileSelf` Op (Recall's shape).
//   • The middle clause is Timetwister's script verbatim (lea/blue.ts):
//     `moveZone`'s whole-zone shape (issue #1279) hand→library and
//     graveyard→library, a shuffle, then seven draws, under
//     `forEach { set: "players" }`. The `forEach` is ONE instruction (issue
//     #3242, CR 603.2c), so all four moves are one library-entry event.
//   • "You untap up to six lands" — no "you control" restriction, so the pool
//     is every land on either battlefield: a ranged 0..6 `choose-permanents`
//     pick with `allControllers` (Frantic Search's shape, ulg/blue.ts), then a
//     `forEach` untap over the picks.
// The draws are irreversible, but a suspension on the untap choice resumes at
// the choice's own checkpoint, so the script never replays them: each
// instruction runs once, in the order written (CR 608.2c).
export const timeSpiral: CardDefinition = {
    id: "f3d62dbd-63db-4ac9-950f-9852627f23f2", // USG 103
    rarity: "rare",
    name: "Time Spiral",
    oracleText:
        "Exile Time Spiral. Each player shuffles their hand and graveyard into their library, then draws seven cards. You untap up to six lands.",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    effects: [
        { op: "exileSelf" },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "hand",
                    to: "library",
                },
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "library",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { ref: "$each" },
                },
                { op: "draw", player: { ref: "$each" }, count: 7 },
            ],
        },
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            allControllers: true,
            filter: { type: "Land" },
            count: { min: 0, max: 6 },
            prompt: "Time Spiral: untap up to six lands.",
            bind: "$lands",
        },
        {
            op: "forEach",
            select: { set: "bound", ref: "$lands" },
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$each" } },
            ],
        },
    ],
};

// Attunement — {2}{U} Enchantment. "Return this enchantment to its owner's
// hand: Draw three cards, then discard four cards."
//
// The whole card is one ACTIVATION COST the engine had no field for. CR 602.1a
// — "The activation cost is everything before the colon (:)" — so "Return this
// enchantment to its owner's hand" is paid as the ability goes on the stack
// (CR 601.2h via CR 602.2b), not at resolution: the enchantment is already in
// hand while the ability sits on the stack, an opponent cannot destroy it in
// response, and the returned card is itself one of the cards the resolution
// may discard. That leg is `cost.returnThisToHand` (issue #3204), the bounce
// twin of `cost.exileThis` — battlefield-source only, no player choice, paid
// through the single authority `payReturnThisToHandCost` (`gre/state.ts`),
// which routes it through `removePermanentTo(…, "hand")` so CR 400.3's "it
// goes to its OWNER's hand" holds without this card restating it.
//
// Deliberately NOT `returnUnblockedAttacker` (CR 702.49a ninjutsu): that leg
// returns a CHOSEN unblocked attacker through the `sacrificeChoice` selection
// layer. This one returns THIS source — nothing to choose — so it belongs
// beside `sacrifice` / `exileThis`, never with the selection layer.
//
// The BODY is a plain Effect Script on already-exercised Ops (ADR 0045), so it
// owes no hand-written per-card test under the per-Op regime: `draw` 3, then a
// `choice` (kind "choose-hand-card") over the controller's own hand bound to
// `$discards`, then `discard` of that binding. The discard is the PLAYER's
// pick, never auto-resolved, and it is mandatory — a plain `count: 4` clamps
// to the candidate set (the interpreter's `Math.min(op.count, available)`), so
// a hand of two discards both (CR 101.3 — do as much as possible; CR 701.9a
// defines the discard itself) and a fuller hand leaves the caster no way to
// decline. Repeatable by design:
// the enchantment is in hand, so recasting it is the loop the deck is built on.
//
// Bot reachability (three seams). `enumerateMoves` reaches the activation and
// `applyActivationCostsForSearch` pays the bounce on both search entry points
// (`returnThisToHandCostInSearch.bot.test.ts`); `draw` and `discard` both carry
// an OP_VALUERS entry and an OP_BENEFICENCE sign, so the payoff is not neutral.
// The choice surface is the WEAK seam and it is declared, not papered over:
// `handPickCandidates` (`gre/ai/choiceCandidates.ts`) is scoped to OPTIONAL
// hand picks (`min === 0`) by its own doc, so this MANDATORY count-4 discard is
// not a search node and falls back to brain.ts's minimal-legal policy — the Bot
// discards the first four cards in hand order. Not a freeze and not new (every
// mandatory hand pick in the pool behaves this way), but not a real decision
// either; widening that generator is the separate, wider change its comment
// names.
//
// The cost round-trips through the grammar's `return-self` atom
// (`oracle/grammar/shared/cost.ts`), the body through the loot sentence
// (issue #4126).
export const attunement: CardDefinition = {
    id: "f6723528-8b2c-4beb-a465-800300faf158",
    rarity: "rare",
    name: "Attunement",
    oracleText:
        "Return this enchantment to its owner's hand: Draw three cards, then discard four cards.",
    manaCost: { U: 1, generic: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "attunement-draw-discard",
            oracleText:
                "Return this enchantment to its owner's hand: Draw three cards, then discard four cards.",
            cost: { returnThisToHand: true },
            useStack: true,
            effects: [
                { op: "draw", player: "controller", count: 3 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 4,
                    prompt: "Attunement: discard four cards.",
                    bind: "$discards",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discards" },
                },
            ],
        },
    ],
};
