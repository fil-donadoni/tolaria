// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.
//
// ATQ is artifact-heavy, so this module holds the bulk of the set: every
// colourless artifact and land.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    ManaCost,
    PermanentView,
    SpellContext,
    TargetSelection,
    TokenSpec,
    TriggeredAbility,
} from "../../types";
import { cantBeEnchantedSelfGuard, PERMANENT_TYPES } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapTrigger } from "../../abilities/triggers/untapTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla / keyword artifact creatures (CR 702 — keywords map to
// `staticAbilities[]`; CR 301 — artifact creatures are both Artifact and
// Creature, affected by both artifact and creature rules)
// ─────────────────────────────────────────────────────────────────────────────

// Ornithopter — {0} Artifact Creature — Thopter, 0/2 with flying (CR 702.9).
// The classic free flyer; a zero-cost evasive blocker/chump.
export const ornithopter: CardDefinition = {
    id: "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0",
    rarity: "common",
    name: "Ornithopter",
    oracleText: "Flying",
    manaCost: {},
    types: ["Artifact", "Creature"],
    subtypes: ["Thopter"],
    power: 0,
    toughness: 2,
    staticAbilities: ["flying"],
};

// Yotian Soldier — {3} Artifact Creature — Soldier, 1/4 with vigilance
// (CR 702.21). A durable attacker that stays back to block.
export const yotianSoldier: CardDefinition = {
    id: "27cf53e3-76f6-4831-800e-1259394d779d",
    rarity: "common",
    name: "Yotian Soldier",
    oracleText: "Vigilance",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Soldier"],
    power: 1,
    toughness: 4,
    staticAbilities: ["vigilance"],
};

// Wall of Spears — {3} Artifact Creature — Wall, 2/3 with defender + first
// strike (CR 702.3 defender — can't attack; CR 702.7 first strike — deals
// combat damage in the first-strike step). Pure keyword mapping, no resolve().
export const wallOfSpears: CardDefinition = {
    id: "b1dda179-c49a-4995-ba5a-db93ac43dbe7",
    rarity: "uncommon",
    name: "Wall of Spears",
    oracleText: "Defender (This creature can't attack.)\nFirst strike",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 3,
    staticAbilities: ["defender", "first strike"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifact creatures with activated abilities (CR 605 — activated abilities;
// CR 611.1 temp P/T mods; CR 701.15 regeneration; CR 502.1 untap restriction)
// ─────────────────────────────────────────────────────────────────────────────

// Dragon Engine — {3} Artifact Creature — Construct, 1/3 with "{2}: This
// creature gets +1/+0 until end of turn." (CR 611.1 temporary P/T modification,
// CR 514.2 cleanup expiry). Same shape as Wall of Water's pump (lea.ts).
export const dragonEngine: CardDefinition = {
    id: "07793a71-1106-4303-b620-e403bd378020",
    rarity: "common",
    name: "Dragon Engine",
    oracleText: "{2}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "dragon-engine-pump",
            oracleText: "{2}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
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

// Clay Statue — {4} Artifact Creature — Golem, 3/1 with "{2}: Regenerate this
// creature." (CR 701.15a regeneration shield — the next time this would be
// destroyed this turn, instead tap it, remove damage, and remove it from
// combat). The shield is armed via `applyRegenerationShield` on the source.
export const clayStatue: CardDefinition = {
    id: "64975352-8d35-4d02-94ac-fa0c6ee12409",
    rarity: "common",
    name: "Clay Statue",
    oracleText: "{2}: Regenerate this creature.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 3,
    toughness: 1,
    activatedAbilities: [
        {
            id: "clay-statue-regen",
            oracleText: "{2}: Regenerate this creature.",
            cost: { mana: { X: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #846): a self-regenerate
            // shield on the source (CR 701.15a) via the implicit $source.
            effects: [{ op: "regenerate", target: { ref: "$source" } }],
        },
    ],
};

// Grapeshot Catapult — {4} Artifact Creature — Construct, 2/3 with "{T}: This
// creature deals 1 damage to target creature with flying." (CR 605 activated
// ability with a tap cost and a target; CR 120.3 damage; CR 702.9 the
// `requireAbility: "flying"` filter restricts legal targets to flyers).
export const grapeshotCatapult: CardDefinition = {
    id: "4c7a7348-c82e-453c-975c-e5365e152a3a",
    rarity: "common",
    name: "Grapeshot Catapult",
    oracleText:
        "{T}: This creature deals 1 damage to target creature with flying.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "grapeshot-catapult-bolt",
            oracleText:
                "{T}: This creature deals 1 damage to target creature with flying.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "flying",
            },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Colossus of Sardia — {9} Artifact Creature — Golem, 9/9 with trample +
// "This creature doesn't untap during your untap step. {9}: Untap this
// creature. Activate only during your upkeep." (CR 702.19 trample; CR 502.1
// untap restriction via the `does-not-untap` keyword read by `untapStep` in
// phases.ts; CR 602.5b activation timing — `activationPhaseRestriction:
// ["UPKEEP"]` + `controllerTurnOnly` enforces "during your upkeep").
export const colossusOfSardia: CardDefinition = {
    id: "067c44e9-1b23-42fd-9acb-daafb62c32a2",
    rarity: "rare",
    name: "Colossus of Sardia",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nThis creature doesn't untap during your untap step.\n{9}: Untap this creature. Activate only during your upkeep.",
    manaCost: { X: 9 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 9,
    toughness: 9,
    staticAbilities: ["trample", "does-not-untap"],
    activatedAbilities: [
        {
            id: "colossus-of-sardia-untap",
            oracleText:
                "{9}: Untap this creature. Activate only during your upkeep.",
            cost: { mana: { X: 9 } },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            // Migrated resolve()→effects[] (ADR 0045, #842): untap the source
            // creature (CR 701.26b). `$source` is the resolving permanent.
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple non-creature permanents (CR 305 lands, CR 301 artifacts)
// ─────────────────────────────────────────────────────────────────────────────

// Strip Mine — Land with "{T}: Add {C}." and "{T}, Sacrifice this land:
// Destroy target land." (CR 605.1a/605.3a mana ability useStack:false; CR
// 701.7 destroy via a sacrifice-cost activated ability that uses the stack so
// it can be responded to). The sac cost is paid at activation; the destroy
// resolves later from the stack.
export const stripMine: CardDefinition = {
    id: "e7880157-7f27-4f1b-9cdc-ab36a6252376",
    rarity: "uncommon",
    name: "Strip Mine",
    oracleText: "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "strip-mine-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
        },
        {
            id: "strip-mine-destroy",
            oracleText: "{T}, Sacrifice this land: Destroy target land.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Obelisk of Undoing — Artifact with "{6}, {T}: Return target permanent you
// both own and control to your hand." (CR 701.10 return to hand; CR 605
// activated ability with mana + tap cost; the `controller: "you"` filter
// scopes legal targets to permanents the activator controls — and, since you
// can only own-and-control a permanent you also own, this is effectively "you
// both own and control"). `type: "any"` matches only damageable permanent
// types (CR 115.4 — creature/planeswalker/battle), so the target uses the full
// CR 300.1 permanent-type set (incl. Land) to honor "target permanent" of any
// type. Mana cost {1} per MTGJSON ATQ.json (ADR 0004 authoritative).
export const obeliskOfUndoing: CardDefinition = {
    id: "1ba61ccd-4429-4f7c-b9f3-30867878d88e",
    rarity: "rare",
    name: "Obelisk of Undoing",
    oracleText:
        "{6}, {T}: Return target permanent you both own and control to your hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "obelisk-of-undoing-return",
            oracleText:
                "{6}, {T}: Return target permanent you both own and control to your hand.",
            cost: { tap: true, mana: { X: 6 } },
            useStack: true,
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                controller: "you",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted permanent to its owner's hand (CR 701.10 / 400.7).
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Feldon's Cane — {1} Artifact. "{T}, Exile this artifact: Shuffle your
// graveyard into your library." (CR 400.7 zone change + CR 701.20 shuffle.)
// Composition: moveZone(graveyard → library) appends the graveyard cards to the
// library, then shuffleLibrary randomizes — exactly "shuffle your graveyard
// into your library".
//
// PRIMITIVE GAP / DIVERGENCE (flagged, no engine change): there is no `exile`
// activation-cost kind on ActivatedAbility (only tap/mana/sacrifice/life/
// counter/discard). "Exile this artifact" is a *cost*, so strictly it should be
// paid at activation; here it's modeled inside resolve() via
// `exile(sourceInstanceId)`. Practical effect is identical for this card — the
// only observable difference is that, with the cost-vs-effect distinction, the
// source would already be in exile while the ability is on the stack. Since the
// ability shuffles the graveyard (not the source) and exiling self has no
// stack-interactive payoff, the resolve-body model is behaviourally equivalent
// for the current card pool. A general `exile`/`exileSelf` cost kind is
// deferred to a feature tranche (tracked-by: #1212).
export const feldonsCane: CardDefinition = {
    id: "bb6af436-bcfd-4d47-a1aa-e84b587a725a",
    rarity: "uncommon",
    name: "Feldon's Cane",
    oracleText:
        "{T}, Exile this artifact: Shuffle your graveyard into your library.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "feldons-cane-shuffle",
            oracleText:
                "{T}, Exile this artifact: Shuffle your graveyard into your library.",
            cost: { tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // Exile-as-cost modeled in the resolve body (no `exile` cost
                // kind — see divergence note above). Exile self FIRST so the
                // Cane is not among the cards shuffled into the library.
                ctx.exile({ type: "permanent", id: ctx.sourceInstanceId });
                ctx.moveZone(ctx.controller, "graveyard", "library");
                ctx.shuffleLibrary(ctx.controller);
            },
        },
    ],
};

// Millstone — {2} Artifact. "{2}, {T}: Target player mills two cards." (CR
// 701.17 mill — put the top N cards of a library into its owner's graveyard.)
// Authored DSL-first as an Effect Script (ADR 0045, issue #885): the {2}+tap
// activated ability's `mill` Op mills the announced target player two cards
// (re-reading the live top id each pass; stops naturally when the library
// empties, CR 701.17a).
export const millstone: CardDefinition = {
    id: "107646bc-2181-49f4-8821-1eaa46291855",
    rarity: "uncommon",
    name: "Millstone",
    oracleText: "{2}, {T}: Target player mills two cards.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "millstone-mill",
            oracleText: "{2}, {T}: Target player mills two cards.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "mill", player: { target: 0 }, count: 2 }],
        },
    ],
};

// Jalum Tome — {3} Artifact — Book. "{2}, {T}: Draw a card, then discard a
// card." (CR 121.1 draw, CR 701.8 discard; loot.) Composition: drawCards(1)
// then a `choose-hand-card` choice to pick which card to discard (modern oracle
// text: the player chooses). The discard happens "then" — sequenced via a
// two-step resolve so the drawn card is in hand before the discard pick.
export const jalumTome: CardDefinition = {
    id: "5a5b7c5a-ee63-4a1b-9a0f-fb0a309168df",
    rarity: "uncommon",
    name: "Jalum Tome",
    oracleText: "{2}, {T}: Draw a card, then discard a card.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    subtypes: ["Book"],
    activatedAbilities: [
        {
            id: "jalum-tome-loot",
            oracleText: "{2}, {T}: Draw a card, then discard a card.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

// Candelabra of Tawnos — {1} Artifact. "{X}, {T}: Untap X target lands." (CR
// 107.3 X chosen at activation, CR 601.2c X-bound target count, CR 701.20b
// untap.) `count: "X"` resolves the number of land targets against the chosen
// value of X at activation; a 0-X activation skips target selection and
// untaps nothing.
export const candelabraOfTawnos: CardDefinition = {
    id: "35a335bf-7358-460f-b7c9-1e8bc4300f64",
    rarity: "rare",
    name: "Candelabra of Tawnos",
    oracleText: "{X}, {T}: Untap X target lands.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "candelabra-untap",
            oracleText: "{X}, {T}: Untap X target lands.",
            cost: { tap: true, mana: { X: "X" } },
            useStack: true,
            targetRequirement: { type: "Land", count: "X" },
            // Migrated resolve()→effects[] (ADR 0045): untaps every one of the
            // VARIABLE (X) announced land targets via the `forEach { set:
            // "targets" }` selector (issue #1083's X-multi-target closer —
            // Distorting Wake, inv/blue.ts) + `tapUntap` on each `$each`
            // member (CR 701.20b). A 0-X activation announces no targets, so
            // the forEach body simply never runs.
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Urza's Chalice — {1} Artifact. "Whenever a player casts an artifact spell,
// you may pay {1}. If you do, you gain 1 life." (CR 603.2 SPELL_CAST trigger,
// scope "any"; CR 117.3a optional may-pay → gainLife.) Same shape as the LEA
// color-sphere cycle, filtered to artifact spells instead of a color.
export const urzasChalice: CardDefinition = {
    id: "f3728537-86d3-42be-9046-90bba1bfafc1",
    rarity: "common",
    name: "Urza's Chalice",
    oracleText:
        "Whenever a player casts an artifact spell, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "urzas-chalice-life",
            oracleText:
                "Whenever a player casts an artifact spell, you may pay {1}. If you do, you gain 1 life.",
            scope: "any",
            filter: { types: "Artifact" },
            // Migrated resolve()→effects[] (ADR 0045): mayPay {1} (CR 117.3a)
            // then gainLife 1 gated on the $paid outcome — same mayPay + if
            // shape as Fasting (drk/white.ts), riding the same Pending Choice
            // pipeline `requestMayPay` used.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Urza's Chalice?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
        }),
    ],
};

// Onulet — {3} Artifact Creature — Construct, 2/2. "When this creature dies,
// you gain 2 life." (CR 700.4 death = battlefield→graveyard; CR 603.2 death
// trigger scoped to self.)
export const onulet: CardDefinition = {
    id: "d77fe8e2-8438-473e-ace5-01baddd2c4ed",
    rarity: "uncommon",
    name: "Onulet",
    oracleText: "When this creature dies, you gain 2 life.",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): the `gainLife` clause itself is
        // trivially Op-expressible, but the `diedTrigger` factory
        // (`abilities/triggers/diedTrigger.ts`) only accepts a `resolve`
        // callback — it has no `effects` alternative to route a declarative
        // script through (same class as Su-Chi below, #841/#847). Planned-
        // migratable once `diedTrigger` takes a declarative body.
        // Blocked on: `diedTrigger` factory support for `effects`.
        diedTrigger({
            id: "onulet-life",
            oracleText: "When this creature dies, you gain 2 life.",
            scope: "self",
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 2);
            },
        }),
    ],
};

// Su-Chi — {4} Artifact Creature — Construct, 4/4. "When this creature dies,
// add {C}{C}{C}{C}." (CR 603.2 death trigger scoped to self; CR 106.1 the
// added mana goes to the trigger's controller's pool via addManaTo.) The mana
// is added on resolution — it empties at end of the step/phase like any mana.
export const suChi: CardDefinition = {
    id: "a64d4f93-0c04-4078-aec0-7e9de92f260f",
    rarity: "uncommon",
    name: "Su-Chi",
    oracleText: "When this creature dies, add {C}{C}{C}{C}.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): the `addMana` clause is trivial, but a
        // `diedTrigger` FACTORY hardcodes its `resolve` and exposes no
        // `effects[]` site (same class as the createToken/counters factory
        // triggers, #841/#847). Planned-migratable once trigger factories take a
        // declarative body. Blocked on: factory-trigger effects[] site.
        diedTrigger({
            id: "su-chi-mana",
            oracleText: "When this creature dies, add {C}{C}{C}{C}.",
            scope: "self",
            resolve: (ctx) => {
                ctx.addManaTo(ctx.controller, { C: 4 });
            },
        }),
    ],
};

// Tablet of Epityr — {1} Artifact. "Whenever an artifact you control is put
// into a graveyard from the battlefield, you may pay {1}. If you do, you gain
// 1 life." (CR 603.2 PERMANENT_LEFT trigger, toZone graveyard + scope "yours"
// + Artifact filter; CR 117.3a optional may-pay.)
export const tabletOfEpityr: CardDefinition = {
    id: "6d7a2718-301f-4191-b348-0c44c7c07d43",
    rarity: "common",
    name: "Tablet of Epityr",
    oracleText:
        "Whenever an artifact you control is put into a graveyard from the battlefield, you may pay {1}. If you do, you gain 1 life.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "tablet-of-epityr-life",
            oracleText:
                "Whenever an artifact you control is put into a graveyard from the battlefield, you may pay {1}. If you do, you gain 1 life.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Artifact" },
            // Migrated resolve()→effects[] (ADR 0045): mayPay {1} (CR 117.3a)
            // then gainLife 1 gated on the $paid outcome, riding
            // `leftTrigger`'s `effects` site.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 1 },
                    prompt: "Pay {1} to gain 1 life from Tablet of Epityr?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
        }),
    ],
};

