// SOS (Secrets of Strixhaven) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through
// sos/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.
import type { CardDefinition } from "../../types";

// Traumatic Critique — {X}{U}{R} Instant. "Traumatic Critique deals X damage to
// any target. Draw two cards, then discard a card." CR 107.3 X cost (read via
// getX()), CR 115.4 "any target", CR 121.1 draw, CR 701.9 discard. Stepped
// resolution: the irreversible damage + draw run first, then the discard pick
// can suspend without re-running them (CR 608.2).
export const traumaticCritique: CardDefinition = {
    id: "2a812fa7-4599-4e25-97db-20ffc6bc0b26",
    rarity: "common",
    name: "Traumatic Critique",
    oracleText:
        "Traumatic Critique deals X damage to any target. Draw two cards, then discard a card.",
    manaCost: { X: "X", U: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolveSteps()→effects[] (ADR 0045, #852): X damage to any target
    // (CR 120.1, chosen-cost `{ X: true }`) + draw two, then a `choice`-driven
    // discard of one (CR 701.9 — Jalum Tome loot shape). The choice Op suspends
    // resolution and resumes AT the choice (the interpreter's pre-order cursor
    // guarantees the irreversible damage + draw never re-run — CR 608.3), so the
    // two resolveSteps collapse into one script.
    effects: [
        { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 1,
            prompt: "Discard a card (Traumatic Critique).",
            bind: "$discard",
        },
        { op: "discard", player: "controller", cards: { ref: "$discard" } },
    ],
};

// Witherbloom Charm — "Choose one — • You may sacrifice a permanent. If you
// do, draw two cards. • You gain 5 life. • Destroy target nonland permanent
// with mana value 2 or less." (CR 700.2 modal.) Modes have different target
// shapes (modes 1-2 have none, mode 3 targets a permanent) — a card-level
// `targetRequirement` can't flex per chosen mode, and the DSL `optionChoice`
// Op runs on a SINGLE already-announced target set. Uses the legacy `modes`
// mechanism instead (CR 700.2c per-mode target/resolve), the same
// established escape used by Healing Salve (lea/white.ts) for this exact
// cross-mode-target gap.
export const witherbloomCharm: CardDefinition = {
    id: "254437f7-7a8a-4b11-9cea-e8e7ea23c59e",
    rarity: "uncommon",
    name: "Witherbloom Charm",
    oracleText:
        "Choose one —\n• You may sacrifice a permanent. If you do, draw two cards.\n• You gain 5 life.\n• Destroy target nonland permanent with mana value 2 or less.",
    manaCost: { B: 1, G: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "sacrifice-draw",
            label: "You may sacrifice a permanent. If you do, draw two cards.",
            oracleText:
                "You may sacrifice a permanent. If you do, draw two cards.",
            // Migrated resolve()→effects[] (ADR 0045, closes #1280): the
            // mayPay-sacrifice → draw-two shape rides SpellMode's new
            // `effects` site (mirrors Phyrexian Dreadnought, `mir/colorless`).
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: {
                        permanent: {
                            action: "sacrifice",
                            filter: {},
                            count: 1,
                        },
                    },
                    prompt: "Witherbloom Charm: sacrifice a permanent to draw two cards?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [{ op: "draw", player: "controller", count: 2 }],
                },
            ],
        },
        {
            id: "gain-life",
            label: "You gain 5 life.",
            oracleText: "You gain 5 life.",
            // Migrated resolve()→effects[] (ADR 0045): trivial fixed life gain.
            effects: [{ op: "gainLife", player: "controller", amount: 5 }],
        },
        {
            id: "destroy",
            label: "Destroy target nonland permanent with mana value 2 or less.",
            oracleText:
                "Destroy target nonland permanent with mana value 2 or less.",
            targetRequirement: {
                type: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Planeswalker",
                    "Battle",
                ],
                count: 1,
                mvFilter: { max: 2 },
            },
            // Migrated resolve()→effects[] (ADR 0045): destroy the announced target.
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Silverquill Charm — "Choose one — • Put two +1/+1 counters on target
// creature. • Exile target creature with power 2 or less. • Each opponent
// loses 3 life and you gain 3 life." (CR 700.2 modal.) Same cross-mode-target
// gap as Witherbloom Charm above — uses the legacy `modes` mechanism.
export const silverquillCharm: CardDefinition = {
    id: "3eb73579-f1c6-4762-81d2-9568ab501fac",
    rarity: "uncommon",
    name: "Silverquill Charm",
    oracleText:
        "Choose one —\n• Put two +1/+1 counters on target creature.\n• Exile target creature with power 2 or less.\n• Each opponent loses 3 life and you gain 3 life.",
    manaCost: { W: 1, B: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counters",
            label: "Put two +1/+1 counters on target creature.",
            oracleText: "Put two +1/+1 counters on target creature.",
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): fixed counters on the
            // announced target (CR 122.1).
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 2,
                },
            ],
        },
        {
            id: "exile",
            label: "Exile target creature with power 2 or less.",
            oracleText: "Exile target creature with power 2 or less.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            // Migrated resolve()→effects[] (ADR 0045): exile the announced target.
            effects: [{ op: "exile", target: { target: 0 } }],
        },
        {
            id: "drain",
            label: "Each opponent loses 3 life and you gain 3 life.",
            oracleText: "Each opponent loses 3 life and you gain 3 life.",
            // Migrated resolve()→effects[] (ADR 0045): 2-player engine (CLAUDE.md
            // "3+ player multiplayer" out of scope), so `"opponent"` IS "each
            // opponent" — same idiom as mh2/black.ts.
            effects: [
                { op: "loseLife", player: "opponent", amount: 3 },
                { op: "gainLife", player: "controller", amount: 3 },
            ],
        },
    ],
};