// Ivory Tower — {1} Artifact. "At the beginning of your upkeep, you gain X
// life, where X is the number of cards in your hand minus 4." (CR 603.6a
// upkeep trigger scoped to "your"; gain is clamped at 0 — you never lose life
// when hand < 4.)
export const ivoryTower: CardDefinition = {
    id: "a5f23039-45ca-4c15-af50-bfd40ea26453",
    rarity: "uncommon",
    name: "Ivory Tower",
    oracleText:
        "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): the gain amount is "hand size minus
        // 4" — the `EffectCount` construct's `zone` is only
        // `"battlefield" | "graveyard"` (no hand-size read) and, even if it
        // were, the value grammar (literal | ref | count) has no arithmetic
        // to subtract a constant from a live count. The clamp-at-0 (never
        // lose life when hand < 4) compounds this — same class as the
        // Stream of Life / Earthquake X-value gap the playbook documents.
        // Blocked on: a hand-size count zone + an arithmetic/subtract value
        // construct.
        phaseTrigger({
            id: "ivory-tower-life",
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, playerId) => {
                const x = ctx.getHandSize(playerId) - 4;
                if (x > 0) ctx.gainLife(playerId, x);
            },
        }),
    ],
};

// Armageddon Clock — {6} Artifact. Doom-counter time bomb:
//  • "At the beginning of your upkeep, put a doom counter on this artifact."
//  • "At the beginning of your draw step, this artifact deals damage equal to
//    the number of doom counters on it to each player."
//  • "{4}: Remove a doom counter from this artifact. Any player may activate
//    this ability but only during any upkeep step."
// (CR 603.6a phase triggers; CR 122.1 doom counter — inert to P/T; CR 113.3c
// any-player activation via activatableByAnyPlayer + UPKEEP phase
// restriction.) The draw-step ping reads the live counter count and damages
// each player in APNAP order.
export const armageddonClock: CardDefinition = {
    id: "44a31889-6a8d-450c-a73d-381a7ff28bf9",
    rarity: "uncommon",
    name: "Armageddon Clock",
    oracleText:
        "At the beginning of your upkeep, put a doom counter on this artifact.\nAt the beginning of your draw step, this artifact deals damage equal to the number of doom counters on it to each player.\n{4}: Remove a doom counter from this artifact. Any player may activate this ability but only during any upkeep step.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "armageddon-clock-add-doom",
            oracleText:
                "At the beginning of your upkeep, put a doom counter on this artifact.",
            phase: "UPKEEP",
            scope: "your",
            // CR 122 (issue #841) — put one doom counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "doom",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
        phaseTrigger({
            id: "armageddon-clock-ping",
            oracleText:
                "At the beginning of your draw step, this artifact deals damage equal to the number of doom counters on it to each player.",
            phase: "DRAW",
            scope: "your",
            resolve: (ctx) => {
                const doom = ctx.getCounterCount(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "doom"
                );
                if (doom <= 0) return;
                for (const playerId of ctx.apNapOrder()) {
                    ctx.dealDamage({ type: "player", id: playerId }, doom);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "armageddon-clock-remove-doom",
            oracleText:
                "{4}: Remove a doom counter from this artifact. Any player may activate this ability but only during any upkeep step.",
            cost: { mana: { X: 4 } },
            useStack: true,
            // "only during any upkeep step" — any player's upkeep, so phase
            // restriction without controllerTurnOnly. "Any player may
            // activate" — CR 113.3c.
            activationPhaseRestriction: ["UPKEEP"],
            activatableByAnyPlayer: true,
            // CR 122 (issue #841) — remove one doom counter from the source.
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: "doom",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        },
    ],
};

// Triskelion — {6} Artifact Creature — Construct, 1/1, enters with three +1/+1
// counters. "Remove a +1/+1 counter from this creature: It deals 1 damage to
// any target." (CR 122.1 ETB counters via entersWith; CR 122.6 counter-removal
// cost; CR 115.4 "any target" = damageable permanent or player.)
export const triskelion: CardDefinition = {
    id: "a79c99e1-722a-44b6-8fa3-2be3f0c193d8",
    rarity: "rare",
    name: "Triskelion",
    oracleText:
        "This creature enters with three +1/+1 counters on it.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
    activatedAbilities: [
        {
            id: "triskelion-bolt",
            oracleText:
                "Remove a +1/+1 counter from this creature: It deals 1 damage to any target.",
            cost: { removeCounter: { type: "+1/+1", count: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Clockwork Avian — {5} Artifact Creature — Bird, 0/4 with flying, enters with
// four +1/+0 counters. (Twin of Clockwork Beast in lea.ts, capped at four
// instead of seven and with flying.)
//  • "At end of combat, if this creature attacked or blocked this combat,
//    remove a +1/+0 counter from it." (CR 603.6a END_OF_COMBAT + CR 603.4d
//    intervening-if on the attacked/blocked markers.)
//  • "{X}, {T}: Put up to X +1/+0 counters on this creature. This ability
//    can't cause the total ... to be greater than four. Activate only during
//    your upkeep." (CR 122.1; the {X} pipeline + add-capped-to-four resolve +
//    UPKEEP/your-turn activation restriction.)
export const clockworkAvian: CardDefinition = {
    id: "1dea8c2f-4aea-478d-aee7-cba1f74edd6c",
    rarity: "rare",
    name: "Clockwork Avian",
    oracleText:
        "Flying\nThis creature enters with four +1/+0 counters on it.\nAt end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.\n{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than four. Activate only during your upkeep.",
    manaCost: { X: 5 },
    types: ["Artifact", "Creature"],
    subtypes: ["Bird"],
    power: 0,
    toughness: 4,
    staticAbilities: ["flying"],
    entersWith: { counters: [{ type: "+1/+0", count: 4 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "clockwork-avian-decay",
            oracleText:
                "At end of combat, if this creature attacked or blocked this combat, remove a +1/+0 counter from it.",
            phase: "END_OF_COMBAT",
            scope: "each",
            // CR 603.4d intervening-if — the "attacked or blocked this combat"
            // markers persist past END_OF_COMBAT, so the resolve-time re-check
            // sees the same values (mirrors Clockwork Beast).
            interveningIf: (_event, self) =>
                self.hasAttackedThisTurn === true ||
                self.hasBlockedThisTurn === true,
            // CR 122 (issue #841) — shed one +1/+0 counter from the source.
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: "+1/+0",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "clockwork-avian-recharge",
            oracleText:
                "{X}, {T}: Put up to X +1/+0 counters on this creature. This ability can't cause the total number of +1/+0 counters on this creature to be greater than four. Activate only during your upkeep.",
            cost: { mana: { X: "X" }, tap: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            // NOT DSL-migratable (ADR 0045, #852): "up to X counters, capped so
            // the total never exceeds four" is min(X, 4 - current) — ARITHMETIC
            // the value grammar has no construct for. The `{ X: true }` member
            // supplies X but cannot express the clamp. Classifier over-count
            // (folds counters + getX, blind to the cap math).
            resolve: (ctx: SpellContext) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const current = ctx.getCounterCount(self, "+1/+0");
                // Up to X counters, capped so the total never exceeds four.
                const room = Math.max(0, 4 - current);
                const add = Math.min(ctx.getX(), room);
                if (add > 0) ctx.addCounter(self, "+1/+0", add);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// P/T statics, combat & one-shot prevention shields (free tranche, #277) —
// CR 611 (layer 7c P/T buffs), CR 604.3 (characteristic-defining P/T), CR
// 611.1 (temporary P/T mods + animate), CR 615 (one-shot damage prevention),
// CR 702.21j (banding via grantStaticAbility), CR 117.3a (optional may-pay),
// CR 705 (coin flip). Modern Scryfall oracle text is authoritative (ADR 0004);
// mana costs / type lines come from MTGJSON ATQ.json. Every effect reuses
// existing staticEffects kinds, the COP factory, animateAsCreature, and
// SpellContext prevention/keyword primitives — no new primitive, no engine
// change. Divergences (animate can't add the Artifact type; Urza's Avenger's
// keyword choice modeled as fixed per-keyword abilities; Ashnod's "becomes an
// artifact" deferred) are flagged inline below.
// ─────────────────────────────────────────────────────────────────────────────

// Mightstone — {4} Artifact. "Attacking creatures get +1/+0." (CR 611 layer
// 7c anthem; CR 508.1 attacking — gated on `isAttacking`.) Affects EVERY
// attacking creature regardless of controller (no controller clause, unlike
// Orcish Oriflamme's "you control"). Same `pt-buff` + `isAttacking` shape.
export const mightstone: CardDefinition = {
    id: "b28ba599-5299-4831-a118-1712ada10ef6",
    rarity: "uncommon",
    name: "Mightstone",
    oracleText: "Attacking creatures get +1/+0.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && target.isAttacking === true,
            power: 1,
            toughness: 0,
        },
    ],
};

// Weakstone — {4} Artifact. "Attacking creatures get -1/-0." (CR 611 layer 7c;
// CR 508.1.) Mirror of Mightstone with a negative power buff. Effective power
// is floored at 0 by the layer reader (CR 107.1b — P/T can't be negative for
// rules purposes, but combat damage uses the floored value).
export const weakstone: CardDefinition = {
    id: "46adf48f-99d2-440e-9129-794584c1ea21",
    rarity: "uncommon",
    name: "Weakstone",
    oracleText: "Attacking creatures get -1/-0.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && target.isAttacking === true,
            power: -1,
            toughness: 0,
        },
    ],
};

// Staff of Zegon — {4} Artifact. "{3}, {T}: Target creature gets -2/-0 until
// end of turn." (CR 605 activated ability; CR 611.1 temporary P/T mod; CR
// 514.2 cleanup expiry via the end-of-turn duration.) Same temp-buff shape as
// Dragon Engine's pump, applied to a chosen target with a negative power buff.
export const staffOfZegon: CardDefinition = {
    id: "a6bf858d-bba9-4a16-9045-55384b1de633",
    rarity: "common",
    name: "Staff of Zegon",
    oracleText: "{3}, {T}: Target creature gets -2/-0 until end of turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "staff-of-zegon-weaken",
            oracleText:
                "{3}, {T}: Target creature gets -2/-0 until end of turn.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Mishra's Factory — Land (the "manland"). Three abilities:
//  • "{T}: Add {C}." (CR 605.1a/605.3a mana ability, useStack:false.)
//  • "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end
//    of turn. It's still a land." (CR 611.1 animate; the engine adds the
//    Creature + Artifact types and the Assembly-Worker subtype via
//    `AnimateSpec.additionalTypes`, and restores the original
//    types/subtypes/P-T at end of turn.)
//  • "{T}: Target Assembly-Worker creature gets +1/+1 until end of turn."
//    (CR 611.1 temp buff, restricted to Assembly-Workers via subtypeFilter.)
export const mishrasFactory: CardDefinition = {
    id: "a696c5b6-f216-454d-8029-74e84bbd1428",
    rarity: "uncommon",
    name: "Mishra's Factory",
    oracleText:
        "{T}: Add {C}.\n{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.\n{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mishras-factory-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
        },
        {
            id: "mishras-factory-animate",
            oracleText:
                "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.",
            cost: { mana: { X: 1 } },
            useStack: true,
            animatesSelf: true,
            // Migrated resolve()→effects[] (ADR 0045): the `animate` Op (CR
            // 208.2/611.1, issue #1317) is a thin declarative skin over the
            // exact `animateAsCreature` call this closure made — 2/2 base
            // P/T, the Assembly-Worker subtype, the added Artifact type
            // ("it's still a land"), until end of turn.
            effects: [
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    subtype: "Assembly-Worker",
                    additionalTypes: ["Artifact"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "mishras-factory-pump",
            oracleText:
                "{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Assembly-Worker",
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #840): +1/+1 EOT
            // on the announced target (CR 613.4c) via the pump Op.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Battering Ram — {2} Artifact Creature — Construct, 1/1. Two combat clauses:
//  • "At the beginning of combat on your turn, this creature gains banding
//    until end of combat." (CR 702.21 banding — a real engine capability,
//    `gre/banding.ts` reads `staticAbilities.includes("banding")`; granted for
//    the combat via `grantStaticAbility` with an end-of-combat duration.)
//  • "Whenever this creature becomes blocked by a Wall, destroy that Wall at
//    end of combat." (CR 509.1h pairing trigger on BLOCKERS_CONFIRMED, CR
//    511.3 end-of-combat timing.) Inverse of Cockatrice's combat-kill: fires
//    only when self is the BLOCKED ATTACKER and the blocker IS a Wall.
const BATTERING_RAM_ID = "f7a69e35-d209-41c0-aa3c-c78414617075";

function batteringRamWallTrigger(): TriggeredAbility {
    return {
        id: "battering-ram-wall-destroy",
        oracleText:
            "Whenever this creature becomes blocked by a Wall, destroy that Wall at end of combat.",
        event: "BLOCKERS_CONFIRMED",
        matches: (event, self) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            // Self must be the blocked attacker; the blocker must be a Wall.
            return (
                event.attackerId === self.id &&
                event.blockerSubtypes.includes("Wall")
            );
        },
        // Migrated resolve()→effects[] (ADR 0049, issue #865): the delayed
        // capture reads the blocking Wall off the firing event via
        // `$event.blockerId` (object family) and an inline delayedTrigger body
        // (ADR 0048) destroys it at end of combat. LKI reuses the ADR 0048
        // capture semantics — the id is captured at trigger-fire and re-bound
        // fresh at the end-of-combat body run; a Wall already gone is a no-op
        // (CR 608.2b + 701.7c).
        effects: [
            {
                op: "delayedTrigger",
                timing: "next-end-of-combat",
                oracleText: "Destroy that Wall at end of combat.",
                capture: { $wall: { ref: "$event.blockerId" } },
                effects: [{ op: "destroy", target: { ref: "$wall" } }],
            },
        ],
    };
}

export const batteringRam: CardDefinition = {
    id: BATTERING_RAM_ID,
    rarity: "common",
    name: "Battering Ram",
    oracleText:
        "At the beginning of combat on your turn, this creature gains banding until end of combat.\nWhenever this creature becomes blocked by a Wall, destroy that Wall at end of combat.",
    manaCost: { X: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "battering-ram-banding",
            oracleText:
                "At the beginning of combat on your turn, this creature gains banding until end of combat.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant banding
            // until end of combat (CR 611.1b). A "your"-scoped phaseTrigger, so
            // the effects site is available (the scoped player is the
            // controller / $source).
            effects: [
                {
                    op: "grantAbility",
                    ability: "banding",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-combat" },
                },
            ],
        }),
        batteringRamWallTrigger(),
    ],
};

// Urza's Avenger — {6} Artifact Creature — Shapeshifter, 4/4. "{0}: This
// creature gets -1/-1 and gains your choice of banding, flying, first strike,
// or trample until end of turn." (CR 611.1 temp P/T mod + keyword grant.)
//
// DIVERGENCE (flagged, no engine change, tracked-by: #1212): the engine has no
// "choose one named option from a list" resolution-choice kind (ZonePickKind is all zone-picks;
// `modes` are spell-cast-time only). The single modal ability is therefore
// modeled as FOUR fixed-keyword activated abilities — the player picks which
// ability to activate, choosing the keyword that way. Each ability applies the
// same -1/-1 and grants its own keyword until end of turn. Behaviorally
// equivalent to the printed "your choice of …"; a general `choose-option`
// choice kind would let it collapse back to one ability and is deferred.
const URZAS_AVENGER_KEYWORDS = [
    "banding",
    "flying",
    "first strike",
    "trample",
] as const;

export const urzasAvenger: CardDefinition = {
    id: "448e1811-fb16-4390-ac22-b7066a4a019c",
    rarity: "rare",
    name: "Urza's Avenger",
    oracleText:
        "{0}: This creature gets -1/-1 and gains your choice of banding, flying, first strike, or trample until end of turn.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 4,
    toughness: 4,
    activatedAbilities: URZAS_AVENGER_KEYWORDS.map((kw) => ({
        id: `urzas-avenger-${kw.replace(/\s+/g, "-")}`,
        oracleText: `{0}: This creature gets -1/-1 and gains ${kw} until end of turn.`,
        cost: {},
        useStack: true,
        // Migrated resolve()→effects[] (ADR 0045, #843): self -1/-1 + self-grant
        // the chosen keyword until end of turn (CR 611.1 / 611.1b). `kw` is a
        // build-time constant from URZAS_AVENGER_KEYWORDS, so it inlines as a
        // literal ability name per generated ability.
        effects: [
            {
                op: "pump",
                target: { ref: "$source" },
                power: -1,
                toughness: -1,
                duration: { phase: "end-of-turn" },
            },
            {
                op: "grantAbility",
                ability: kw,
                target: { ref: "$source" },
                duration: { phase: "end-of-turn" },
            },
        ],
    })),
};

// Amulet of Kroog — {2} Artifact. "{2}, {T}: Prevent the next 1 damage that
// would be dealt to any target this turn." (CR 615.1/615.6 one-shot
// prevention shield via `preventNextNDamageToTarget`, purged end-of-turn.)
export const amuletOfKroog: CardDefinition = {
    id: "b094f8dd-0184-41a2-9767-e848a6e4eac1",
    rarity: "common",
    name: "Amulet of Kroog",
    oracleText:
        "{2}, {T}: Prevent the next 1 damage that would be dealt to any target this turn.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "amulet-of-kroog-prevent",
            oracleText:
                "{2}, {T}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-1
            // shield on the announced "any" target — a creature or a player
            // (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Rakalite — {6} Artifact. "{2}: Prevent the next 1 damage that would be dealt
// to any target this turn. Return this artifact to its owner's hand at the
// beginning of the next end step." (CR 615.1 prevention shield; CR 603.7a
// delayed trigger for the self-bounce.) The {2} ability is repeatable (no tap)
// and each activation schedules the next-end-step return.
const RAKALITE_ID = "0fd7c711-3ff4-4691-914f-242e6737066c";

export const rakalite: CardDefinition = {
    id: RAKALITE_ID,
    rarity: "uncommon",
    name: "Rakalite",
    oracleText:
        "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "rakalite-prevent",
            oracleText:
                "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845 + #838): the
            // prevent-the-next-1 shield (preventDamage "next-n", CR 615.1) then
            // the self-bounce as a `delayedTrigger` Op with an inline body — the
            // artifact is captured through the ability site's implicit `$source`
            // binding and returned to hand at the next end step (moveZone → hand,
            // CR 603.7a). Replaces the old `delayedTriggers[]` template.
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Return this artifact to its owner's hand at the beginning of the next end step.",
                    capture: { $self: { ref: "$source" } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$self" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

// Ashnod's Transmogrant — {1} Artifact. "{T}, Sacrifice this artifact: Put a
// +1/+1 counter on target nonartifact creature. That creature becomes an
// artifact in addition to its other types." (CR 122.1 +1/+1 counter; CR 205
// type-add.)
//
// DIVERGENCE (flagged, no engine change): the "becomes an artifact in addition
// to its other types" clause has NO resolve-time primitive — the only type-add
// is the source-bound continuous `StaticTypeAdd` (auras, reverts when the
// source leaves), which is wrong here since this artifact sacrifices ITSELF as
// a cost (the type-add must persist after the source is gone). There is no
// imperative `ctx.addCardType`. The card therefore ships the +1/+1 counter (the
// board-dominant, fully testable effect) and omits the permanent artifact-type
// grant. A resolve-time `addCardType` primitive is needed to close this and is
// flagged for a feature tranche.
// DIVERGENCE (tracked #974; supersedes the closed #277): needs a resolve-time
// `addCardType` primitive for the permanent "becomes an artifact in addition to
// its other types" clause.
export const ashnodsTransmogrant: CardDefinition = {
    id: "2aa5b289-36ba-49b1-a5ac-f23bf71f8241",
    rarity: "uncommon",
    name: "Ashnod's Transmogrant",
    oracleText:
        "{T}, Sacrifice this artifact: Put a +1/+1 counter on target nonartifact creature. That creature becomes an artifact in addition to its other types.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ashnods-transmogrant-counter",
            oracleText:
                "{T}, Sacrifice this artifact: Put a +1/+1 counter on target nonartifact creature. That creature becomes an artifact in addition to its other types.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeTypes: "Artifact",
            },
            // CR 122 (issue #841) — put one +1/+1 counter on the target.
            // "becomes an artifact" omitted — see DIVERGENCE note above.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};

// Mishra's War Machine — {7} Artifact Creature — Juggernaut, 5/5 with banding.
// "At the beginning of your upkeep, this creature deals 3 damage to you unless
// you discard a card. If it deals damage to you this way, tap it." (CR 702.21
// banding; CR 603.6a upkeep trigger; CR 117.3a pay-or-else with a discard
// cost.) Declining the discard runs the else-branch: 3 damage + tap self.
export const mishrasWarMachine: CardDefinition = {
    id: "8f6b4652-a1d4-418f-a89b-6a977a920a9e",
    rarity: "rare",
    name: "Mishra's War Machine",
    oracleText:
        "Banding\nAt the beginning of your upkeep, this creature deals 3 damage to you unless you discard a card. If it deals damage to you this way, tap it.",
    manaCost: { X: 7 },
    types: ["Artifact", "Creature"],
    subtypes: ["Juggernaut"],
    power: 5,
    toughness: 5,
    staticAbilities: ["banding"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mishras-war-machine-upkeep",
            oracleText:
                "At the beginning of your upkeep, this creature deals 3 damage to you unless you discard a card. If it deals damage to you this way, tap it.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): re-assessed — `mayPay`'s discard
            // leg (issue #899) and `if`/`else` now cover "unless you discard a
            // card" + "if it deals damage this way, tap it" on their own, BUT
            // this card's own test ("with an empty hand, deals 3 ... and taps
            // itself") requires the prompt to never appear when hand is empty
            // (`fireTrigger` called with no `mayPayAccept`, i.e. no suspend
            // expected). An unconditional `mayPay` Op always enqueues the
            // pending choice regardless of hand size, which would suspend that
            // scenario and break the untouched test (playbook invariant: a
            // migration that forces a test change is wrong). Gating the
            // `mayPay` on "hand size > 0" needs a hand-size EffectValue/
            // predicate the grammar still lacks (same class as Ivory Tower /
            // The Rack above). Blocked on: a hand-size comparison construct.
            resolve: (ctx, _event, playerId) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const handIds = ctx.getHandIds(playerId);
                if (handIds.length > 0) {
                    const accept = ctx.requestMayPay({
                        playerId,
                        choiceId: playerId,
                        prompt: "Discard a card to avoid 3 damage from Mishra's War Machine?",
                    });
                    if (accept === undefined) return;
                    if (accept) {
                        const picked = ctx.requestChoice({
                            playerId,
                            choiceId: `${playerId}-discard`,
                            kind: "choose-hand-card",
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                        });
                        if (picked === undefined) return;
                        if (picked.length > 0) {
                            ctx.discardCard(playerId, picked[0]);
                            return;
                        }
                    }
                }
                // No discard: 3 damage to you, then tap self ("if it deals
                // damage to you this way, tap it").
                ctx.dealDamage({ type: "player", id: playerId }, 3);
                ctx.tap(self);
            },
        }),
    ],
};

// Ashnod's Altar — {3} Artifact. "Sacrifice a creature: Add {C}{C}." A
// creature-to-colorless mana converter. Modeled as a stack ability (see the
// CR 605.1a note above) so the sacrifice choice can be made.
export const ashnodsAltar: CardDefinition = {
    id: "cdcccb0f-ce96-453b-9e82-41d87f52e58b",
    rarity: "uncommon",
    name: "Ashnod's Altar",
    oracleText: "Sacrifice a creature: Add {C}{C}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ashnods-altar-mana",
            oracleText: "Sacrifice a creature: Add {C}{C}.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            effects: [{ op: "addMana", mana: { C: 2 } }],
        },
    ],
};

// Mishra's Workshop — Land. "{T}: Add {C}{C}{C}. Spend this mana only to cast
// artifact spells." (ATQ rare, modern oracle.)
//
// CR 106.6 — the produced mana carries an "artifact-spell" spend restriction.
// It floats in the controller's parallel `restrictedMana` pool (declared via
// the ability's `manaRestriction` field) instead of the fungible pool, empties
// at end of step/phase like any mana (CR 500.4), and the spell-cast payment
// sites accept it only for spells whose types include "Artifact"
// (restrictionAllowsSpell). It can never pay for an activated ability or a
// non-artifact spell. Per ADR 0022 this reuses the restricted-mana storage,
// serialization, emptying, and settlement machinery as-is — no new subsystem.
export const mishrasWorkshop: CardDefinition = {
    id: "135de5c7-6ac9-4b68-8f1a-97f120a4b125",
    rarity: "rare",
    name: "Mishra's Workshop",
    oracleText:
        "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mishras-workshop-mana",
            oracleText:
                "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 3 });
            },
            manaProduced: { C: 3 },
            manaRestriction: "artifact-spell",
        },
    ],
};

// Urza land trio — board-conditional mana (CR 106.1, 605.1a). Each taps for
// {C}, but adds extra colorless when the controller also controls the other
// two members of the set. The condition keys off the land *subtypes* (Urza's
// Mine / Urza's Power-Plant / Urza's Tower), matching the oracle text and the
// canonical CR treatment — not the card names. Output is recomputed from the
// controller's battlefield at activation time via the ability's `manaAmount`
// hook; `manaProduced` carries the {C}{C}... representative output (read by
// Mana Flare and by best-effort display callers without a battlefield view).
//
// Each land's base output is {C}; the assembled bonus differs by member:
//   Mine        → {C}{C}    (2)
//   Power Plant → {C}{C}    (2)
//   Tower       → {C}{C}{C} (3)
const URZA_MINE = "Urza's Mine";

const URZA_POWER_PLANT = "Urza's Power-Plant";

const URZA_TOWER = "Urza's Tower";

/** True when the controller's battlefield contains a land with the given Urza
 *  subtype (CR 205.3, 106.1). Reads the controller's own battlefield only —
 *  "you control" scopes to the activating player's permanents. */
function controlsUrzaSubtype(
    battlefield: ReadonlyArray<PermanentView>,
    subtype: string
): boolean {
    return battlefield.some((p) => p.subtypes.includes(subtype));
}

/** Builds an Urza land's `manaAmount`: {C}{C}... `assembled` colorless when the
 *  controller also controls both `others` subtypes, otherwise {C}. */
function urzaManaAmount(
    others: [string, string],
    assembled: number
): (
    source: PermanentView,
    battlefield: ReadonlyArray<PermanentView>
) => ManaCost {
    return (_source, battlefield) =>
        controlsUrzaSubtype(battlefield, others[0]) &&
        controlsUrzaSubtype(battlefield, others[1])
            ? ({ C: assembled } as ManaCost)
            : ({ C: 1 } as ManaCost);
}

export const urzasMine: CardDefinition = {
    id: "ddf85792-470b-4b42-99ac-9cb43a575523",
    rarity: "uncommon",
    name: "Urza's Mine",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_MINE],
    activatedAbilities: [
        {
            id: "urzas-mine-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 2 },
            manaAmount: urzaManaAmount([URZA_POWER_PLANT, URZA_TOWER], 2),
        },
    ],
};

export const urzasPowerPlant: CardDefinition = {
    id: "94896e0b-859c-47e4-bf27-35ed37b841e0",
    rarity: "common",
    name: "Urza's Power Plant",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_POWER_PLANT],
    activatedAbilities: [
        {
            id: "urzas-power-plant-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 2 },
            manaAmount: urzaManaAmount([URZA_MINE, URZA_TOWER], 2),
        },
    ],
};

export const urzasTower: CardDefinition = {
    id: "8ed85655-fc59-4a57-bcf9-75e1899dff78",
    rarity: "common",
    name: "Urza's Tower",
    oracleText:
        "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.",
    manaCost: {},
    types: ["Land"],
    subtypes: [URZA_TOWER],
    activatedAbilities: [
        {
            id: "urzas-tower-mana",
            oracleText:
                "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 3 },
            manaAmount: urzaManaAmount([URZA_MINE, URZA_POWER_PLANT], 3),
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster E (#286) — "for as long as this remains tapped" duration + tap-lock.
// CR 611.2 models a duration tied to a continuously re-evaluated game state
// rather than a phase boundary: the effect persists exactly while its source
// stays tapped and ends the instant the source untaps or leaves play
// (`checkSourceTappedEffects` SBA + live layer read). All three cards also use
// the `may-choose-not-to-untap` keyword (CR 502.1 optional untap), which is
// what lets the controller hold the source tapped to keep the effect alive.
// Modern Scryfall oracle text is authoritative (ADR 0004); costs / type lines
// come from MTGJSON ATQ.json.
// ─────────────────────────────────────────────────────────────────────────────

// Ashnod's Battle Gear — {2} Artifact. "{2}, {T}: Target creature you control
// gets +2/-2 for as long as this artifact remains tapped." (CR 611.2 state-tied
// duration via `addSourceTappedPTBuff`; CR 502.1 optional untap via the
// `may-choose-not-to-untap` keyword.) The buff is read live at layer 7d while
// the Battle Gear stays tapped and disappears the moment it untaps.
export const ashnodsBattleGear: CardDefinition = {
    id: "aeeec853-dd3f-4ac3-8b20-c07fada8888f",
    rarity: "uncommon",
    name: "Ashnod's Battle Gear",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{2}, {T}: Target creature you control gets +2/-2 for as long as this artifact remains tapped.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "ashnods-battle-gear-pump",
            oracleText:
                "{2}, {T}: Target creature you control gets +2/-2 for as long as this artifact remains tapped.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addSourceTappedPTBuff(target, 2, -2);
                }
            },
        },
    ],
};

// Tawnos's Weaponry — {2} Artifact. "{2}, {T}: Target creature gets +1/+1 for
// as long as this artifact remains tapped." (CR 611.2 state-tied duration; CR
// 502.1 optional untap.) Same shape as Battle Gear but any creature and a
// +1/+1 buff.
export const tawnossWeaponry: CardDefinition = {
    id: "3035cead-a501-4204-9154-5fd648577d32",
    rarity: "uncommon",
    name: "Tawnos's Weaponry",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{2}, {T}: Target creature gets +1/+1 for as long as this artifact remains tapped.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "tawnoss-weaponry-pump",
            oracleText:
                "{2}, {T}: Target creature gets +1/+1 for as long as this artifact remains tapped.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addSourceTappedPTBuff(target, 1, 1);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Choose-body-on-entry creatures (ATQ cluster G, issue #289). These pick their
// body "as they enter" (CR 614.12 replacement-style self-modification, resolved
// during the creature spell's own `resolveSteps` while it is still on the
// stack). The pick is an abstract `option-pick` PendingChoice (8 numbers for
// Shapeshifter, 3 modes for Primal Clay) and the resulting base P/T / subtypes /
// keywords are written onto the entering permanent via `ctx.setSelfBody`, which
// persists indefinitely (NOT a layer-7b temporary set). Shapeshifter re-chooses
// at each of its controller's upkeeps (CR 603.6a "may"), overwriting its base
// P/T. New engine capabilities introduced for this cluster: the `option-pick`
// PendingChoice kind (`ctx.requestOptionChoice`) and the persistent
// `ctx.setSelfBody` self-body primitive.
// ─────────────────────────────────────────────────────────────────────────────

// Primal Clay — {4} Artifact Creature — Shapeshifter, 0/0. "As this creature
// enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact
// creature with flying, or a 1/6 Wall artifact creature with defender in
// addition to its other types." (CR 614.12 — the body choice is made as it
// enters; CR 702.3 defender; CR 702.9 flying. It is always an artifact
// creature; only the Wall mode adds subtype "Wall" + keyword "defender".)
export const primalClay: CardDefinition = {
    id: "ab9d0e3f-cf7c-41f8-bcd7-bb08ea8cc2f8",
    rarity: "uncommon",
    name: "Primal Clay",
    oracleText:
        "As this creature enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types.",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — choose the body as the permanent enters. The pick is
            // made by the spell's controller during resolution; the resulting
            // base characteristics are written onto the still-on-stack
            // permanent and carry to the battlefield on `finalizeSpellResolution`.
            const mode = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: "primal-clay-body",
                options: [
                    { id: "3-3", label: "3/3" },
                    { id: "2-2-flying", label: "2/2 flying" },
                    { id: "1-6-wall", label: "1/6 Wall (defender)" },
                ],
                prompt: "Choose Primal Clay's body.",
            });
            if (mode === undefined) return; // suspended — wait for the pick
            if (mode === "3-3") {
                ctx.setSelfBody({ power: 3, toughness: 3 });
            } else if (mode === "2-2-flying") {
                ctx.setSelfBody({
                    power: 2,
                    toughness: 2,
                    addKeywords: ["flying"],
                });
            } else if (mode === "1-6-wall") {
                ctx.setSelfBody({
                    power: 1,
                    toughness: 6,
                    addSubtypes: ["Wall"],
                    addKeywords: ["defender"],
                });
            }
        },
    ],
};