// Quandrix Charm — {G}{U} Instant. "Choose one — Counter target spell unless
// its controller pays {2}. / Destroy target enchantment. / Target creature
// has base power and toughness 5/5 until end of turn." (CR 700.2 modal.)
// Modes have DIFFERENT target shapes (mode 1 targets a spell, mode 2 an
// enchantment, mode 3 a creature) — a card-level `targetRequirement` can't
// flex per chosen mode, and the DSL `optionChoice` Op runs on a SINGLE
// already-announced target set. Uses the legacy `modes` mechanism instead
// (CR 700.2c per-mode target/resolve), the same established escape used by
// Witherbloom Charm/Silverquill Charm above for this exact cross-mode-target
// gap (issue #683 adds mode 1's counter-unless-pay shape and mode 3's
// `setBasePT` set, both already-shipped primitives — Force Spike (leg/blue.ts)
// and Halfdane (leg/multicolor.ts) respectively).
export const quandrixCharm: CardDefinition = {
    id: "318486e0-f255-40f5-8150-dc272eec9d7d",
    rarity: "uncommon",
    name: "Quandrix Charm",
    oracleText:
        "Choose one —\n• Counter target spell unless its controller pays {2}.\n• Destroy target enchantment.\n• Target creature has base power and toughness 5/5 until end of turn.",
    manaCost: { G: 1, U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "counter",
            label: "Counter target spell unless its controller pays {2}.",
            oracleText: "Counter target spell unless its controller pays {2}.",
            targetRequirement: { type: "spell", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): counter-unless-pay,
            // the same mayPay + if(!$paid) + counter shape as Force Spike
            // (leg/blue.ts).
            effects: [
                {
                    op: "mayPay",
                    // CR 117.3a — the spell's controller decides whether to pay.
                    player: { controllerOf: { target: 0 } },
                    cost: { X: 2 },
                    prompt: "Pay {2} to prevent your spell from being countered?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
        },
        {
            id: "destroy-enchantment",
            label: "Destroy target enchantment.",
            oracleText: "Destroy target enchantment.",
            targetRequirement: { type: "Enchantment", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): destroy the announced target.
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "set-pt",
            label: "Target creature has base power and toughness 5/5 until end of turn.",
            oracleText:
                "Target creature has base power and toughness 5/5 until end of turn.",
            targetRequirement: { type: "Creature", count: 1 },
            // DSL-first (ADR 0045): "has base power and toughness 5/5 until end
            // of turn" (CR 613.4b layer 7b, a timestamped base-P/T set locked at
            // resolution CR 611.2) via the `setBasePT` Op on the announced
            // target.
            effects: [
                {
                    op: "setBasePT",
                    target: { target: 0 },
                    power: 5,
                    toughness: 5,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Lorehold Charm — {R}{W} Instant (Cube FREE wave 3, issue #1529). "Choose
// one — • Each opponent sacrifices a nontoken artifact of their choice. •
// Return target artifact or creature card with mana value 2 or less from
// your graveyard to the battlefield. • Creatures you control get +1/+1 and
// gain trample until end of turn." (CR 700.2 modal.) Modes have different
// target shapes (modes 1 and 3 have none, mode 2 targets a graveyard card) —
// same cross-mode-target gap as Witherbloom Charm above; uses the legacy
// `modes` mechanism. UNBLOCKED (this stub's marker previously named #920):
// that stub predated `EffectCardFilter.isToken` (issue #920 itself shipped
// the field it cited as missing) — mode 1's "nontoken artifact" filter is
// exactly `{ type: "Artifact", isToken: false }`, the Sheoldred's Edict precedent
// (`one/black.ts`). Mode 2's mv-capped graveyard reanimation mirrors Sevinne's
// Reclamation's `targetRequirement` (`c19/white.ts`) plus the Reanimate
// `moveZone` reanimation body (`tmp/black.ts`). Mode 3 is a `forEach`-driven
// mass `pump` + `grantAbility` (Sandstorm Salvager precedent, `big/green.ts`).
// All three modes compose from already-shipped Ops — no new Op or construct
// needed.
export const loreholdCharm: CardDefinition = {
    id: "5fe70295-e550-4577-a341-dab6c25aabfd",
    rarity: "uncommon",
    name: "Lorehold Charm",
    oracleText:
        "Choose one —\n• Each opponent sacrifices a nontoken artifact of their choice.\n• Return target artifact or creature card with mana value 2 or less from your graveyard to the battlefield.\n• Creatures you control get +1/+1 and gain trample until end of turn.",
    manaCost: { W: 1, R: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "sacrifice-artifact",
            label: "Each opponent sacrifices a nontoken artifact of their choice.",
            oracleText:
                "Each opponent sacrifices a nontoken artifact of their choice.",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: { type: "Artifact", isToken: false },
                    count: 1,
                    prompt: "Sacrifice a nontoken artifact of your choice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
        {
            id: "reanimate",
            label: "Return target artifact or creature card with mana value 2 or less from your graveyard to the battlefield.",
            oracleText:
                "Return target artifact or creature card with mana value 2 or less from your graveyard to the battlefield.",
            targetRequirement: {
                type: ["Artifact", "Creature"],
                count: 1,
                zone: "graveyard",
                controller: "you",
                mvFilter: { max: 2 },
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                    controller: "controller",
                },
            ],
        },
        {
            id: "pump-trample",
            label: "Creatures you control get +1/+1 and gain trample until end of turn.",
            oracleText:
                "Creatures you control get +1/+1 and gain trample until end of turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Vicious Rivalry — {2}{B}{G} Sorcery. "As an additional cost to cast this
// spell, pay X life. Destroy all artifacts and creatures with mana value X or
// less." (CR 118.4 / 119.4 pay-X-life additional cost, already shipped via
// `additionalCosts.payXLife`, Fire Covenant.)
//
// FREED 2026-08-25 (#1841 audit, shipped by #2761): the old wording claimed
// `EffectCardFilter.manaValueAtMost` is a FIXED literal ceiling with no
// dynamic (chosen-X) form — WRONG, the field is `number | EffectXValue`
// (Green Sun's Zenith, `mbs/green.ts`). That correction is right but its
// PRECEDENT does not transfer as written: Green Sun's Zenith's
// `manaValueAtMost: { X: true }` is a LIBRARY-SEARCH filter, read by
// `matchesCardFilter`. The battlefield-scoped filter every `forEach { set:
// "permanents" }` mass sweep goes through instead is `PermanentFilter`
// (`toPermanentFilter`, `convex/gre/effects/interpreter.ts`), which carries NO
// `manaValueAtMost` field — confirmed against `convex/cards/filters.ts` and
// `EffectObjectMatchesFilterPredicate`'s own doc comment, which lists
// `manaValueAtMost` among the fields "the battlefield matcher has no
// counterpart for" (i.e. putting it on a `forEach` filter directly would
// silently match EVERY permanent, fail-open, not just ones at or under X).
// The CR-correct, already-shipped composition that actually reaches the
// battlefield case: `forEach { set: "permanents", filter: { type:
// ["Artifact", "Creature"] } }` (the Rout/Wrath-of-God mass-sweep shape,
// `inv/white.ts`) wrapping an `if { manaValue: { of: $each } } le X` gate (the
// Overload shape, `inv/red.ts`, CR 202.3) around `destroy`. Still no new Op or
// construct — `forEach`, `if`, `manaValue`, and `destroy` are each already
// exercised catalogue-wide; only the COMPOSITION is corrected here.
export const viciousRivalry: CardDefinition = {
    id: "6fa9cd18-3181-4373-ab65-49bf9de9487f",
    name: "Vicious Rivalry",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, pay X life.\nDestroy all artifacts and creatures with mana value X or less.",
    manaCost: { X: 2, B: 1, G: 1 },
    types: ["Sorcery"],
    additionalCosts: { payXLife: true },
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: ["Artifact", "Creature"] },
            },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { ref: "$each" } } },
                        op: "le",
                        right: { X: true },
                    },
                    then: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    ],
};