// Shapeshifter — {6} Artifact Creature — Shapeshifter, */7-*. "As this creature
// enters, choose a number between 0 and 7. At the beginning of your upkeep, you
// may choose a number between 0 and 7. Shapeshifter's power is equal to the last
// chosen number and its toughness is equal to 7 minus that number." (CR 614.12 —
// entry choice; CR 603.6a — optional upkeep re-choice. We model "power = N,
// toughness = 7 − N" by writing the chosen base P/T directly via `setSelfBody`,
// overwriting on each re-choice. The entry choice is mandatory; the upkeep
// re-choice is a "may".)
const SHAPESHIFTER_NUMBER_OPTIONS = Array.from({ length: 8 }, (_, n) => ({
    id: String(n),
    label: `${n}/${7 - n}`,
}));

export const shapeshifter: CardDefinition = {
    id: "cc278af4-b60d-41b7-b9d7-36c8aefca1a7",
    rarity: "rare",
    name: "Shapeshifter",
    oracleText:
        "As this creature enters, choose a number between 0 and 7.\nAt the beginning of your upkeep, you may choose a number between 0 and 7.\nShapeshifter's power is equal to the last chosen number and its toughness is equal to 7 minus that number.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    resolveSteps: [
        (ctx: SpellContext) => {
            // CR 614.12 — mandatory entry choice. Power = N, toughness = 7 − N.
            const choice = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: "shapeshifter-entry-number",
                options: SHAPESHIFTER_NUMBER_OPTIONS,
                prompt: "Choose a number between 0 and 7.",
            });
            if (choice === undefined) return; // suspended — wait for the pick
            const n = Number(choice);
            ctx.setSelfBody({ power: n, toughness: 7 - n });
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "shapeshifter-upkeep-renumber",
            oracleText:
                "At the beginning of your upkeep, you may choose a number between 0 and 7. Shapeshifter's power becomes equal to the chosen number and its toughness becomes equal to 7 minus that number.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                // CR 603.6a — optional ("may") re-choice. requestMayPay with no
                // cost is the project's yes/no primitive; on accept, pick a new
                // number and overwrite the base P/T via setSelfBody (recipient
                // resolves to the source permanent on the battlefield).
                const accept = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `shapeshifter-renumber-may-${ctx.sourceInstanceId}`,
                    prompt: "Choose a new number for Shapeshifter?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) return;
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: `shapeshifter-renumber-${ctx.sourceInstanceId}`,
                    options: SHAPESHIFTER_NUMBER_OPTIONS,
                    prompt: "Choose a number between 0 and 7.",
                });
                if (choice === undefined) return; // suspended
                const n = Number(choice);
                ctx.setSelfBody({ power: n, toughness: 7 - n });
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster O — minor isolated extensions (PRD #269, issue #292)
//
// Each card here exercises one small, orthogonal engine extension:
//  • chosen-opponent-on-entry stored for the rest of the game (Cursed Rack,
//    The Rack) — CR 603.6b / 614.12, `SpellContext.setChosenPlayer`.
//  • sacrifice-vs-other leave distinction (Urza's Miter) — the `PERMANENT_LEFT`
//    event now carries `cause: "sacrifice"`.
//  • random-discard as an activation cost (Coral Helm) — `cost.discardAtRandom`.
//  • "originally printed in [set]" mass sacrifice (Golgothian Sylex) —
//    `isPrintedInSet`.
//  • continuous-control activation precondition (Rocket Launcher) —
//    `tracksControlContinuity` + `canActivate`.
//  • can't-be-blocked-this-turn flag (Tawnos's Wand) —
//    `SpellContext.setCantBeBlockedThisTurn`.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves the player chosen as an "as ~ enters, choose an opponent" card
 *  entered. In the engine's 2-player games there is exactly one opponent, so
 *  the choice auto-resolves (Arena-style — no prompt for a zero-branch choice).
 *  Returns undefined if no opponent exists (solo edge case). */
function singleOpponentId(ctx: SpellContext): string | undefined {
    return ctx.allPlayerIds.find((id) => id !== ctx.controller);
}

// Cursed Rack — {4} Artifact. "As this artifact enters, choose an opponent.
// The chosen player's maximum hand size is four." (CR 603.6b on-entry choice
// stored via `setChosenPlayer`; CR 402.2 max-hand-size override read by
// `effectiveMaxHandSize` through the `appliesTo: "chosen-player"`
// `hand-size-override` static effect — the cap is applied at the chosen
// player's CLEANUP.)
export const cursedRack: CardDefinition = {
    id: "720d871d-1e7b-482e-bd1e-8ec79519fb86",
    rarity: "uncommon",
    name: "Cursed Rack",
    oracleText:
        "As this artifact enters, choose an opponent.\nThe chosen player's maximum hand size is four.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    // CR 402.2 — continuous override of the CHOSEN player's max hand size.
    // `effectiveMaxHandSize` resolves "chosen-player" to this instance's
    // stored `chosenPlayerId`.
    staticEffects: [
        {
            kind: "hand-size-override",
            value: 4,
            appliesTo: "chosen-player",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "cursed-rack-choose-opponent",
            oracleText: "As this artifact enters, choose an opponent.",
            scope: "self",
            resolve: (ctx) => {
                const opponent = singleOpponentId(ctx);
                if (opponent) ctx.setChosenPlayer(opponent);
            },
        }),
    ],
};

// The Rack — {1} Artifact. "As this artifact enters, choose an opponent. At the
// beginning of the chosen player's upkeep, this artifact deals X damage to that
// player, where X is 3 minus the number of cards in their hand." (CR 603.6b
// on-entry choice; CR 603.6a upkeep trigger. `scope: "each"` fires on every
// player's upkeep; the `condition` narrows it to the stored chosen player so
// the trigger only enters the stack on their upkeep — CR 603.4.)
export const theRack: CardDefinition = {
    id: "ec0686ba-1277-4412-a397-7a6227808311",
    rarity: "uncommon",
    name: "The Rack",
    oracleText:
        "As this artifact enters, choose an opponent.\nAt the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        // NOT DSL-migratable (ADR 0045): "choose an opponent" has no Op —
        // `setChosenPlayer`/`getChosenPlayer` are SpellContext-only
        // primitives with no declarative skin in EFFECT_OP_REGISTRY.
        // Blocked on: a choose-player-and-store Op.
        enteredTrigger({
            id: "the-rack-choose-opponent",
            oracleText: "As this artifact enters, choose an opponent.",
            scope: "self",
            resolve: (ctx) => {
                const opponent = singleOpponentId(ctx);
                if (opponent) ctx.setChosenPlayer(opponent);
            },
        }),
        // NOT DSL-migratable (ADR 0045): the damage amount is "3 minus hand
        // size" — same arithmetic/value-grammar gap as Ivory Tower above
        // (literal | ref | count has no subtraction, and `count` has no
        // hand-size zone). Blocked on: a hand-size count zone + an
        // arithmetic/subtract value construct.
        phaseTrigger({
            id: "the-rack-upkeep-damage",
            oracleText:
                "At the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand.",
            phase: "UPKEEP",
            // Fire on every player's upkeep, then narrow to the stored chosen
            // player (CR 603.4 — only fires when the active player is the one
            // chosen as this artifact entered).
            scope: "each",
            condition: (event, self) =>
                self.chosenPlayerId === event.activePlayerId,
            resolve: (ctx, _event, scopedPlayerId) => {
                const x = 3 - ctx.getHandSize(scopedPlayerId);
                if (x > 0) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, x);
                }
            },
        }),
    ],
};

// Urza's Miter — {3} Artifact. "Whenever an artifact you control is put into a
// graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If
// you do, draw a card." (CR 603.10 LTB trigger; the `cause` field on
// `PERMANENT_LEFT` distinguishes sacrifice from every other departure — the
// trigger fires only when `event.cause !== "sacrifice"`. CR 117.3a optional
// payment via `requestMayPay`.)
export const urzasMiter: CardDefinition = {
    id: "438f0c61-a61d-4a9e-b21f-4e86420c7913",
    rarity: "rare",
    name: "Urza's Miter",
    oracleText:
        "Whenever an artifact you control is put into a graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If you do, draw a card.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    triggeredAbilities: [
        leftTrigger({
            id: "urzas-miter-draw",
            oracleText:
                "Whenever an artifact you control is put into a graveyard from the battlefield, if it wasn't sacrificed, you may pay {3}. If you do, draw a card.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Artifact" },
            // CR 603.4 — only fires when the artifact was NOT sacrificed.
            condition: (event) => event.cause !== "sacrifice",
            // Migrated resolve()→effects[] (ADR 0045, closes tracked-by
            // #1280): the mayPay + if + draw shape (mirrors Force Spike,
            // `leg/blue.ts`) now rides `leftTrigger`'s `effects` site, added
            // alongside this migration.
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { X: 3 },
                    prompt: "Pay {3} to draw a card from Urza's Miter?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        }),
    ],
};

// Coral Helm — {3} Artifact. "{3}, Discard a card at random: Target creature
// gets +2/+2 until end of turn." (CR 118.3 random-discard additional cost via
// `cost.discardAtRandom`; CR 611.1 "+2/+2 until end of turn" via
// `addTemporaryPTBuff`.)
export const coralHelm: CardDefinition = {
    id: "6c6df9db-0a46-40a5-ae9d-59f47dae9056",
    rarity: "rare",
    name: "Coral Helm",
    oracleText:
        "{3}, Discard a card at random: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "coral-helm-pump",
            oracleText:
                "{3}, Discard a card at random: Target creature gets +2/+2 until end of turn.",
            cost: { mana: { X: 3 }, discardAtRandom: 1 },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Golgothian Sylex — {4} Artifact. "{1}, {T}: Each nontoken permanent with a
// name originally printed in the Antiquities expansion is sacrificed by its
// controller." (CR 701.16 sacrifice; the "originally printed in ATQ" origin
// filter is `isPrintedInSet(cardId, "atq")` — keyed off the home set of each
// permanent's card definition. Golgothian Sylex itself is an ATQ card, so it
// sacrifices itself too.)
export const golgothianSylex: CardDefinition = {
    id: "856be1dd-a20b-49c2-be9d-7db76c7efd8b",
    rarity: "rare",
    name: "Golgothian Sylex",
    oracleText:
        "{1}, {T}: Each nontoken permanent with a name originally printed in the Antiquities expansion is sacrificed by its controller.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "golgothian-sylex-wrath",
            oracleText:
                "{1}, {T}: Each nontoken permanent with a name originally printed in the Antiquities expansion is sacrificed by its controller.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: true,
            // NOT DSL-migratable (ADR 0045): the sweep's filter is "name
            // originally printed in the Antiquities expansion" — a
            // set-of-origin check (`ctx.isPrintedInSet`) with no
            // corresponding field on `EffectCardFilter`/`PermanentFilter`
            // (which cover type/subtype/color/mana-value/counter/isToken,
            // but no printing-origin dimension). A `forEach { set:
            // "permanents" }` sweep could express "each nontoken permanent"
            // but not this filter's `isPrintedInSet` clause.
            // Blocked on: a printed-in-set origin filter field.
            resolve: (ctx: SpellContext) => {
                // Snapshot the matching ids first; sacrificing mutates the
                // battlefield arrays. CR 701.16 — each is sacrificed by its
                // controller (ctx.sacrifice resolves the current controller).
                const toSacrifice: string[] = [];
                for (const playerId of ctx.allPlayerIds) {
                    // CR 111.5 — "nontoken permanent": exclude tokens via the
                    // battlefield filter.
                    for (const id of ctx.getBattlefieldIds(playerId, {
                        isToken: false,
                    })) {
                        if (ctx.isPrintedInSet(id, "atq")) {
                            toSacrifice.push(id);
                        }
                    }
                }
                for (const id of toSacrifice) ctx.sacrifice(id);
            },
        },
    ],
};

// Rocket Launcher — {4} Artifact. "{2}: This artifact deals 1 damage to any
// target. Destroy this artifact at the beginning of the next end step. Activate
// only if you've controlled this artifact continuously since the beginning of
// your most recent turn." (CR 115.4 any-target damage; CR 603.7a delayed
// self-destroy; the continuous-control precondition reuses the summoning-sick
// flag via `tracksControlContinuity` — the artifact is sick the turn it enters
// or changes control and clears at the controller's untap step, so
// `!isSummoningSick` on the controller's own turn means "controlled since my
// most recent turn began".)
export const rocketLauncher: CardDefinition = {
    id: "d5bb2093-78a8-4a6c-abe7-9a5afc181ec5",
    rarity: "uncommon",
    name: "Rocket Launcher",
    oracleText:
        "{2}: This artifact deals 1 damage to any target. Destroy this artifact at the beginning of the next end step. Activate only if you've controlled this artifact continuously since the beginning of your most recent turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    tracksControlContinuity: true,
    activatedAbilities: [
        {
            id: "rocket-launcher-ping",
            oracleText:
                "{2}: This artifact deals 1 damage to any target. Destroy this artifact at the beginning of the next end step. Activate only if you've controlled this artifact continuously since the beginning of your most recent turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            // CR 602.5b — "activate only ... since the beginning of your most
            // recent turn": only your turn, and not the turn it came under your
            // control (still summoning-sick).
            controllerTurnOnly: true,
            canActivate: (source) => source.isSummoningSick !== true,
            targetRequirement: { type: "any", count: 1 },
            // Effect Script (ADR 0045/0048, migrated in #838): the delayed
            // self-destroy is a `delayedTrigger` Op with an inline body —
            // the source is captured through the ability site's implicit
            // `$source` binding (CR 603.7a).
            effects: [
                { op: "dealDamage", amount: 1, to: { target: 0 } },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Destroy Rocket Launcher at the beginning of the next end step.",
                    capture: { $self: { ref: "$source" } },
                    effects: [{ op: "destroy", target: { ref: "$self" } }],
                },
            ],
        },
    ],
};

// Tawnos's Wand — {4} Artifact. "{2}, {T}: Target creature with power 2 or less
// can't be blocked this turn." (CR 509.1b can't-be-blocked, set on the attacker
// via `setCantBeBlockedThisTurn` and cleared at CLEANUP; the
// `powerFilter: { max: 2 }` restricts legal targets — CR 613 effective power.)
export const tawnossWand: CardDefinition = {
    id: "978f09dd-121a-4da5-ba16-5c03fbdce084",
    rarity: "uncommon",
    name: "Tawnos's Wand",
    oracleText:
        "{2}, {T}: Target creature with power 2 or less can't be blocked this turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "tawnoss-wand-unblockable",
            oracleText:
                "{2}, {T}: Target creature with power 2 or less can't be blocked this turn.",
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            // DSL-first (ADR 0045): "can't be blocked this turn" (CR 509.1b) is
            // the `restrictCombat` Op's evasion `restriction: "cant-be-blocked"`
            // over an announced target → `setCantBeBlockedThisTurn`.
            effects: [
                {
                    op: "restrictCombat",
                    restriction: "cant-be-blocked",
                    target: { target: 0 },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cluster L (#293) — token provenance link. CR 111 / 707.1: a token records
// the permanent that created it (`createToken(..., ctx.sourceInstanceId)` →
// `CardInstanceState.createdBy`), so a source can later identify "tokens
// created with this creature" via the `PermanentFilter.createdBy` clause. The
// Tetravite token also carries a self-targeting `cantBeEnchanted`
// `permanent-guard` (CR 303.4 — reusing Guardian Beast's clause), registered on
// the synthesized token definition and rebuilt from the token id after a DB
// round-trip (`maybeSynthesizeToken`). Both upkeep abilities are optional
// ("may") choices over an arbitrary number (CR 603.6a): the counter→token
// direction picks a number 0..N via `requestOptionChoice`; the token→counter
// direction picks any subset of the linked tokens via a `choose-permanents`
// `requestChoice` scoped by `createdBy`.
// ─────────────────────────────────────────────────────────────────────────────

// The Tetravite token spec (CR 707.2). 1/1 colorless flying artifact creature
// that "can't be enchanted". The provenance link is stamped per-creation by
// `createToken`'s `createdBy` argument, not by the spec. No `imagePrintId` —
// Scryfall has no printed Tetravite token for Tetravus (`all_parts` is
// empty), so this stays a placeholder-rendered token by design (issue #941
// documented exception).
const TETRAVITE_TOKEN: TokenSpec = {
    name: "Tetravite",
    types: ["Artifact", "Creature"],
    subtypes: ["Tetravite"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    // CR 303.4 — "This token can't be enchanted." Self-targeting guard,
    // reconstructed deterministically from the token id (closures can't ride
    // the serialized id).
    staticEffects: [cantBeEnchantedSelfGuard()],
};

// Tetravus — {6} Artifact Creature — Construct, 1/1 flying, enters with three
// +1/+1 counters. Two optional upkeep abilities convert between counters and
// linked Tetravite tokens in either direction (modern Scryfall oracle, ADR
// 0004).
export const tetravus: CardDefinition = {
    id: "23eb19f9-2e8f-4bf0-9bf8-868e6da70e2d",
    rarity: "rare",
    name: "Tetravus",
    oracleText:
        'Flying\nThis creature enters with three +1/+1 counters on it.\nAt the beginning of your upkeep, you may remove any number of +1/+1 counters from this creature. If you do, create that many 1/1 colorless Tetravite artifact creature tokens. They each have flying and "This token can\'t be enchanted."\nAt the beginning of your upkeep, you may exile any number of tokens created with this creature. If you do, put that many +1/+1 counters on this creature.',
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    // CR 122.1 / 614.1c — ETB counters applied by finalizeSpellResolution.
    entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "tetravus-counters-to-tokens",
            oracleText:
                'At the beginning of your upkeep, you may remove any number of +1/+1 counters from this creature. If you do, create that many 1/1 colorless Tetravite artifact creature tokens. They each have flying and "This token can\'t be enchanted."',
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045, issue #849): `requestOptionChoice`
            // is used here as a dynamic COUNT picker (0..available counters),
            // not the `optionChoice` Op's static "choose one of several effect
            // branches" — the option count depends on the live counter total and
            // the chosen number feeds a runtime `removeCounter` / `createToken`
            // amount, which the JSON value grammar (literal / ref / count) can't
            // express. The token creation also needs the `createdBy` provenance
            // link the createToken Op does not stamp (issue #847). Planned-
            // migratable once a chosen-number value construct + provenance-token
            // Op exist. Stays resolve().
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                const available = ctx.getCounterCount(self, "+1/+1");
                // CR 608.2b — nothing to remove; no real choice, no prompt.
                if (available <= 0) return;
                // CR 603.6a "you may remove any number" — pick a count 0..N
                // (0 = remove none / decline). One prompt covers the "may" and
                // the "how many" together.
                const choice = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: `tetravus-make-${ctx.sourceInstanceId}`,
                    options: Array.from({ length: available + 1 }, (_, n) => ({
                        id: String(n),
                        label:
                            n === 0
                                ? "Remove none"
                                : `Remove ${n} (create ${n} Tetravite${n === 1 ? "" : "s"})`,
                    })),
                    prompt: "Remove any number of +1/+1 counters to create that many Tetravite tokens.",
                });
                if (choice === undefined) return; // suspended — await the pick
                const n = Number(choice);
                if (n <= 0) return;
                // CR 122.6 — remove the counters, then create that many linked
                // tokens (CR 111 / 707.1). The provenance link (`createdBy`)
                // lets the second ability find them later.
                const removed = ctx.removeCounter(self, "+1/+1", n);
                if (removed <= 0) return;
                ctx.createToken(
                    TETRAVITE_TOKEN,
                    ctx.controller,
                    removed,
                    ctx.sourceInstanceId
                );
            },
        }),
        phaseTrigger({
            id: "tetravus-tokens-to-counters",
            oracleText:
                "At the beginning of your upkeep, you may exile any number of tokens created with this creature. If you do, put that many +1/+1 counters on this creature.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the counter count is "that many"
            // = the number of tokens the player exiles in the multi-select
            // `requestChoice`, a choice-result cardinality the `count` grammar
            // (battlefield/graveyard card sets) cannot express — and the exile
            // consumes the very set that would be counted. Stays resolve().
            resolve: (ctx) => {
                // CR 111 — "tokens created with this creature": tokens on the
                // controller's battlefield whose provenance link points here.
                const linked = ctx.getBattlefieldIds(ctx.controller, {
                    isToken: true,
                    createdBy: ctx.sourceInstanceId,
                });
                // CR 608.2b — no eligible tokens; no real choice, no prompt.
                if (linked.length === 0) return;
                const chosen = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `tetravus-exile-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: {
                        isToken: true,
                        createdBy: ctx.sourceInstanceId,
                    },
                    count: { min: 0, max: linked.length },
                    prompt: "Exile any number of tokens created with Tetravus to put that many +1/+1 counters on it.",
                });
                if (chosen === undefined) return; // suspended — await the pick
                if (chosen.length === 0) return; // chose none
                // CR 701.18 exile, then CR 122.1 put back that many counters.
                for (const id of chosen) {
                    ctx.exile({ type: "permanent", id });
                }
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    chosen.length
                );
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Exile-with-attachments + return (ATQ cluster K, ADR 0028)
// ─────────────────────────────────────────────────────────────────────────────

// Tawnos's Coffin — {4} Artifact. "You may choose not to untap this artifact
// during your untap step. {3},{T}: Exile target creature and all Auras attached
// to it. Note the number and kind of counters that were on that creature. When
// this artifact leaves the battlefield or becomes untapped, return that exiled
// card to the battlefield under its owner's control tapped with the noted
// number and kind of counters on it. If you do, return the other exiled cards
// to the battlefield under their owner's control attached to that permanent."
// (CR 502.1 optional untap, CR 701.18 exile, CR 122 counters, CR 603.7a
// delayed return, CR 303.4 aura attachment.)
//
// The exile-and-return is the general holding mechanism (ADR 0028): the
// activated ability arms an `ExileReturnBundle` keyed to this artifact, and the
// return is driven by TWO triggers on this same artifact — its leaves-the-
// battlefield (`leftTrigger`) and its becomes-untapped (`untapTrigger`,
// CR 701.20b). The bundle's existence is the delayed-trigger's armed flag, so
// both triggers gate on `state.exileHeld` to avoid firing with nothing held.
// "You may choose not to untap" reuses the existing `may-choose-not-to-untap`
// optional-untap static (ADR 0005) — declining keeps the creature exiled.
const tawnossCoffinHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

export const tawnossCoffin: CardDefinition = {
    id: "c27bc1de-8246-4dc8-af51-ec21def9e226",
    rarity: "rare",
    name: "Tawnos's Coffin",
    oracleText:
        "You may choose not to untap this artifact during your untap step.\n{3}, {T}: Exile target creature and all Auras attached to it. Note the number and kind of counters that were on that creature. When this artifact leaves the battlefield or becomes untapped, return that exiled card to the battlefield under its owner's control tapped with the noted number and kind of counters on it. If you do, return the other exiled cards to the battlefield under their owner's control attached to that permanent.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    staticAbilities: ["may-choose-not-to-untap"],
    activatedAbilities: [
        {
            id: "tawnoss-coffin-exile",
            oracleText:
                "{3}, {T}: Exile target creature and all Auras attached to it. Note the number and kind of counters that were on that creature.",
            cost: { tap: true, mana: { X: 3 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // CR 701.18 / 122 — exile the announced creature + its Auras and
            // note its counters; arm the return keyed to `$source` (ADR 0028).
            // `includeAttachments: true` (the "and all Auras attached to it"
            // clause — the primitive default this closure relied on);
            // `returnTapped: true` ("return that exiled card ... tapped").
            effects: [
                {
                    op: "exileWithAttachments",
                    target: { target: 0 },
                    returnTapped: true,
                    includeAttachments: true,
                },
            ],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "tawnoss-coffin-return-on-leave",
            oracleText:
                "When this artifact leaves the battlefield, return the exiled card to the battlefield under its owner's control tapped with the noted counters, and reattach the other exiled cards to it.",
            scope: "self",
            condition: tawnossCoffinHoldsSomething,
            // CR 603.7a / ADR 0028 — return the bundle keyed to `$source`.
            effects: [{ op: "returnExiledForSource" }],
        }),
        untapTrigger({
            id: "tawnoss-coffin-return-on-untap",
            oracleText:
                "When this artifact becomes untapped, return the exiled card to the battlefield under its owner's control tapped with the noted counters, and reattach the other exiled cards to it.",
            scope: "self",
            condition: tawnossCoffinHoldsSomething,
            // CR 603.7a / ADR 0028 — return the bundle keyed to `$source` (the
            // untapTrigger `effects[]` opt-in mirrors leftTrigger's).
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
};
