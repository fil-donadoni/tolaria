/**
 * Golden fixtures — the evidence a Grammar Rule carries for the forms it
 * accepts (ADR 0137, ADR 0105 § 7.1).
 *
 * A fixture is a real corpus card's Oracle row and the Compiled Definition the
 * rule must produce for it. `__tests__/goldenFixtures.test.ts` compiles every
 * fixture and requires the output to equal `expected`, so a fixture is never a
 * declaration: one that stops matching the compiler is a red test, not a stale
 * claim.
 *
 * What a fixture BUYS is computed, never written down: the quarantine gate
 * (`gates.ts` — `fixtureForms`) runs the same smoke planner over `expected`,
 * and every card-dependent skip form it finds there is a form the grammar has
 * proven it emits correctly. A corpus card whose only smoke skips are such
 * forms reaches `ready` — no field here names a card, a form, or a state.
 *
 * The first fixture arrived with the kicker rule (issue #3826); a
 * card-dependent skip with no fixture exhibiting its form still quarantines,
 * exactly as every smoke skip did before this registry existed.
 */

import type { CompiledDefinition, OracleCard } from "../types";

export interface GoldenFixture {
    /** The `label` of the Grammar Rule that accepts the form. */
    readonly rule: string;
    /** A real corpus card whose Oracle text exhibits the form. */
    readonly card: OracleCard;
    /** The Compiled Definition the rule must produce for `card` — the gold. */
    readonly expected: CompiledDefinition;
}

// Frozen: `fixtureForms` caches by array identity, so the registry may never
// change in place.
export const GOLDEN_FIXTURES: readonly GoldenFixture[] = Object.freeze([
    // CR 500.1 + CR 603.2b — "At the beginning of the end step, return this
    // creature to its owner's hand": the unqualified phrase names EACH end step
    // (CR 500.1). Exhibits `moveZone` of `$source`, a zone change the canned
    // smoke scenario does not model (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "a0a706b2-b237-4183-82fa-2140a23b89e3",
            name: "Archwing Dragon",
            manaCost: "{2}{R}{R}",
            typeLine: "Creature — Dragon",
            oracleText:
                "Flying, haste\nAt the beginning of the end step, return this creature to its owner's hand.",
            power: "4",
            toughness: "4",
            layout: "normal",
        },
        expected: {
            name: "Archwing Dragon",
            types: ["Creature"],
            subtypes: ["Dragon"],
            manaCost: { X: 2, R: 2 },
            power: 4,
            toughness: 4,
            oracleText:
                "Flying, haste\nAt the beginning of the end step, return this creature to its owner's hand.",
            staticAbilities: ["flying", "haste"],
            compiledTriggeredAbilities: [
                {
                    id: "archwing-dragon-trigger",
                    oracleText:
                        "At the beginning of the end step, return this creature to its owner's hand.",
                    head: { kind: "phase", phase: "END_STEP", scope: "each" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    },
    // CR 303.4b + CR 603.2b — "…upkeep of enchanted creature's controller, that
    // player loses 1 life": "that player" is the active player of the host
    // controller's upkeep. Exhibits `loseLife` into an `$event` player, a
    // recipient the canned smoke scenario cannot pick (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "e4f1acd6-b883-470b-88c2-3989011869d7",
            name: "Soul Bleed",
            manaCost: "{2}{B}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.",
            layout: "normal",
        },
        expected: {
            name: "Soul Bleed",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { X: 2, B: 1 },
            oracleText:
                "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.",
            compiledTriggeredAbilities: [
                {
                    id: "soul-bleed-trigger",
                    oracleText:
                        "At the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "host-controller",
                    },
                    effects: [
                        {
                            op: "loseLife",
                            player: { ref: "$event.activePlayerId" },
                            amount: 1,
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 303.4b + CR 603.2b — "…upkeep of enchanted creature's controller, that
    // player draws a card". Exhibits `draw` into an `$event` player
    // (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "d82929f2-57ad-45be-a834-984437046026",
            name: "Super Intelligence",
            manaCost: "{U}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player draws a card.",
            layout: "normal",
        },
        expected: {
            name: "Super Intelligence",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { U: 1 },
            oracleText:
                "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player draws a card.",
            compiledTriggeredAbilities: [
                {
                    id: "super-intelligence-trigger",
                    oracleText:
                        "At the beginning of the upkeep of enchanted creature's controller, that player draws a card.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "host-controller",
                    },
                    effects: [
                        {
                            op: "draw",
                            player: { ref: "$event.activePlayerId" },
                            count: 1,
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 303.4b + CR 122.1 — a -1/-1 counter on "that creature", the host.
    // Exhibits `counters` on `$host` with the -1/-1 counter kind (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "278b237e-9699-43eb-a03e-0b68eccc08b3",
            name: "Unstable Mutation",
            manaCost: "{U}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nEnchanted creature gets +3/+3.\nAt the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
            layout: "normal",
        },
        expected: {
            name: "Unstable Mutation",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { U: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature gets +3/+3.\nAt the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
            compiledTriggeredAbilities: [
                {
                    id: "unstable-mutation-trigger",
                    oracleText:
                        "At the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "host-controller",
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "-1/-1",
                            target: { ref: "$host" },
                            count: 1,
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 3, toughness: 3 },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 106.4 + CR 603.2b — "At the beginning of each player's first main
    // phase, that player adds {G}{G}": the mana goes to `PHASE_BEGIN`'s active
    // player (the head names her), and the first main phase is the precombat
    // one (CR 505.1). Exhibits `addMana` into an `$event` player, a recipient
    // the canned smoke scenario cannot pick (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "faa085c3-705f-465d-9290-0e22276ad06d",
            name: "Eladamri's Vineyard",
            manaCost: "{G}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of each player's first main phase, that player adds {G}{G}.",
            layout: "normal",
        },
        expected: {
            name: "Eladamri's Vineyard",
            types: ["Enchantment"],
            manaCost: { G: 1 },
            oracleText:
                "At the beginning of each player's first main phase, that player adds {G}{G}.",
            compiledTriggeredAbilities: [
                {
                    id: "eladamri-s-vineyard-trigger",
                    oracleText:
                        "At the beginning of each player's first main phase, that player adds {G}{G}.",
                    head: {
                        kind: "phase",
                        phase: "PRECOMBAT_MAIN",
                        scope: "each",
                    },
                    effects: [
                        {
                            op: "addMana",
                            mana: { G: 2 },
                            player: { ref: "$event.activePlayerId" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 303.4b + CR 603.2b — "At the beginning of the upkeep of enchanted
    // creature's controller, put a -0/-1 counter on that creature": the head
    // fires on the host controller's upkeep and "that creature" is the host.
    // Exhibits `counters` on `$host`, a target the canned smoke scenario does
    // not model (issue #4545).
    {
        rule: "trigger head",
        card: {
            oracleId: "9bdc79c9-c8b0-4db1-89d9-0ca7920b6576",
            name: "Essence Flare",
            manaCost: "{U}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+0.\nAt the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
            layout: "normal",
        },
        expected: {
            name: "Essence Flare",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { U: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+0.\nAt the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
            compiledTriggeredAbilities: [
                {
                    id: "essence-flare-trigger",
                    oracleText:
                        "At the beginning of the upkeep of enchanted creature's controller, put a -0/-1 counter on that creature.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "host-controller",
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "-0/-1",
                            target: { ref: "$host" },
                            count: 1,
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "pt-buff",
                    appliesTo: "host",
                    power: 2,
                    toughness: 0,
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 614.9 (issue #3810) — "The next N damage that would be dealt to
    // <recipient> this turn is dealt to <other recipient> instead". Exhibits
    // the "budget is the announced {X}" form: the canned smoke scenario cannot
    // pick a value for {X}, so this fixture is the evidence that the shield
    // the grammar emits is the one the hand-written catalogue writes (Captain's
    // Maneuver also round-trips, Guard C). It is also the ONE corpus card that
    // prints CR 115.4's pre-errata spelling of "any target" on both ends.
    {
        rule: "redirect-next-damage",
        card: {
            oracleId: "a8b93d4d-bb67-4063-ac6d-7775be1b1f10",
            name: "Captain's Maneuver",
            manaCost: "{X}{R}{W}",
            typeLine: "Instant",
            oracleText:
                "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.",
            layout: "normal",
        },
        expected: {
            name: "Captain's Maneuver",
            types: ["Instant"],
            manaCost: { X: "X", W: 1, R: 1 },
            oracleText:
                "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.",
            effects: [
                {
                    op: "redirectDamage",
                    from: { target: 0 },
                    to: { target: 1 },
                    amount: { X: true },
                    duration: { phase: "end-of-turn" },
                },
            ],
            targetRequirement: { type: "any", count: 2 },
        },
    },
    // CR 702.33d — "If this spell was kicked, <effect>" gates the effect on
    // the spell's kicker tally. Exhibits the "reads the spell's kicker count"
    // form: the canned smoke scenario casts unkicked, so this fixture is the
    // evidence that the gate the grammar emits is the one the hand-written
    // catalogue writes (Dismantling Blow also round-trips, Guard C).
    {
        rule: "kicker",
        card: {
            oracleId: "300cba5a-adbb-4852-be06-ac00d9d6fd37",
            name: "Dismantling Blow",
            manaCost: "{2}{W}",
            typeLine: "Instant",
            oracleText:
                "Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards.",
            layout: "normal",
        },
        expected: {
            name: "Dismantling Blow",
            types: ["Instant"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards.",
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {2}{U}",
                    mana: { X: 2, U: 1 },
                },
            ],
            effects: [
                { op: "destroy", target: { target: 0 } },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "draw", player: "controller", count: 2 }],
                },
            ],
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
        },
    },
    // CR 701.9b — "Target player discards two cards": the affected player
    // picks (`choice` kind `discard-hand`; the interpreter clamps the pick to
    // the hand), then a `discard` Op consumes the picks binding. Exhibits the
    // "discard consumes a choice binding" form the canned smoke scenario
    // cannot answer, so this fixture is the evidence the pair is emitted as
    // the hand-written Mind Rot (sets/por/black.cards.ts) writes it — the same
    // card, whose own per-card test covers the suspension and resume.
    {
        rule: "effect clause",
        card: {
            oracleId: "ad44cf74-b717-48fb-9fa2-77512024d76a",
            name: "Mind Rot",
            manaCost: "{2}{B}",
            typeLine: "Sorcery",
            oracleText: "Target player discards two cards.",
            layout: "normal",
        },
        expected: {
            name: "Mind Rot",
            types: ["Sorcery"],
            manaCost: { X: 2, B: 1 },
            oracleText: "Target player discards two cards.",
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discard1",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$discard1" },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 701.21a — "Target player sacrifices a creature of their choice": the
    // sacrificing player picks (`choice` kind `sacrifice-permanents`, raised
    // for the announced player, never the caster), then a `sacrifice` Op
    // consumes the picks binding. Exhibits the "sacrifice consumes a choice
    // binding" form the canned smoke scenario cannot answer, so this fixture
    // is the evidence the pair is emitted as the hand-written edicts write it
    // (Liliana of the Veil's -2, sets/isd/black.cards.ts).
    {
        rule: "effect clause",
        card: {
            oracleId: "058917c1-21ab-488a-9f9c-591c55f3c596",
            name: "Diabolic Edict",
            manaCost: "{1}{B}",
            typeLine: "Instant",
            oracleText: "Target player sacrifices a creature of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Diabolic Edict",
            types: ["Instant"],
            manaCost: { X: 1, B: 1 },
            oracleText: "Target player sacrifices a creature of their choice.",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { target: 0 },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Sacrifice a creature.",
                    bind: "$sacrifice1",
                },
                { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 701.21a + CR 101.4 — "Each player sacrifices a creature of their
    // choice": every player picks in APNAP order inside a simultaneous
    // `forEach`, then the picks are sacrificed together. Exhibits the two
    // forms the smoke scenario cannot build — a `forEach` over the runtime
    // player set and a `choice` acting on its `$each` — so this fixture is the
    // evidence both are emitted as the hand-written Innocent Blood
    // (sets/ody/black.cards.ts) writes them, the card the round-trip also compares.
    {
        rule: "effect clause",
        card: {
            oracleId: "6791ec3c-c397-4087-8c8c-84d3797df415",
            name: "Innocent Blood",
            manaCost: "{B}",
            typeLine: "Sorcery",
            oracleText: "Each player sacrifices a creature of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Innocent Blood",
            types: ["Sorcery"],
            manaCost: { B: 1 },
            oracleText: "Each player sacrifices a creature of their choice.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: { ref: "$each" },
                            zone: "battlefield",
                            filter: { type: "Creature" },
                            count: 1,
                            prompt: "Sacrifice a creature.",
                            bind: "$sacrifice1",
                        },
                        { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
                    ],
                },
            ],
        },
    },
    // CR 701.21a + CR 101.4 — "Each player sacrifices a land of their choice.": the same simultaneous
    // `forEach` as Innocent Blood over the land filter. The smoke form names the
    // filter, so each filter is its own form and needs its own evidence.
    {
        rule: "effect clause",
        card: {
            oracleId: "0fa0f562-e66f-4630-890a-9a4ae24fd6c0",
            name: "Tremble",
            manaCost: "{1}{R}",
            typeLine: "Sorcery",
            oracleText: "Each player sacrifices a land of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Tremble",
            types: ["Sorcery"],
            manaCost: {
                X: 1,
                R: 1,
            },
            oracleText: "Each player sacrifices a land of their choice.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "players",
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: {
                                ref: "$each",
                            },
                            zone: "battlefield",
                            filter: {
                                type: "Land",
                            },
                            count: 1,
                            prompt: "Sacrifice a land.",
                            bind: "$sacrifice1",
                        },
                        {
                            op: "sacrifice",
                            permanents: {
                                ref: "$sacrifice1",
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.21a + CR 101.4 — "Each player sacrifices an enchantment of their choice.": the same simultaneous
    // `forEach` as Innocent Blood over the enchantment filter. The smoke form names the
    // filter, so each filter is its own form and needs its own evidence.
    {
        rule: "effect clause",
        card: {
            oracleId: "853cac98-34dc-471f-af87-1a94b0022b67",
            name: "Simplify",
            manaCost: "{G}",
            typeLine: "Sorcery",
            oracleText:
                "Each player sacrifices an enchantment of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Simplify",
            types: ["Sorcery"],
            manaCost: {
                G: 1,
            },
            oracleText:
                "Each player sacrifices an enchantment of their choice.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "players",
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: {
                                ref: "$each",
                            },
                            zone: "battlefield",
                            filter: {
                                type: "Enchantment",
                            },
                            count: 1,
                            prompt: "Sacrifice an enchantment.",
                            bind: "$sacrifice1",
                        },
                        {
                            op: "sacrifice",
                            permanents: {
                                ref: "$sacrifice1",
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.21a + CR 101.4 — "Each player sacrifices a permanent of their choice.": the same simultaneous
    // `forEach` as Innocent Blood over the whole-permanent list. The smoke form names the
    // filter, so each filter is its own form and needs its own evidence.
    {
        rule: "effect clause",
        card: {
            oracleId: "eb107601-f4ff-4504-9e3f-3de63b0d9e6b",
            name: "Crack the Earth",
            manaCost: "{R}",
            typeLine: "Sorcery — Arcane",
            oracleText: "Each player sacrifices a permanent of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Crack the Earth",
            types: ["Sorcery"],
            subtypes: ["Arcane"],
            manaCost: {
                R: 1,
            },
            oracleText: "Each player sacrifices a permanent of their choice.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "players",
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: {
                                ref: "$each",
                            },
                            zone: "battlefield",
                            filter: {
                                type: [
                                    "Artifact",
                                    "Battle",
                                    "Creature",
                                    "Enchantment",
                                    "Land",
                                    "Planeswalker",
                                ],
                            },
                            count: 1,
                            prompt: "Sacrifice a permanent.",
                            bind: "$sacrifice1",
                        },
                        {
                            op: "sacrifice",
                            permanents: {
                                ref: "$sacrifice1",
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.21a + CR 101.4 — "When this creature enters, each player sacrifices a creature or planeswalker of their choice.": the same simultaneous
    // `forEach` as Innocent Blood over the creature-or-planeswalker union, at an enters head. The smoke form names the
    // filter, so each filter is its own form and needs its own evidence.
    {
        rule: "effect clause",
        card: {
            oracleId: "d5a33091-a348-4b13-8dbd-79ab0ad99afe",
            name: "Demon's Disciple",
            manaCost: "{2}{B}",
            typeLine: "Creature — Human Cleric",
            oracleText:
                "When this creature enters, each player sacrifices a creature or planeswalker of their choice.",
            layout: "normal",
            power: "3",
            toughness: "1",
        },
        expected: {
            name: "Demon's Disciple",
            types: ["Creature"],
            subtypes: ["Human", "Cleric"],
            manaCost: {
                X: 2,
                B: 1,
            },
            power: 3,
            toughness: 1,
            oracleText:
                "When this creature enters, each player sacrifices a creature or planeswalker of their choice.",
            compiledTriggeredAbilities: [
                {
                    id: "demon-s-disciple-trigger",
                    oracleText:
                        "When this creature enters, each player sacrifices a creature or planeswalker of their choice.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "players",
                            },
                            simultaneous: true,
                            effects: [
                                {
                                    op: "choice",
                                    kind: "sacrifice-permanents",
                                    player: {
                                        ref: "$each",
                                    },
                                    zone: "battlefield",
                                    filter: {
                                        type: ["Creature", "Planeswalker"],
                                    },
                                    count: 1,
                                    prompt: "Sacrifice a creature or planeswalker.",
                                    bind: "$sacrifice1",
                                },
                                {
                                    op: "sacrifice",
                                    permanents: {
                                        ref: "$sacrifice1",
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 111.1 + CR 608.2h — "Create X <token>s, where X is that creature's
    // mana value": X is read off the snapshot the previous sentence's Op
    // binds before the object leaves the battlefield. Exhibits two forms the
    // canned smoke scenario cannot build — a `moveZone` to hand that binds
    // its object, and a `createToken` whose count is a ref — so this fixture
    // is the evidence both are emitted as the hand-written Artifact Mutation
    // (sets/inv/multicolor.cards.ts) writes them (issue #4125).
    {
        rule: "create token",
        card: {
            oracleId: "6697fe5b-90ac-4321-aa2f-cdc6ec283cb4",
            name: "Aether Mutation",
            manaCost: "{3}{G}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Return target creature to its owner's hand. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value.",
            layout: "normal",
        },
        expected: {
            name: "Aether Mutation",
            types: ["Sorcery"],
            manaCost: { X: 3, U: 1, G: 1 },
            oracleText:
                "Return target creature to its owner's hand. Create X 1/1 green Saproling creature tokens, where X is that creature's mana value.",
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "hand",
                    bind: "$that1",
                },
                {
                    op: "createToken",
                    token: {
                        name: "Saproling",
                        types: ["Creature"],
                        subtypes: ["Saproling"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                    },
                    controller: "controller",
                    count: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 603.4 + CR 608.2c — Ceta Sanctuary: exhibits the loot (draw, choose-hand-card, discard) and the red/green colour counts (issue #4126).
    {
        rule: "instead if you control",
        card: {
            oracleId: "45c4e67c-e452-41c5-8baa-050819a1321f",
            name: "Ceta Sanctuary",
            manaCost: "{2}{U}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, if you control a red or green permanent, draw a card, then discard a card. If you control a red permanent and a green permanent, instead draw two cards, then discard a card.",
            layout: "normal",
        },
        expected: {
            name: "Ceta Sanctuary",
            types: ["Enchantment"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "At the beginning of your upkeep, if you control a red or green permanent, draw a card, then discard a card. If you control a red permanent and a green permanent, instead draw two cards, then discard a card.",
            compiledTriggeredAbilities: [
                {
                    id: "ceta-sanctuary-trigger",
                    oracleText:
                        "At the beginning of your upkeep, if you control a red or green permanent, draw a card, then discard a card. If you control a red permanent and a green permanent, instead draw two cards, then discard a card.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        filter: {
                            types: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            colors: ["R", "G"],
                        },
                        atLeast: 1,
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: [
                                                "Artifact",
                                                "Battle",
                                                "Creature",
                                                "Enchantment",
                                                "Land",
                                                "Planeswalker",
                                            ],
                                            color: ["R"],
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: [
                                                        "Artifact",
                                                        "Battle",
                                                        "Creature",
                                                        "Enchantment",
                                                        "Land",
                                                        "Planeswalker",
                                                    ],
                                                    color: ["G"],
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "draw",
                                            player: "controller",
                                            count: 2,
                                        },
                                        {
                                            op: "choice",
                                            kind: "choose-hand-card",
                                            player: "controller",
                                            zone: "hand",
                                            count: 1,
                                            prompt: "Discard a card.",
                                            bind: "$discard2",
                                        },
                                        {
                                            op: "discard",
                                            player: "controller",
                                            cards: { ref: "$discard2" },
                                        },
                                    ],
                                    else: [
                                        {
                                            op: "draw",
                                            player: "controller",
                                            count: 1,
                                        },
                                        {
                                            op: "choice",
                                            kind: "choose-hand-card",
                                            player: "controller",
                                            zone: "hand",
                                            count: 1,
                                            prompt: "Discard a card.",
                                            bind: "$discard1",
                                        },
                                        {
                                            op: "discard",
                                            player: "controller",
                                            cards: { ref: "$discard1" },
                                        },
                                    ],
                                },
                            ],
                            else: [
                                { op: "draw", player: "controller", count: 1 },
                                {
                                    op: "choice",
                                    kind: "choose-hand-card",
                                    player: "controller",
                                    zone: "hand",
                                    count: 1,
                                    prompt: "Discard a card.",
                                    bind: "$discard1",
                                },
                                {
                                    op: "discard",
                                    player: "controller",
                                    cards: { ref: "$discard1" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 603.4 + CR 608.2c — Necra Sanctuary: exhibits the green/white colour counts and a player-target replacement (issue #4126).
    {
        rule: "instead if you control",
        card: {
            oracleId: "2586a59d-8501-4c22-9d69-f4bf91de7024",
            name: "Necra Sanctuary",
            manaCost: "{2}{B}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, if you control a green or white permanent, target player loses 1 life. If you control a green permanent and a white permanent, that player loses 3 life instead.",
            layout: "normal",
        },
        expected: {
            name: "Necra Sanctuary",
            types: ["Enchantment"],
            manaCost: { X: 2, B: 1 },
            oracleText:
                "At the beginning of your upkeep, if you control a green or white permanent, target player loses 1 life. If you control a green permanent and a white permanent, that player loses 3 life instead.",
            compiledTriggeredAbilities: [
                {
                    id: "necra-sanctuary-trigger",
                    oracleText:
                        "At the beginning of your upkeep, if you control a green or white permanent, target player loses 1 life. If you control a green permanent and a white permanent, that player loses 3 life instead.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        filter: {
                            types: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            colors: ["G", "W"],
                        },
                        atLeast: 1,
                    },
                    targetRequirement: { type: "player", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: [
                                                "Artifact",
                                                "Battle",
                                                "Creature",
                                                "Enchantment",
                                                "Land",
                                                "Planeswalker",
                                            ],
                                            color: ["G"],
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: [
                                                        "Artifact",
                                                        "Battle",
                                                        "Creature",
                                                        "Enchantment",
                                                        "Land",
                                                        "Planeswalker",
                                                    ],
                                                    color: ["W"],
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "loseLife",
                                            player: { target: 0 },
                                            amount: 3,
                                        },
                                    ],
                                    else: [
                                        {
                                            op: "loseLife",
                                            player: { target: 0 },
                                            amount: 1,
                                        },
                                    ],
                                },
                            ],
                            else: [
                                {
                                    op: "loseLife",
                                    player: { target: 0 },
                                    amount: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 603.4 + CR 608.2c — Ana Sanctuary: exhibits the blue/black colour counts and a creature-target replacement (issue #4126).
    {
        rule: "instead if you control",
        card: {
            oracleId: "51f17fe1-1cf7-4362-b9a2-8ec225d41b03",
            name: "Ana Sanctuary",
            manaCost: "{2}{G}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, if you control a blue or black permanent, target creature gets +1/+1 until end of turn. If you control a blue permanent and a black permanent, that creature gets +5/+5 until end of turn instead.",
            layout: "normal",
        },
        expected: {
            name: "Ana Sanctuary",
            types: ["Enchantment"],
            manaCost: { X: 2, G: 1 },
            oracleText:
                "At the beginning of your upkeep, if you control a blue or black permanent, target creature gets +1/+1 until end of turn. If you control a blue permanent and a black permanent, that creature gets +5/+5 until end of turn instead.",
            compiledTriggeredAbilities: [
                {
                    id: "ana-sanctuary-trigger",
                    oracleText:
                        "At the beginning of your upkeep, if you control a blue or black permanent, target creature gets +1/+1 until end of turn. If you control a blue permanent and a black permanent, that creature gets +5/+5 until end of turn instead.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        filter: {
                            types: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            colors: ["U", "B"],
                        },
                        atLeast: 1,
                    },
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: [
                                                "Artifact",
                                                "Battle",
                                                "Creature",
                                                "Enchantment",
                                                "Land",
                                                "Planeswalker",
                                            ],
                                            color: ["U"],
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: [
                                                        "Artifact",
                                                        "Battle",
                                                        "Creature",
                                                        "Enchantment",
                                                        "Land",
                                                        "Planeswalker",
                                                    ],
                                                    color: ["B"],
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "pump",
                                            target: { target: 0 },
                                            power: 5,
                                            toughness: 5,
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                    else: [
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
                            else: [
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
                },
            ],
        },
    },
    // CR 603.4 + CR 608.2c — Dega Sanctuary: exhibits the black/red colour counts behind an untargeted replacement (issue #4126).
    {
        rule: "instead if you control",
        card: {
            oracleId: "75c626fb-9dfc-4a94-b59f-f0e45c7b2f56",
            name: "Dega Sanctuary",
            manaCost: "{2}{W}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, if you control a black or red permanent, you gain 2 life. If you control a black permanent and a red permanent, you gain 4 life instead.",
            layout: "normal",
        },
        expected: {
            name: "Dega Sanctuary",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "At the beginning of your upkeep, if you control a black or red permanent, you gain 2 life. If you control a black permanent and a red permanent, you gain 4 life instead.",
            compiledTriggeredAbilities: [
                {
                    id: "dega-sanctuary-trigger",
                    oracleText:
                        "At the beginning of your upkeep, if you control a black or red permanent, you gain 2 life. If you control a black permanent and a red permanent, you gain 4 life instead.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        filter: {
                            types: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            colors: ["B", "R"],
                        },
                        atLeast: 1,
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            type: [
                                                "Artifact",
                                                "Battle",
                                                "Creature",
                                                "Enchantment",
                                                "Land",
                                                "Planeswalker",
                                            ],
                                            color: ["B"],
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            count: {
                                                zone: "battlefield",
                                                controller: "controller",
                                                filter: {
                                                    type: [
                                                        "Artifact",
                                                        "Battle",
                                                        "Creature",
                                                        "Enchantment",
                                                        "Land",
                                                        "Planeswalker",
                                                    ],
                                                    color: ["R"],
                                                },
                                            },
                                        },
                                        op: "ge",
                                        right: 1,
                                    },
                                    then: [
                                        {
                                            op: "gainLife",
                                            player: "controller",
                                            amount: 4,
                                        },
                                    ],
                                    else: [
                                        {
                                            op: "gainLife",
                                            player: "controller",
                                            amount: 2,
                                        },
                                    ],
                                },
                            ],
                            else: [
                                {
                                    op: "gainLife",
                                    player: "controller",
                                    amount: 2,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 700.4 + CR 400.7e — "When enchanted creature dies, return that card
    // to its owner's hand": the aura's host dying (`died` scope `host`) and the
    // `$event.card` graveyard-card ref naming the card it became. Exhibits the
    // `moveZone` of a card in a graveyard, which the canned smoke scenario
    // cannot stage (issue #4127).
    {
        rule: "trigger head",
        card: {
            oracleId: "095f8dac-15b8-4c28-ae33-6dc71152bcc7",
            name: "Squee's Embrace",
            manaCost: "{R}{W}",
            typeLine: "Enchantment \u2014 Aura",
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+2.\nWhen enchanted creature dies, return that card to its owner's hand.",
            layout: "normal",
        },
        expected: {
            name: "Squee's Embrace",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: {
                W: 1,
                R: 1,
            },
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+2.\nWhen enchanted creature dies, return that card to its owner's hand.",
            compiledTriggeredAbilities: [
                {
                    id: "squee-s-embrace-trigger",
                    oracleText:
                        "When enchanted creature dies, return that card to its owner's hand.",
                    head: {
                        kind: "died",
                        scope: "host",
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: {
                                ref: "$event.card",
                            },
                            to: "hand",
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "pt-buff",
                    appliesTo: "host",
                    power: 2,
                    toughness: 2,
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
            },
        },
    },
    // CR 603.2b + CR 305.6 — "At the beginning of each player's upkeep, if
    // there are four or more basic land types among lands that player
    // controls, …deals 3 damage to that player": "that player" is
    // `PHASE_BEGIN.activePlayerId` in both the intervening-if and the body.
    // Exhibits damage to an `$event` player, a recipient the canned smoke
    // scenario cannot pick (issue #4127).
    {
        rule: "trigger head",
        card: {
            oracleId: "990d4798-3f59-462d-952c-777da5af1c41",
            name: "Mask of Intolerance",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText:
                "At the beginning of each player's upkeep, if there are four or more basic land types among lands that player controls, this artifact deals 3 damage to that player.",
            layout: "normal",
        },
        expected: {
            name: "Mask of Intolerance",
            types: ["Artifact"],
            manaCost: {
                X: 2,
            },
            oracleText:
                "At the beginning of each player's upkeep, if there are four or more basic land types among lands that player controls, this artifact deals 3 damage to that player.",
            compiledTriggeredAbilities: [
                {
                    id: "mask-of-intolerance-trigger",
                    oracleText:
                        "At the beginning of each player's upkeep, if there are four or more basic land types among lands that player controls, this artifact deals 3 damage to that player.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "each",
                    },
                    condition: {
                        kind: "basic-land-types",
                        player: {
                            eventField: "activePlayerId",
                        },
                        atLeast: 4,
                    },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 3,
                            to: {
                                player: {
                                    ref: "$event.activePlayerId",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 603.2b — "At the beginning of each player's upkeep, that player
    // discards a card at random": exhibits `discardAtRandom` read off the
    // `$event` player the head names (issue #4127).
    {
        rule: "trigger head",
        card: {
            oracleId: "91e6fb47-59e4-4616-b8dd-3a7e30070074",
            name: "Bottomless Pit",
            manaCost: "{1}{B}{B}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of each player's upkeep, that player discards a card at random.",
            layout: "normal",
        },
        expected: {
            name: "Bottomless Pit",
            types: ["Enchantment"],
            manaCost: {
                X: 1,
                B: 2,
            },
            oracleText:
                "At the beginning of each player's upkeep, that player discards a card at random.",
            compiledTriggeredAbilities: [
                {
                    id: "bottomless-pit-trigger",
                    oracleText:
                        "At the beginning of each player's upkeep, that player discards a card at random.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "each",
                    },
                    effects: [
                        {
                            op: "discardAtRandom",
                            player: {
                                ref: "$event.activePlayerId",
                            },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    },
    // CR 110.1 + CR 701.8a — "Destroy all <type>" sweeps every player's
    // battlefield: no target is announced, so the effect is a `forEach` over
    // the battlefield reading `$each`, the shape Tranquility (LEA) writes by
    // hand. Exhibits the two forms the canned smoke scenario cannot build —
    // a `forEach` over a runtime-selected set and a `$each` object ref — so
    // this fixture is the evidence both are emitted as the hand-written
    // sweep writes them (issue #4128).
    {
        rule: "mass subject",
        card: {
            oracleId: "b8d8ece6-397e-4bc9-b86c-7caa1d675d0f",
            name: "Back to Nature",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText: "Destroy all enchantments.",
            layout: "normal",
        },
        expected: {
            name: "Back to Nature",
            types: ["Instant"],
            manaCost: { X: 1, G: 1 },
            oracleText: "Destroy all enchantments.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Enchantment" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    },
    // CR 110.1 + CR 701.26a — "tap all lands you control" is the same sweep
    // with a controller scope and a `tapUntap` body. Exhibits the
    // `tapUntap`-on-`$each` form the smoke generator cannot scenario-ize
    // (issue #4128).
    {
        rule: "mass subject",
        card: {
            oracleId: "5ba1595a-6578-459d-96fe-fdfb84ac34d5",
            name: "Silt Crawler",
            manaCost: "{2}{G}",
            typeLine: "Creature — Beast",
            oracleText: "When this creature enters, tap all lands you control.",
            power: "3",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Silt Crawler",
            types: ["Creature"],
            subtypes: ["Beast"],
            manaCost: { X: 2, G: 1 },
            power: 3,
            toughness: 3,
            oracleText: "When this creature enters, tap all lands you control.",
            compiledTriggeredAbilities: [
                {
                    id: "silt-crawler-trigger",
                    oracleText:
                        "When this creature enters, tap all lands you control.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Land" },
                            },
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "tap",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 202.3 + CR 107.3 — "each artifact, creature, and enchantment with
    // mana value X or less": the union of three types, bounded by the
    // announced {X}. `PermanentFilter` has no mana-value field, so the bound
    // is an `if` over `manaValue of $each` INSIDE the sweep. Exhibits the
    // chosen-cost-X amount form (issue #4128).
    {
        rule: "mass subject",
        card: {
            oracleId: "62e44e0d-eda0-4275-8367-49dab9a087c3",
            name: "Pernicious Deed",
            manaCost: "{1}{B}{G}",
            typeLine: "Enchantment",
            oracleText:
                "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
            layout: "normal",
        },
        expected: {
            name: "Pernicious Deed",
            types: ["Enchantment"],
            manaCost: { X: 1, B: 1, G: 1 },
            oracleText:
                "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
            activatedAbilities: [
                {
                    id: "pernicious-deed-ability",
                    oracleText:
                        "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
                    cost: { mana: { X: "X" }, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: {
                                    type: [
                                        "Artifact",
                                        "Creature",
                                        "Enchantment",
                                    ],
                                },
                            },
                            effects: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            manaValue: { of: { ref: "$each" } },
                                        },
                                        op: "le",
                                        right: { X: true },
                                    },
                                    then: [
                                        {
                                            op: "destroy",
                                            target: { ref: "$each" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 110.1 + CR 701.26b — "untap all lands you control", the untap twin
    // of the tap sweep above. `tapUntap` carries its `action` in the form,
    // so the untap sweep is evidence of its own (issue #4128).
    {
        rule: "mass subject",
        card: {
            oracleId: "6f856f99-4cb4-479d-958d-964220965ed6",
            name: "Wilderness Reclamation",
            manaCost: "{3}{G}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your end step, untap all lands you control.",
            layout: "normal",
        },
        expected: {
            name: "Wilderness Reclamation",
            types: ["Enchantment"],
            manaCost: { X: 3, G: 1 },
            oracleText:
                "At the beginning of your end step, untap all lands you control.",
            compiledTriggeredAbilities: [
                {
                    id: "wilderness-reclamation-trigger",
                    oracleText:
                        "At the beginning of your end step, untap all lands you control.",
                    head: { kind: "phase", phase: "END_STEP", scope: "your" },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Land" },
                            },
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
        },
    },
    // Kicker, CR 702.33e + CR 608.2c — "destroy all lands you control. If it was
    // kicked, destroy all lands instead.": the kicked sweep replaces the
    // base one, so both branches of one `if` carry a sweep and the base
    // rides `else`. Exhibits the kicker-count `if`/`else` form and the
    // unscoped Land sweep (issue #4128).
    {
        rule: "kicked instead",
        card: {
            oracleId: "87f82107-eaba-484a-800d-e61a0cc5e1f2",
            name: "Desolation Angel",
            manaCost: "{3}{B}{B}",
            typeLine: "Creature — Angel",
            oracleText:
                "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nFlying\nWhen this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
            power: "5",
            toughness: "4",
            layout: "normal",
        },
        expected: {
            name: "Desolation Angel",
            types: ["Creature"],
            subtypes: ["Angel"],
            manaCost: { X: 3, B: 2 },
            power: 5,
            toughness: 4,
            oracleText:
                "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nFlying\nWhen this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "desolation-angel-trigger",
                    oracleText:
                        "When this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { kickerCount: true },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "forEach",
                                    select: {
                                        set: "permanents",
                                        zone: "battlefield",
                                        filter: { type: "Land" },
                                    },
                                    effects: [
                                        {
                                            op: "destroy",
                                            target: { ref: "$each" },
                                        },
                                    ],
                                },
                            ],
                            else: [
                                {
                                    op: "forEach",
                                    select: {
                                        set: "permanents",
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: { type: "Land" },
                                    },
                                    effects: [
                                        {
                                            op: "destroy",
                                            target: { ref: "$each" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                { id: "kicker", description: "Kicker {W}{W}", mana: { W: 2 } },
            ],
        },
    },
    // Kicker, CR 702.33e — "destroy all other creatures you control. If
    // it was kicked, destroy all other creatures instead." "Other" is the
    // source excluding itself (`excludeSource`), with and without the
    // controller scope (issue #4128).
    {
        rule: "kicked instead",
        card: {
            oracleId: "c23aaf6d-151e-481a-a345-ca00c14940d1",
            name: "Desolation Giant",
            manaCost: "{2}{R}{R}",
            typeLine: "Creature — Giant",
            oracleText:
                "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nWhen this creature enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead.",
            power: "3",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Desolation Giant",
            types: ["Creature"],
            subtypes: ["Giant"],
            manaCost: { X: 2, R: 2 },
            power: 3,
            toughness: 3,
            oracleText:
                "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nWhen this creature enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead.",
            compiledTriggeredAbilities: [
                {
                    id: "desolation-giant-trigger",
                    oracleText:
                        "When this creature enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { kickerCount: true },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "forEach",
                                    select: {
                                        set: "permanents",
                                        zone: "battlefield",
                                        filter: { type: "Creature" },
                                        excludeSource: true,
                                    },
                                    effects: [
                                        {
                                            op: "destroy",
                                            target: { ref: "$each" },
                                        },
                                    ],
                                },
                            ],
                            else: [
                                {
                                    op: "forEach",
                                    select: {
                                        set: "permanents",
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: { type: "Creature" },
                                        excludeSource: true,
                                    },
                                    effects: [
                                        {
                                            op: "destroy",
                                            target: { ref: "$each" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                { id: "kicker", description: "Kicker {W}{W}", mana: { W: 2 } },
            ],
        },
    },
    // CR 701.6a — "Counter target spell". Exhibits the form the canned smoke
    // scenario cannot build: `counter` acts on a SPELL ON THE STACK, and the
    // generator seeds only players and battlefield permanents. This fixture
    // is the evidence the grammar emits the counter the hand-written
    // Counterspell writes (sets/lea/blue.cards.ts — it round-trips, Guard C), for
    // every card whose counter has the same shape (issue #4129).
    {
        rule: "counter",
        card: {
            oracleId: "cc187110-1148-4090-bbb8-e205694a39f5",
            name: "Counterspell",
            manaCost: "{U}{U}",
            typeLine: "Instant",
            oracleText: "Counter target spell.",
            layout: "normal",
        },
        expected: {
            name: "Counterspell",
            types: ["Instant"],
            manaCost: { U: 2 },
            oracleText: "Counter target spell.",
            effects: [{ op: "counter", target: { target: 0 } }],
            targetRequirement: { type: "spell", count: 1 },
        },
    },
    // CR 118.12a + CR 207.2c — the punisher counter under an ability word:
    // "Domain — Counter target spell unless its controller pays {1} for each
    // basic land type among lands you control". Exhibits a SECOND
    // card-dependent form beside the counter's own — a `mayPay` whose generic
    // price is a Domain tally, which the canned generator cannot size because
    // it seeds no basic lands — so this fixture is the evidence that the
    // may-pay/if-not pair CR 118.12a defines is the one the grammar emits
    // (issue #4129).
    {
        rule: "counter",
        card: {
            oracleId: "4543a99d-eefa-470d-976d-11250524ae28",
            name: "Evasive Action",
            manaCost: "{1}{U}",
            typeLine: "Instant",
            oracleText:
                "Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.",
            layout: "normal",
        },
        expected: {
            name: "Evasive Action",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText:
                "Domain — Counter target spell unless its controller pays {1} for each basic land type among lands you control.",
            effects: [
                {
                    op: "mayPay",
                    player: { controllerOf: { target: 0 } },
                    cost: {
                        genericEqualTo: { domain: { of: "controller" } },
                    },
                    prompt: "Pay {1} for each basic land type among lands Evasive Action's controller controls to prevent your spell from being countered?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$may1" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
            targetRequirement: { type: "spell", count: 1 },
        },
    },
    // CR 205.3m (issue #3721) — "Choose a creature type." as a RESOLUTION-time
    // instruction, plus the descriptor that reads its answer back ("of that
    // type"). Two rules in one card, which is the point: the type the first
    // sentence picks has no printed value, so the second sentence can only be
    // right if both name the same binding. Exhibits the `chooseCreatureType`
    // Op and the `{ ref }` form of `EffectCardFilter.subtype`; the `count`'s
    // 2x multiplier is the already-shipped Landbind Ritual shape, unchanged.
    {
        rule: "effect clause",
        card: {
            oracleId: "7e23a2e7-b8b3-424f-8922-a1adb1db3f4d",
            name: "Luminescent Rain",
            manaCost: "{2}{G}",
            typeLine: "Instant",
            oracleText:
                "Choose a creature type. You gain 2 life for each permanent you control of that type.",
            layout: "normal",
        },
        expected: {
            name: "Luminescent Rain",
            types: ["Instant"],
            manaCost: { X: 2, G: 1 },
            oracleText:
                "Choose a creature type. You gain 2 life for each permanent you control of that type.",
            effects: [
                {
                    op: "chooseCreatureType",
                    player: "controller",
                    prompt: "Choose a creature type",
                    bind: "$chosenType",
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: {
                                type: [
                                    "Artifact",
                                    "Battle",
                                    "Creature",
                                    "Enchantment",
                                    "Land",
                                    "Planeswalker",
                                ],
                                subtype: { ref: "$chosenType" },
                            },
                            times: 2,
                        },
                    },
                },
            ],
        },
    },
    // CR 205.3m + CR 205.1a (issue #4316) — "Choose a creature type other than
    // Wall. Target creature becomes that type until end of turn." The `exclude`
    // leg and the chosen-type write-back are one form: the `setSubtype` Op
    // reads a `{ ref }` bound by the sentence before it, a runtime binding the
    // canned smoke scenario cannot supply. Exhibits `setSubtype` with
    // `family: "creature"` over a ref list.
    {
        rule: "effect clause",
        card: {
            oracleId: "0be10525-09dc-4970-b495-2db7d4d3c3e7",
            name: "Unnatural Selection",
            manaCost: "{1}{U}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.",
            layout: "normal",
        },
        expected: {
            name: "Unnatural Selection",
            types: ["Enchantment"],
            manaCost: { X: 1, U: 1 },
            oracleText:
                "{1}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.",
            activatedAbilities: [
                {
                    id: "unnatural-selection-ability",
                    oracleText:
                        "{1}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "chooseCreatureType",
                            player: "controller",
                            prompt: "Choose a creature type other than Wall.",
                            bind: "$chosenType",
                            exclude: ["Wall"],
                        },
                        {
                            op: "setSubtype",
                            target: { target: 0 },
                            subtypes: { ref: "$chosenType" },
                            family: "creature",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        },
    },
    // CR 120.3 + CR 603.2 — "Whenever this creature deals damage to an
    // opponent, that player discards a card at random": "that player" is the
    // damaged player, `DAMAGE_DEALT.damagedPlayer`. Exhibits a discard by an
    // `$event` player, a recipient the canned smoke scenario cannot pick
    // (issue #4131).
    {
        rule: "trigger head",
        card: {
            oracleId: "759af941-f6a3-4726-91f2-9b1e4e55ea71",
            name: "Hypnotic Specter",
            manaCost: "{1}{B}{B}",
            typeLine: "Creature — Specter",
            oracleText:
                "Flying\nWhenever this creature deals damage to an opponent, that player discards a card at random.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Hypnotic Specter",
            types: ["Creature"],
            subtypes: ["Specter"],
            manaCost: { X: 1, B: 2 },
            power: 2,
            toughness: 2,
            oracleText:
                "Flying\nWhenever this creature deals damage to an opponent, that player discards a card at random.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "hypnotic-specter-trigger",
                    oracleText:
                        "Whenever this creature deals damage to an opponent, that player discards a card at random.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "opponent",
                    },
                    effects: [
                        {
                            op: "discardAtRandom",
                            player: { ref: "$event.damagedPlayer" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    },
    // CR 120.3 + CR 608.2c — "Whenever this creature deals damage to an
    // opponent, you draw a card and that opponent discards a card": the
    // damaged player CHOOSES the discard (CR 701.9b). Exhibits the two forms
    // the canned smoke scenario cannot build — a `choice` raised for an
    // `$event` player, and the `discard` that consumes its binding
    // (issue #4131).
    {
        rule: "trigger head",
        card: {
            oracleId: "9991941e-436f-42d4-8b0c-1ee84234774b",
            name: "Fungal Shambler",
            manaCost: "{4}{B}{G}{U}",
            typeLine: "Creature — Fungus Beast",
            oracleText:
                "Trample\nWhenever this creature deals damage to an opponent, you draw a card and that opponent discards a card.",
            power: "6",
            toughness: "4",
            layout: "normal",
        },
        expected: {
            name: "Fungal Shambler",
            types: ["Creature"],
            subtypes: ["Fungus", "Beast"],
            manaCost: { X: 4, U: 1, B: 1, G: 1 },
            power: 6,
            toughness: 4,
            oracleText:
                "Trample\nWhenever this creature deals damage to an opponent, you draw a card and that opponent discards a card.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "fungal-shambler-trigger",
                    oracleText:
                        "Whenever this creature deals damage to an opponent, you draw a card and that opponent discards a card.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "opponent",
                    },
                    effects: [
                        { op: "draw", player: "controller", count: 1 },
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: { ref: "$event.damagedPlayer" },
                            zone: "hand",
                            count: 1,
                            prompt: "Discard a card.",
                            bind: "$discard1",
                        },
                        {
                            op: "discard",
                            player: { ref: "$event.damagedPlayer" },
                            cards: { ref: "$discard1" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 120.3 + CR 303.4b — "Whenever enchanted creature deals damage, you
    // gain that much life": "that much" is the damage the event dealt,
    // `DAMAGE_DEALT.amount`, a NUMBER field of the firing event. Exhibits an
    // amount the canned smoke scenario cannot know (issue #4131).
    {
        rule: "trigger head",
        card: {
            oracleId: "c77ff526-c0a8-45c7-9730-2e306a0d01b8",
            name: "Spirit Link",
            manaCost: "{W}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhenever enchanted creature deals damage, you gain that much life.",
            layout: "normal",
        },
        expected: {
            name: "Spirit Link",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { W: 1 },
            oracleText:
                "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhenever enchanted creature deals damage, you gain that much life.",
            compiledTriggeredAbilities: [
                {
                    id: "spirit-link-trigger",
                    oracleText:
                        "Whenever enchanted creature deals damage, you gain that much life.",
                    head: {
                        kind: "damage-dealt",
                        source: "host",
                        recipient: "any",
                    },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: { ref: "$event.amount" },
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 120.3 + CR 109.2 — "Whenever this creature is dealt damage, it deals
    // that much damage to you": the receiver is the source itself, and "that
    // much" is the damage the event dealt, `DAMAGE_DEALT.amount`. Exhibits a
    // `dealDamage` amount the canned smoke scenario cannot know, at a head the
    // goldens above only reach through `gainLife` (issue #4544).
    {
        rule: "trigger head",
        card: {
            oracleId: "3707ab74-9aec-4d30-86e0-ffa5f72d5b4f",
            name: "Jackal Pup",
            manaCost: "{R}",
            typeLine: "Creature — Jackal",
            oracleText:
                "Whenever this creature is dealt damage, it deals that much damage to you.",
            power: "2",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Jackal Pup",
            types: ["Creature"],
            subtypes: ["Jackal"],
            manaCost: { R: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Whenever this creature is dealt damage, it deals that much damage to you.",
            compiledTriggeredAbilities: [
                {
                    id: "jackal-pup-trigger",
                    oracleText:
                        "Whenever this creature is dealt damage, it deals that much damage to you.",
                    head: { kind: "damage-taken", scope: "self" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$event.amount" },
                            to: { player: "controller" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 601.2c — "Return up to two target creature cards from your graveyard
    // to your hand": ONE announced group two slots wide, with the verb fanned
    // out over both ({ target: 0 } / { target: 1 }, the hand-written Force of
    // Vigor shape). Exhibits the "moveZone changes zones on a zone the canned
    // generator does not model" form, whose slot zone is the GRAVEYARD — so
    // this fixture is the evidence that a graveyard-slot bounce is emitted as
    // the catalogue writes it.
    {
        rule: "target filter",
        card: {
            oracleId: "882d3be7-1c0f-4d2b-8f2e-32369488ef82",
            name: "Urborg Uprising",
            manaCost: "{4}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Return up to two target creature cards from your graveyard to your hand.\nDraw a card.",
            layout: "normal",
        },
        expected: {
            name: "Urborg Uprising",
            types: ["Sorcery"],
            manaCost: { X: 4, B: 1 },
            oracleText:
                "Return up to two target creature cards from your graveyard to your hand.\nDraw a card.",
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "hand" },
                { op: "moveZone", target: { target: 1 }, to: "hand" },
                { op: "draw", player: "controller", count: 1 },
            ],
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 2 },
                zone: "graveyard",
                controller: "you",
            },
        },
    },
    // CR 400.7 + CR 110.2a — "Return target creature card from your graveyard
    // to the battlefield": a graveyard-slot `moveZone` whose destination is the
    // battlefield, so the card returns as a NEW object under its owner's
    // control (the hand-written Resurrection, sets/lea/white.cards.ts, writes the same
    // op). Exhibits the "moveZone changes zones on a zone the canned generator
    // does not model" form whose op skeleton is `to: "battlefield"` and whose
    // slot zone is the GRAVEYARD, a different skeleton from Urborg Uprising's
    // `to: "hand"`, so it is its own evidence (issue #4299).
    {
        rule: "effect clause",
        card: {
            oracleId: "bb95db4d-5017-4121-bf79-d68476602d8c",
            name: "Zombify",
            manaCost: "{3}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Return target creature card from your graveyard to the battlefield.",
            layout: "normal",
        },
        expected: {
            name: "Zombify",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 1 },
            oracleText:
                "Return target creature card from your graveyard to the battlefield.",
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "battlefield" },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
        },
    },
    // CR 702.33g — "Destroy target land. If this spell was kicked, destroy
    // another target land": the gate's target is announced only on a kicked
    // cast, which the engine says with the swapped-in
    // `kickedTargetRequirement` (the Magma Burst / Falling Timber count
    // widening). Exhibits the "reads the spell's kicker count" form over a
    // `destroy` — a different op skeleton from Dismantling Blow's `draw`, so
    // its own evidence — and shows the swap itself, which no ready card can.
    {
        rule: "target filter",
        card: {
            oracleId: "5231a7d6-b6cf-4fa8-8da8-f0ecf023e054",
            name: "Dwarven Landslide",
            manaCost: "{3}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Kicker—{2}{R}, Sacrifice a land. (You may pay {2}{R} and sacrifice a land in addition to any other costs as you cast this spell.)\nDestroy target land. If this spell was kicked, destroy another target land.",
            layout: "normal",
        },
        expected: {
            name: "Dwarven Landslide",
            types: ["Sorcery"],
            manaCost: { X: 3, R: 1 },
            oracleText:
                "Kicker—{2}{R}, Sacrifice a land. (You may pay {2}{R} and sacrifice a land in addition to any other costs as you cast this spell.)\nDestroy target land. If this spell was kicked, destroy another target land.",
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker—{2}{R}, Sacrifice a land",
                    mana: { X: 2, R: 1 },
                    permanent: {
                        action: "sacrifice",
                        filter: { types: ["Land"] },
                        count: 1,
                    },
                },
            ],
            effects: [
                { op: "destroy", target: { target: 0 } },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "destroy", target: { target: 1 } }],
                },
            ],
            targetRequirement: { type: "Land", count: 1 },
            kickedTargetRequirement: { type: "Land", count: 2 },
        },
    },
    // CR 613.4c + CR 109.5 — "Creatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2": a group pump is a `forEach` over the controller's creatures. Exhibits the forms the canned smoke scenario cannot build — a sweep over a runtime-selected set, a `$each` pump, and the kicked gate around a sweep (issue #4132).
    {
        rule: "mass subject",
        card: {
            name: "Strength of Night",
            manaCost: "{2}{G}",
            typeLine: "Instant",
            oracleText:
                "Kicker {B} (You may pay an additional {B} as you cast this spell.)\nCreatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2 until end of turn.",
            oracleId: "0045cf16-86dd-4417-ae36-88ca63b30c26",
            layout: "normal",
        },
        expected: {
            name: "Strength of Night",
            types: ["Instant"],
            manaCost: { X: 2, G: 1 },
            oracleText:
                "Kicker {B} (You may pay an additional {B} as you cast this spell.)\nCreatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2 until end of turn.",
            kickers: [
                { id: "kicker", description: "Kicker {B}", mana: { B: 1 } },
            ],
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
                    ],
                },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature", subtype: "Zombie" },
                            },
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$each" },
                                    power: 2,
                                    toughness: 2,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 613.4c + CR 115.1 — "Creatures target player controls get -2/-2 until end of turn": the swept battlefield is an announced player's, so the sweep's controller is the target slot. Exhibits a sweep whose controller is a runtime target; Night // Day's Day half prints the same clause (issue #4132).
    {
        rule: "mass subject",
        card: {
            name: "Arms of Hadar",
            manaCost: "{3}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Creatures target player controls get -2/-2 until end of turn.",
            oracleId: "c15e5cb8-b94c-4157-9327-410e66606b82",
            layout: "normal",
        },
        expected: {
            name: "Arms of Hadar",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 1 },
            oracleText:
                "Creatures target player controls get -2/-2 until end of turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                        controller: { target: 0 },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: -2,
                            toughness: -2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 613.4c + CR 207.2c — "Domain — All creatures get -1/-1 until end of turn for each basic land type among lands you control": each stat is the printed step times the controller's Domain, negated for a shrink, over a sweep. Exhibits a pump amount the canned smoke scenario cannot know (issue #4132).
    {
        rule: "effect clause",
        card: {
            name: "Planar Despair",
            manaCost: "{3}{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Domain — All creatures get -1/-1 until end of turn for each basic land type among lands you control.",
            oracleId: "1ba36042-8902-4abb-a4ae-a8d26d81a0de",
            layout: "normal",
        },
        expected: {
            name: "Planar Despair",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 2 },
            oracleText:
                "Domain — All creatures get -1/-1 until end of turn for each basic land type among lands you control.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: { negate: { domain: { of: "controller" } } },
                            toughness: {
                                negate: { domain: { of: "controller" } },
                            },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 613.4c + CR 207.2c — "Domain — Target creature gets +1/+1 until end of turn for each basic land type among lands you control": the same per-Domain step on ONE announced creature. Exhibits a pump amount the canned smoke scenario cannot know, on a target slot (issue #4132).
    {
        rule: "effect clause",
        card: {
            name: "Gaea's Might",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText:
                "Domain — Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
            oracleId: "73b26f12-78eb-4d01-9dd6-ee643c7a80a8",
            layout: "normal",
        },
        expected: {
            name: "Gaea's Might",
            types: ["Instant"],
            manaCost: { G: 1 },
            oracleText:
                "Domain — Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { domain: { of: "controller" } },
                    toughness: { domain: { of: "controller" } },
                    duration: { phase: "end-of-turn" },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 613.4c + CR 207.2c — "Domain — Target creature gets -1/-1 until end of turn for each basic land type among lands you control": the shrink twin of the fixture above, whose amount is a negated Domain (issue #4132).
    {
        rule: "effect clause",
        card: {
            name: "Drag Down",
            manaCost: "{2}{B}",
            typeLine: "Instant",
            oracleText:
                "Domain — Target creature gets -1/-1 until end of turn for each basic land type among lands you control.",
            oracleId: "30e397e9-a705-4484-8387-04fb84010b2d",
            layout: "normal",
        },
        expected: {
            name: "Drag Down",
            types: ["Instant"],
            manaCost: { X: 2, B: 1 },
            oracleText:
                "Domain — Target creature gets -1/-1 until end of turn for each basic land type among lands you control.",
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { negate: { domain: { of: "controller" } } },
                    toughness: { negate: { domain: { of: "controller" } } },
                    duration: { phase: "end-of-turn" },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 205.1b + CR 611.2c — "All lands become 2/2 creatures until end of turn. They're still lands.": a sweep that animates the set as it is when the spell resolves, KEEPING each land's types (the rider). Exhibits `animate` acting on a runtime-selected land, which the canned smoke scenario cannot stage; Life // Death prints the same clause for the controller's lands (issue #4132).
    {
        rule: "effect clause",
        card: {
            name: "Natural Affinity",
            manaCost: "{2}{G}",
            typeLine: "Instant",
            oracleText:
                "All lands become 2/2 creatures until end of turn. They're still lands.",
            oracleId: "09a1ab1b-d9f0-4a2a-a448-3190f85006e4",
            layout: "normal",
        },
        expected: {
            name: "Natural Affinity",
            types: ["Instant"],
            manaCost: { X: 2, G: 1 },
            oracleText:
                "All lands become 2/2 creatures until end of turn. They're still lands.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Land" },
                    },
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$each" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 613.1e — "This creature becomes the color of your choice until end of
    // turn": the layer-5 colour change applied to the ability's OWN source.
    // Exhibits the form the canned smoke scenario refuses — a `setColor` on
    // `$source`, which the generator hands back to the card's own test rather
    // than scenario-izing — so this fixture is the evidence the grammar emits
    // the colour pick the hand-written Rainbow Crow writes (sets/inv/blue.cards.ts
    // — it round-trips, Guard C), for every card printing the same self form
    // (Caldera Kavu, Spiritmonger; issue #4137).
    {
        rule: "color of your choice",
        card: {
            oracleId: "79bf98c8-1169-477d-838e-2ebc0fa396dc",
            name: "Rainbow Crow",
            manaCost: "{3}{U}",
            typeLine: "Creature — Bird",
            oracleText:
                "Flying\n{1}: This creature becomes the color of your choice until end of turn.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Rainbow Crow",
            types: ["Creature"],
            subtypes: ["Bird"],
            manaCost: { X: 3, U: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Flying\n{1}: This creature becomes the color of your choice until end of turn.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "rainbow-crow-ability",
                    oracleText:
                        "{1}: This creature becomes the color of your choice until end of turn.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "optionChoice",
                            prompt: "Choose a color (Rainbow Crow).",
                            modes: [
                                {
                                    id: "W",
                                    label: "White",
                                    color: "W",
                                    effects: [
                                        {
                                            op: "setColor",
                                            target: { ref: "$source" },
                                            colors: ["W"],
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                                {
                                    id: "U",
                                    label: "Blue",
                                    color: "U",
                                    effects: [
                                        {
                                            op: "setColor",
                                            target: { ref: "$source" },
                                            colors: ["U"],
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                                {
                                    id: "B",
                                    label: "Black",
                                    color: "B",
                                    effects: [
                                        {
                                            op: "setColor",
                                            target: { ref: "$source" },
                                            colors: ["B"],
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                                {
                                    id: "R",
                                    label: "Red",
                                    color: "R",
                                    effects: [
                                        {
                                            op: "setColor",
                                            target: { ref: "$source" },
                                            colors: ["R"],
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                                {
                                    id: "G",
                                    label: "Green",
                                    color: "G",
                                    effects: [
                                        {
                                            op: "setColor",
                                            target: { ref: "$source" },
                                            colors: ["G"],
                                            duration: { phase: "end-of-turn" },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 107.1 + CR 119.3 — "You gain 2 life for each Plains you control": the
    // printed multiplier over the cardinality of the controller's permanents
    // with one subtype. Exhibits the "count set applies a multiplier" form: the
    // canned smoke predictor does not model `times`, so this fixture is the
    // evidence that the `count` the grammar emits is the one the hand-written
    // catalogue writes (Price of Progress' `times`).
    {
        rule: "effect clause",
        card: {
            name: "Landbind Ritual",
            manaCost: "{3}{W}{W}",
            typeLine: "Sorcery",
            oracleText: "You gain 2 life for each Plains you control.",
            oracleId: "63500b81-8fac-4208-91d3-0fe642899d87",
            layout: "normal",
        },
        expected: {
            name: "Landbind Ritual",
            types: ["Sorcery"],
            manaCost: { X: 3, W: 2 },
            oracleText: "You gain 2 life for each Plains you control.",
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Plains" },
                            times: 2,
                        },
                    },
                },
            ],
        },
    },
    // CR 402.3 + CR 119.3 — "You gain 2 life for each card in your hand": the
    // size of a hand, a hidden zone whose CARDINALITY is public. Exhibits the
    // "count set counts a HAND" form (and the multiplier again): the canned
    // generator's hand contents belong to the cast filler, so this fixture is
    // the evidence that the hand count the grammar emits is the shipped one.
    {
        rule: "effect clause",
        card: {
            name: "Gerrard's Wisdom",
            manaCost: "{2}{W}{W}",
            typeLine: "Sorcery",
            oracleText: "You gain 2 life for each card in your hand.",
            oracleId: "3e30e8f2-f437-4620-a3bc-dd9c29ae6570",
            layout: "normal",
        },
        expected: {
            name: "Gerrard's Wisdom",
            types: ["Sorcery"],
            manaCost: { X: 2, W: 2 },
            oracleText: "You gain 2 life for each card in your hand.",
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "hand",
                            controller: "controller",
                            times: 2,
                        },
                    },
                },
            ],
        },
    },
    // CR 508.3a — "Whenever a creature you control attacks, IT gets …".
    // Exhibits the "the Op's subject is an object the canned scenario cannot
    // seed" form: the pumped creature is named by the FIRING EVENT
    // (`$event.combatant`), which no canned board can conjure, so the smoke
    // run has no outcome to prove. The evidence the rule needs is therefore
    // this fixture — that the per-attacker head and the site-bound pronoun
    // together compile to a pump of the attacking creature, and not of the
    // enchantment the line is printed on.
    {
        rule: "trigger head",
        card: {
            oracleId: "6226db2b-d1a8-4c41-b802-67d3f65d2ca3",
            name: "Fervent Charge",
            manaCost: "{1}{R}{W}{B}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever a creature you control attacks, it gets +2/+2 until end of turn.",
            layout: "normal",
        },
        expected: {
            name: "Fervent Charge",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1, B: 1, R: 1 },
            oracleText:
                "Whenever a creature you control attacks, it gets +2/+2 until end of turn.",
            compiledTriggeredAbilities: [
                {
                    id: "fervent-charge-trigger",
                    oracleText:
                        "Whenever a creature you control attacks, it gets +2/+2 until end of turn.",
                    head: { kind: "attacks", scope: "yours" },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$event.combatant" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 508.3a / 509.3a — "Whenever a creature attacks or blocks, this
    // enchantment deals 2 damage to IT". The same unseedable-subject form on
    // the other side: ONE Oracle line over two events, with "it" in a
    // mid-sentence object position. The fixture is what proves the line stays
    // one triggered ability reading one censused field on both of them, rather
    // than two abilities or a damage that finds nobody.
    {
        rule: "trigger head",
        card: {
            oracleId: "3a8a67ad-e4ff-4b55-9976-a2f13cc9b41b",
            name: "Powerstone Minefield",
            manaCost: "{2}{R}{W}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.",
            layout: "normal",
        },
        expected: {
            name: "Powerstone Minefield",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 1, R: 1 },
            oracleText:
                "Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.",
            compiledTriggeredAbilities: [
                {
                    id: "powerstone-minefield-trigger",
                    oracleText:
                        "Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.",
                    head: { kind: "attacks-or-blocks", scope: "any" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { ref: "$event.combatant" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 202.3 + CR 208.1 + CR 608.2h — a characteristic of the object an
    // earlier sentence acted on ("that permanent's mana value", "its power",
    // "its toughness"), read off the snapshot that `destroy` took before the
    // object left the battlefield. The canned smoke scenario cannot plan an
    // amount that only a runtime binding knows, so each site and each
    // characteristic the phrase reaches needs its own evidence: the DAMAGE
    // amount (Orim's Thunder, below, whose reading is also gated on the kicker
    // — CR 702.33d), the life LOSS amount (Feed the Swarm) and the life GAIN
    // amount per characteristic (Chastise, Sever Soul, Terashi's Grasp) are
    // different Op skeletons — the `ref` names the slot — and therefore
    // different forms (issues #4221, #4248).
    {
        rule: "acted-on characteristic",
        card: {
            oracleId: "380429d5-82db-449c-b9b9-3e82ab987972",
            name: "Orim's Thunder",
            manaCost: "{2}{W}",
            typeLine: "Instant",
            oracleText:
                "Kicker {R} (You may pay an additional {R} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, it deals damage equal to that permanent's mana value to target creature.",
            layout: "normal",
        },
        expected: {
            name: "Orim's Thunder",
            types: ["Instant"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "Kicker {R} (You may pay an additional {R} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, it deals damage equal to that permanent's mana value to target creature.",
            kickers: [
                { id: "kicker", description: "Kicker {R}", mana: { R: 1 } },
            ],
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$that1.manaValue" },
                            to: { target: 1 },
                        },
                    ],
                },
            ],
            targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
            additionalTargetRequirements: [
                { type: "Creature", count: 1, announcedOnlyIfKicked: true },
            ],
        },
    },
    {
        rule: "acted-on characteristic",
        card: {
            oracleId: "5825997b-10d7-4a36-972c-a80ddd90b8ed",
            name: "Feed the Swarm",
            manaCost: "{1}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
            layout: "normal",
        },
        expected: {
            name: "Feed the Swarm",
            types: ["Sorcery"],
            manaCost: { X: 1, B: 1 },
            oracleText:
                "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: {
                type: ["Creature", "Enchantment"],
                count: 1,
                controller: "opponent",
            },
        },
    },
    {
        rule: "acted-on characteristic",
        card: {
            oracleId: "b7553f3f-5de1-409c-a184-e12e40f017ab",
            name: "Chastise",
            manaCost: "{3}{W}",
            typeLine: "Instant",
            oracleText:
                "Destroy target attacking creature. You gain life equal to its power.",
            layout: "normal",
        },
        expected: {
            name: "Chastise",
            types: ["Instant"],
            manaCost: { X: 3, W: 1 },
            oracleText:
                "Destroy target attacking creature. You gain life equal to its power.",
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.power" },
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: ["attacking"],
            },
        },
    },
    {
        rule: "acted-on characteristic",
        card: {
            oracleId: "577d027a-96c3-46fe-880b-f8b5dd3f3a3d",
            name: "Sever Soul",
            manaCost: "{3}{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Destroy target nonblack creature. It can't be regenerated. You gain life equal to its toughness.",
            layout: "normal",
        },
        expected: {
            name: "Sever Soul",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 2 },
            oracleText:
                "Destroy target nonblack creature. It can't be regenerated. You gain life equal to its toughness.",
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                    bind: "$that1",
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.toughness" },
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeColors: ["B"],
            },
        },
    },
    {
        rule: "acted-on characteristic",
        card: {
            oracleId: "d4738552-3a5e-43c5-a975-8b77618bacaf",
            name: "Terashi's Grasp",
            manaCost: "{2}{W}",
            typeLine: "Sorcery — Arcane",
            oracleText:
                "Destroy target artifact or enchantment. You gain life equal to its mana value.",
            layout: "normal",
        },
        expected: {
            name: "Terashi's Grasp",
            types: ["Sorcery"],
            subtypes: ["Arcane"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "Destroy target artifact or enchantment. You gain life equal to its mana value.",
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
        },
    },
    // CR 601.2d — "deals N damage divided as you choose among <count
    // phrase> <targets>": the split is chosen at ANNOUNCEMENT and snapshotted
    // onto the stack item's `targetAmounts`, which the canned smoke scenario
    // cannot populate. Exhibits the "announced multi-target division" form, so
    // this fixture is the evidence that the group + Op the grammar emits are
    // the ones the hand-written catalogue writes (Arc Lightning also
    // round-trips, Guard C; its resolution has its own test in
    // `__tests__/dividedDamage.test.ts`).
    {
        rule: "divided damage",
        card: {
            oracleId: "0c81ade7-0074-4447-ba2c-b16fa0f09ccb",
            name: "Arc Lightning",
            manaCost: "{2}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.",
            layout: "normal",
        },
        expected: {
            name: "Arc Lightning",
            types: ["Sorcery"],
            manaCost: { X: 2, R: 1 },
            oracleText:
                "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.",
            effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
            targetRequirement: {
                type: "any",
                count: { min: 1 },
                divideAsChosen: { total: 3 },
            },
        },
    },
    // CR 601.2d — the same division with an {X} budget. A distinct
    // FORM from the fixed one above: the gate keys a smoke skip on the Op's
    // skeleton (`opSkeleton`), and `total: "X"` is not `total: 3` — Arc
    // Lightning's row clears the fixed budget only.
    {
        rule: "divided damage",
        card: {
            oracleId: "9c47888b-28a5-4c43-9ee4-a9059e3c367d",
            name: "Rolling Thunder",
            manaCost: "{X}{R}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Rolling Thunder deals X damage divided as you choose among any number of targets.",
            layout: "normal",
        },
        expected: {
            name: "Rolling Thunder",
            types: ["Sorcery"],
            manaCost: { X: "X", R: 2 },
            oracleText:
                "Rolling Thunder deals X damage divided as you choose among any number of targets.",
            effects: [{ op: "dealDamageDividedAsChosen", total: "X" }],
            targetRequirement: {
                type: "any",
                count: { min: 1 },
                divideAsChosen: { total: "X" },
            },
        },
    },
    // CR 303.4b / CR 115.10 — "Enchanted creature gets +1/+0 until end of
    // turn" on an Aura's own activated ability: the host is named by the text,
    // never announced, so the pump acts on `{ ref: "$host" }` (issue #1341).
    // Exhibits the form the canned smoke scenario refuses — a `pump` on a
    // subject it does not seed (`$host` is neither a target slot nor the
    // seeded `$source`) — so this fixture is the evidence the grammar emits
    // the host pump the hand-written `$host` cards write (Umezawa's Jitte's
    // "+2/+2", sets/bok/colorless.cards.ts), for every Aura whose pump is a fixed
    // "+N/+M until end of turn" (issue #4303). A pump with another duration
    // is a different form and quarantines until it has a fixture of its own.
    {
        rule: "effect clause",
        card: {
            oracleId: "8603bf74-faab-4910-8e45-0f2e3b318efb",
            name: "Firebreathing",
            manaCost: "{R}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.",
            layout: "normal",
        },
        expected: {
            name: "Firebreathing",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { R: 1 },
            oracleText:
                "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn.",
            activatedAbilities: [
                {
                    id: "firebreathing-ability",
                    oracleText:
                        "{R}: Enchanted creature gets +1/+0 until end of turn.",
                    cost: { mana: { R: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$host" },
                            power: 1,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 303.4b / CR 613.1f — the keyword-grant twin: "Enchanted creature
    // gains vigilance until end of turn" is a `grantAbility` on `$host`.
    // Exhibits its own smoke skip (a different reason string than the pump's,
    // so a different form). The form hashes the granted keyword and the
    // duration, so this clears "gains vigilance until end of turn" only — every
    // other keyword quarantines until it has a fixture of its own (issue #4303).
    {
        rule: "effect clause",
        card: {
            oracleId: "e649614a-ff23-4234-92f4-6f564cbfe648",
            name: "Ocular Halo",
            manaCost: "{3}{U}",
            typeLine: "Enchantment — Aura",
            oracleText:
                'Enchant creature\nEnchanted creature has "{T}: Draw a card."\n{W}: Enchanted creature gains vigilance until end of turn.',
            layout: "normal",
        },
        expected: {
            name: "Ocular Halo",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { X: 3, U: 1 },
            oracleText:
                'Enchant creature\nEnchanted creature has "{T}: Draw a card."\n{W}: Enchanted creature gains vigilance until end of turn.',
            activatedAbilities: [
                {
                    id: "ocular-halo-ability",
                    oracleText:
                        "{W}: Enchanted creature gains vigilance until end of turn.",
                    cost: { mana: { W: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "grantAbility",
                            target: { ref: "$host" },
                            ability: "vigilance",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "activated-grant",
                    appliesTo: "host",
                    abilityId: "ocular-halo-granted",
                },
            ],
            grantTemplates: [
                {
                    id: "ocular-halo-granted",
                    oracleText: "{T}: Draw a card.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 701.24a + CR 121.1 — "Shuffle the cards from your hand into your
    // library, then draw that many cards": the whole hand moves into the
    // library, the library is shuffled, and as many cards are drawn as the
    // hand held. Exhibits the "whole-zone move binds its count" form and the
    // "draw reads a numeric binding" form: the canned smoke scenario seeds
    // neither the hand nor the count, so this fixture is the evidence that
    // the `bindCount` / `{ ref }` pair the grammar emits reads the hand's
    // size BEFORE the move (Winds of Change's hand-written `getHandSize`
    // capture, in the Effect Script's own vocabulary).
    {
        rule: "effect clause",
        card: {
            oracleId: "13a3f2c1-0454-4661-a462-542254f8360d",
            name: "Whirlpool Rider",
            manaCost: "{1}{U}",
            typeLine: "Creature — Merfolk",
            oracleText:
                "When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Whirlpool Rider",
            types: ["Creature"],
            subtypes: ["Merfolk"],
            manaCost: { X: 1, U: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.",
            compiledTriggeredAbilities: [
                {
                    id: "whirlpool-rider-trigger",
                    oracleText:
                        "When this creature enters, shuffle the cards from your hand into your library, then draw that many cards.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "moveZone",
                            player: "controller",
                            from: "hand",
                            to: "library",
                            bindCount: "$handSize1",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                        {
                            op: "draw",
                            player: "controller",
                            count: { ref: "$handSize1" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) — "Search your library for a basic
    // land card, reveal it, put it into your hand, then shuffle": the
    // controller may find one basic land, shows it to every player, takes it,
    // and shuffles. Exhibits three card-dependent forms at once, which is why
    // the clause reaches no card without this row: the `choice` is sized at
    // RUNTIME (the canned generator cannot say how many basics the library
    // holds), the `reveal` reads a binding only that choice writes, and the
    // `moveZone` changes zones on an object the generator does not model.
    // Lay of the Land is the plainest printing of the form and the
    // enforced-Target card the gap held (issue #4305).
    {
        rule: "effect clause",
        card: {
            oracleId: "cedc52eb-66a6-4b43-87f1-9bb9f4d4871e",
            name: "Lay of the Land",
            manaCost: "{G}",
            typeLine: "Sorcery",
            oracleText:
                "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Lay of the Land",
            types: ["Sorcery"],
            manaCost: { G: 1 },
            oracleText:
                "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a basic land card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found1" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) —
    // "Search your library for a creature card, reveal it, then shuffle and put
    // the card on top": the tutor-to-top. Exhibits the same three
    // card-dependent forms as the to-hand tutor (a runtime-sized `choice`, a
    // `reveal` reading its binding, a `moveZone` on an object the generator
    // does not model), the last one to `library-top` (issue #4554).
    {
        rule: "effect clause",
        card: {
            oracleId: "e8863518-0bfa-49c3-8c6e-6c9116a81051",
            name: "Worldly Tutor",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText:
                "Search your library for a creature card, reveal it, then shuffle and put the card on top.",
            layout: "normal",
        },
        expected: {
            name: "Worldly Tutor",
            types: ["Instant"],
            manaCost: { G: 1 },
            oracleText:
                "Search your library for a creature card, reveal it, then shuffle and put the card on top.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a creature card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found1" },
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "library-top",
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) —
    // "Search your library for an artifact or enchantment card, reveal it, then shuffle and put
    // that card on top": the tutor-to-top. Exhibits the same three
    // card-dependent forms as the to-hand tutor (a runtime-sized `choice`, a
    // `reveal` reading its binding, a `moveZone` on an object the generator
    // does not model), the last one to `library-top` (issue #4554).
    {
        rule: "effect clause",
        card: {
            oracleId: "c5229c17-b7be-4b05-b683-f2277edc4849",
            name: "Enlightened Tutor",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText:
                "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.",
            layout: "normal",
        },
        expected: {
            name: "Enlightened Tutor",
            types: ["Instant"],
            manaCost: { W: 1 },
            oracleText:
                "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: ["Artifact", "Enchantment"] },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an artifact or enchantment card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found1" },
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "library-top",
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 110.5b + CR 701.24a (shuffle) — "Search your
    // library for a Forest or Plains card, put it onto the battlefield, then
    // shuffle": the dual-land fetch. Two card-dependent forms (a runtime-sized
    // `choice`, a `moveZone` on an object the generator does not model). A form
    // keeps the Op's string literals, so each subtype pair is its own form and
    // its own row (issue #4552).
    ...(
        [
            [
                "Windswept Heath",
                "29737a60-3ebd-40d9-b935-c4f54b90d45d",
                "a Forest or Plains",
                ["Forest", "Plains"],
            ],
            [
                "Wooded Foothills",
                "6587a463-a108-4854-b6d1-944e89b8c8a4",
                "a Mountain or Forest",
                ["Mountain", "Forest"],
            ],
            [
                "Flooded Strand",
                "f3c7af78-a77d-4134-82a2-a5ce84285a84",
                "a Plains or Island",
                ["Plains", "Island"],
            ],
            [
                "Bloodstained Mire",
                "fc0707c7-d504-4ccf-a0d2-3eb6e26e7a57",
                "a Swamp or Mountain",
                ["Swamp", "Mountain"],
            ],
            [
                "Polluted Delta",
                "ef86989d-ce80-4e55-aece-7d11710eeffa",
                "an Island or Swamp",
                ["Island", "Swamp"],
            ],
        ] as const
    ).map(([name, oracleId, what, subtype]): GoldenFixture => {
        const text = `{T}, Pay 1 life, Sacrifice this land: Search your library for ${what} card, put it onto the battlefield, then shuffle.`;
        return {
            rule: "effect clause",
            card: {
                oracleId,
                name,
                manaCost: "",
                typeLine: "Land",
                oracleText: text,
                layout: "normal",
            },
            expected: {
                name,
                types: ["Land"],
                oracleText: text,
                activatedAbilities: [
                    {
                        id: `${name.toLowerCase().replace(/ /g, "-")}-ability`,
                        oracleText: text,
                        cost: { tap: true, life: 1, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "choice",
                                kind: "search-library",
                                player: "controller",
                                zone: "library",
                                filter: { subtype: [...subtype] },
                                count: { min: 0, max: 1 },
                                prompt: `Search your library for ${what} card.`,
                                bind: "$found1",
                            },
                            {
                                op: "moveZone",
                                cards: { ref: "$found1" },
                                player: "controller",
                                from: "library",
                                to: "battlefield",
                            },
                            {
                                op: "libraryLook",
                                action: "shuffle",
                                player: "controller",
                            },
                        ],
                    },
                ],
            },
        };
    }),
    // CR 701.23a + CR 110.5b + CR 701.24a — "Search your library for a basic
    // land card, put that card onto the battlefield tapped, then shuffle": the
    // `moveZone` carries `tapped`, which is part of its skeleton (issue #4552).
    {
        rule: "effect clause",
        card: {
            oracleId: "e3afc704-220f-498f-9eaa-0821b17dc24c",
            name: "Sakura-Tribe Elder",
            manaCost: "{1}{G}",
            typeLine: "Creature — Snake Shaman",
            oracleText:
                "Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Sakura-Tribe Elder",
            types: ["Creature"],
            subtypes: ["Snake", "Shaman"],
            manaCost: { G: 1, X: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
            activatedAbilities: [
                {
                    id: "sakura-tribe-elder-ability",
                    oracleText:
                        "Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
                    cost: { sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Land", supertype: "Basic" },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a basic land card.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "battlefield",
                            tapped: true,
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        },
    },
    // CR 120.3 — "<self> deals N damage to each creature and each player":
    // the fixed two-set damage recipient union lowers to a PAIR of `forEach`
    // sweeps (one over battlefield creatures, one over players), because
    // `dealDamage.to` names one recipient and the sentence names two disjoint
    // sets. Exhibits the "$each object ref" and "$each player ref" forms the
    // canned smoke scenario cannot build, so this fixture is the evidence the
    // pair is emitted the way the hand-written Pestilence writes it
    // (`sets/lea/black.cards.ts`).
    {
        rule: "effect clause",
        card: {
            oracleId: "ef220824-fab4-4d8e-9ba4-65ff5ba1db66",
            name: "Thrashing Wumpus",
            manaCost: "{3}{B}{B}",
            typeLine: "Creature — Beast",
            oracleText:
                "{B}: This creature deals 1 damage to each creature and each player.",
            power: "3",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Thrashing Wumpus",
            types: ["Creature"],
            subtypes: ["Beast"],
            manaCost: { X: 3, B: 2 },
            power: 3,
            toughness: 3,
            oracleText:
                "{B}: This creature deals 1 damage to each creature and each player.",
            activatedAbilities: [
                {
                    id: "thrashing-wumpus-ability",
                    oracleText:
                        "{B}: This creature deals 1 damage to each creature and each player.",
                    cost: { mana: { B: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: { type: "Creature" },
                            },
                            effects: [
                                {
                                    op: "dealDamage",
                                    amount: 1,
                                    to: { ref: "$each" },
                                },
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
                },
            ],
        },
    },
    // CR 120.3 + CR 702.9a (issue #4310) — "<self> deals N damage to each creature
    // without <keyword>": one `forEach` over battlefield creatures whose
    // selector carries `filter.excludeAbility`. Exhibits the "$each object ref"
    // form the canned smoke scenario cannot build, and is the evidence the
    // keyword exclusion rides the selector filter (Earthquake's shape, which
    // the hand-written catalogue writes with `dealDamageToEach`).
    {
        rule: "effect clause",
        card: {
            oracleId: "7246e3a0-f8b7-4c1b-ae75-a1eb8990a728",
            name: "Ashen Firebeast",
            manaCost: "{6}{R}{R}",
            typeLine: "Creature — Elemental Beast",
            oracleText:
                "{1}{R}: This creature deals 1 damage to each creature without flying.",
            power: "6",
            toughness: "6",
            layout: "normal",
        },
        expected: {
            name: "Ashen Firebeast",
            types: ["Creature"],
            subtypes: ["Elemental", "Beast"],
            manaCost: { X: 6, R: 2 },
            power: 6,
            toughness: 6,
            oracleText:
                "{1}{R}: This creature deals 1 damage to each creature without flying.",
            activatedAbilities: [
                {
                    id: "ashen-firebeast-ability",
                    oracleText:
                        "{1}{R}: This creature deals 1 damage to each creature without flying.",
                    cost: { mana: { X: 1, R: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: {
                                    type: "Creature",
                                    excludeAbility: "flying",
                                },
                            },
                            effects: [
                                {
                                    op: "dealDamage",
                                    amount: 1,
                                    to: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 120.3 + CR 615.7 — the same two-set union under "prevent the next N
    // damage that would be dealt to <recipient> this turn": `preventDamage`'s
    // `to` mirrors `dealDamage`'s, so the same fan-out applies, this time
    // exhibiting the "preventDamage acts on $each" card-dependent form.
    {
        rule: "effect clause",
        card: {
            oracleId: "ed854708-5a65-4293-bebc-d7c639407ba5",
            name: "Kitsune Palliator",
            manaCost: "{2}{W}",
            typeLine: "Creature — Fox Cleric",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
            power: "0",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Kitsune Palliator",
            types: ["Creature"],
            subtypes: ["Fox", "Cleric"],
            manaCost: { X: 2, W: 1 },
            power: 0,
            toughness: 2,
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
            activatedAbilities: [
                {
                    id: "kitsune-palliator-ability",
                    oracleText:
                        "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: { type: "Creature" },
                            },
                            effects: [
                                {
                                    op: "preventDamage",
                                    mode: "next-n",
                                    to: { ref: "$each" },
                                    amount: 1,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                        {
                            op: "forEach",
                            select: { set: "players" },
                            effects: [
                                {
                                    op: "preventDamage",
                                    mode: "next-n",
                                    to: { player: { ref: "$each" } },
                                    amount: 1,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 107.1c + CR 705.2 (issue #3813, ADR 0144) — "Choose a number. Flip
    // a coin that many times or until you lose a flip, whichever comes first.
    // If you win all the flips, draw two cards for each flip." Exhibits the
    // coin-flip series form: its flips are random bits the canned smoke
    // scenario cannot fix, so this fixture is the evidence that the series,
    // its "no flip lost" gate and its per-flip draw are the ones the
    // hand-written catalogue writes (Squee's Revenge also round-trips,
    // Guard C).
    {
        rule: "coin-flip-series",
        card: {
            oracleId: "3c9f3f26-339e-459e-9847-4e33aafb6f9b",
            name: "Squee's Revenge",
            manaCost: "{1}{U}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
            layout: "normal",
        },
        expected: {
            name: "Squee's Revenge",
            types: ["Sorcery"],
            manaCost: { X: 1, U: 1, R: 1 },
            oracleText:
                "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
            effects: [
                {
                    op: "chooseNumber",
                    player: "controller",
                    prompt: "Choose a number.",
                    bind: "$n",
                },
                {
                    op: "coinFlipSeries",
                    count: { ref: "$n" },
                    untilLoss: true,
                    bindFlips: "$flips",
                    bindLosses: "$losses",
                },
                {
                    op: "if",
                    predicate: {
                        left: { ref: "$losses" },
                        op: "lt",
                        right: 1,
                    },
                    then: [
                        {
                            op: "draw",
                            player: "controller",
                            count: {
                                scaled: {
                                    value: { ref: "$flips" },
                                    times: 2,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 110.2 + CR 608.2h (issue #4313) — "{self} deals N damage to that
    // creature's controller". Exhibits the "player parameter is a ref" form
    // twice over: the canned smoke scenario cannot know whom a snapshot or an
    // announced object's controller will be, so these fixtures are the evidence
    // that the recipient the grammar emits is right — the `bind` snapshot when
    // the earlier sentence removes the creature (Consign to the Pit), the live
    // `controllerOf` slot read when it stays (Blur of Blades).
    {
        rule: "effect clause",
        card: {
            oracleId: "b0c50079-5376-47ff-82c5-d52dbf49afdf",
            name: "Consign to the Pit",
            manaCost: "{5}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Destroy target creature. Consign to the Pit deals 2 damage to that creature's controller.",
            layout: "normal",
        },
        expected: {
            name: "Consign to the Pit",
            types: ["Sorcery"],
            manaCost: { X: 5, B: 1 },
            oracleText:
                "Destroy target creature. Consign to the Pit deals 2 damage to that creature's controller.",
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "dealDamage",
                    amount: 2,
                    to: { player: { ref: "$that1.controller" } },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "65410f7a-c749-4b23-ad61-8a7136efcad2",
            name: "Blur of Blades",
            manaCost: "{1}{R}",
            typeLine: "Instant",
            oracleText:
                "Put a -1/-1 counter on target creature. Blur of Blades deals 2 damage to that creature's controller.",
            layout: "normal",
        },
        expected: {
            name: "Blur of Blades",
            types: ["Instant"],
            manaCost: { X: 1, R: 1 },
            oracleText:
                "Put a -1/-1 counter on target creature. Blur of Blades deals 2 damage to that creature's controller.",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "-1/-1",
                    target: { target: 0 },
                    count: 1,
                },
                {
                    op: "dealDamage",
                    amount: 2,
                    to: { player: { controllerOf: { target: 0 } } },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 118.1 + CR 608.2h + CR 208.1 — "its power" where "its" is the source
    // its own cost sacrificed (Flame Elemental; Cinder Shade, Minotaur
    // Illusionist): the last-known power read off the cost snapshot as the
    // `sacrificed` value. The canned smoke scenario never pays a cost, so no
    // snapshot exists to read and the form would sit in quarantine without
    // evidence (issue #4317).
    {
        rule: "effect clause",
        card: {
            oracleId: "975226a4-2d03-4993-9337-cfd6595011bd",
            name: "Flame Elemental",
            manaCost: "{2}{R}{R}",
            typeLine: "Creature — Elemental",
            oracleText:
                "{R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.",
            power: "3",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Flame Elemental",
            types: ["Creature"],
            subtypes: ["Elemental"],
            manaCost: { X: 2, R: 2 },
            power: 3,
            toughness: 2,
            oracleText:
                "{R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.",
            activatedAbilities: [
                {
                    id: "flame-elemental-ability",
                    oracleText:
                        "{R}, {T}, Sacrifice this creature: It deals damage equal to its power to target creature.",
                    cost: { mana: { R: 1 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { sacrificed: { read: "power" } },
                            to: { target: 0 },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        },
    },
    // CR 702.34a / 514.2 (issue #4756) — "<target instant or sorcery card in
    // your graveyard> gains flashback until end of turn. The flashback cost is
    // equal to its mana cost." Exhibits the "grants flashback to a
    // graveyard-card target" form: the canned smoke scenario seeds no
    // graveyard target, so this fixture is the evidence that the grant the
    // grammar emits is the one the hand-written catalogue writes (Snapcaster
    // Mage also round-trips, Guard C). One form for every slot: the triggered,
    // spell and activated sites lower the same `grantFlashback` on a
    // graveyard slot.
    {
        rule: "effect clause",
        card: {
            oracleId: "2bb2eda7-3b38-4c56-870f-c3218a1056f5",
            name: "Snapcaster Mage",
            manaCost: "{1}{U}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
            power: "2",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Snapcaster Mage",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: { X: 1, U: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)",
            staticAbilities: ["flash"],
            compiledTriggeredAbilities: [
                {
                    id: "snapcaster-mage-trigger",
                    oracleText:
                        "When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: ["Instant", "Sorcery"],
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                    },
                    effects: [{ op: "grantFlashback", card: { target: 0 } }],
                },
            ],
        },
    },
    // CR 701.20a + CR 700.3 (issue #4524) — a pile division of a revealed
    // library window. Exhibits the "suspends for two different players' picks"
    // and "moves cards between zones" forms the canned smoke scenario cannot
    // run: this fixture is the evidence the Op the grammar emits is the one the
    // hand-written catalogue writes (Fact or Fiction round-trips, Guard C).
    {
        rule: "effect clause",
        card: {
            name: "Fact or Fiction",
            manaCost: "{3}{U}",
            typeLine: "Instant",
            oracleText:
                "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.",
            oracleId: "437b2dab-15e0-4b9a-a204-58622d37a3b3",
            layout: "normal",
        },
        expected: {
            name: "Fact or Fiction",
            types: ["Instant"],
            manaCost: {
                X: 3,
                U: 1,
            },
            oracleText:
                "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.",
            effects: [
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "library-top",
                        player: "controller",
                        count: 5,
                    },
                    divider: "opponent",
                    chooser: "controller",
                    dividePrompt: "Separate the revealed cards into two piles.",
                    pickPrompt:
                        "Choose a pile: it goes to your hand, the other to your graveyard.",
                    chosenBind: "$chosenPile",
                    otherBind: "$otherPile",
                    chosenEffect: [
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$chosenPile",
                            },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                    ],
                    otherEffect: [
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$otherPile",
                            },
                            player: "controller",
                            from: "library",
                            to: "graveyard",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.20a + CR 119.3 (issue #4524) — reveal the top card into hand, then
    // lose life equal to its mana value. Exhibits the "amount reads a selected
    // object's mana value" form the canned scenario cannot size; the output is
    // the hand-written Dark Confidant's (Guard C).
    {
        rule: "effect clause",
        card: {
            name: "Dark Confidant",
            manaCost: "{1}{B}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
            power: "2",
            toughness: "1",
            oracleId: "2068185c-1b50-47d0-aa3f-bf505d199428",
            layout: "normal",
        },
        expected: {
            name: "Dark Confidant",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: {
                X: 1,
                B: 1,
            },
            power: 2,
            toughness: 1,
            oracleText:
                "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
            compiledTriggeredAbilities: [
                {
                    id: "dark-confidant-trigger",
                    oracleText:
                        "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "your",
                    },
                    effects: [
                        {
                            op: "digMatchingToHand",
                            player: "controller",
                            look: 1,
                            filter: {},
                            destination: "graveyard",
                            bind: "$revealed",
                        },
                        {
                            op: "loseLife",
                            player: "controller",
                            amount: {
                                manaValue: {
                                    of: {
                                        ref: "$revealed",
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.20a + CR 700.3 (issue #4524) — the caster separates, an opponent
    // chooses (`divider` and `chooser` swapped against Fact or Fiction). A
    // distinct card-dependent form: the smoke generator cannot run the
    // two-player pick either way.
    {
        rule: "effect clause",
        card: {
            name: "Steam Augury",
            manaCost: "{2}{U}{R}",
            typeLine: "Instant",
            oracleText:
                "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.",
            oracleId: "0aa556a6-66aa-42f1-ba41-0001e10c20a4",
            layout: "normal",
        },
        expected: {
            name: "Steam Augury",
            types: ["Instant"],
            manaCost: {
                X: 2,
                U: 1,
                R: 1,
            },
            oracleText:
                "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.",
            effects: [
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "library-top",
                        player: "controller",
                        count: 5,
                    },
                    divider: "controller",
                    chooser: "opponent",
                    dividePrompt: "Separate the revealed cards into two piles.",
                    pickPrompt:
                        "Choose a pile: it goes to the other player's hand, the rest to their graveyard.",
                    chosenBind: "$chosenPile",
                    otherBind: "$otherPile",
                    chosenEffect: [
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$chosenPile",
                            },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                    ],
                    otherEffect: [
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$otherPile",
                            },
                            player: "controller",
                            from: "library",
                            to: "graveyard",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.17a — "that player mills a card" at a damage head: the milled
    // player is the one the damage went to, `$event.damagedPlayer`, a binding
    // no canned board can conjure. Exhibits `mill` reading an event player.
    {
        rule: "effect clause",
        card: {
            oracleId: "13fb5413-0057-4022-84da-2c90ce065ed1",
            name: "Reef Pirates",
            manaCost: "{1}{U}{U}",
            typeLine: "Creature — Zombie Pirate",
            oracleText:
                "Whenever this creature deals damage to an opponent, that player mills a card.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Reef Pirates",
            types: ["Creature"],
            subtypes: ["Zombie", "Pirate"],
            manaCost: {
                X: 1,
                U: 2,
            },
            power: 2,
            toughness: 2,
            oracleText:
                "Whenever this creature deals damage to an opponent, that player mills a card.",
            compiledTriggeredAbilities: [
                {
                    id: "reef-pirates-trigger",
                    oracleText:
                        "Whenever this creature deals damage to an opponent, that player mills a card.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "opponent",
                    },
                    effects: [
                        {
                            op: "mill",
                            player: {
                                ref: "$event.damagedPlayer",
                            },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.17a — "that player mills a card" at an each-upkeep head: the
    // milled player is whoever's upkeep it is, `$event.activePlayerId`.
    // Exhibits `mill` reading the active-player binding.
    {
        rule: "effect clause",
        card: {
            oracleId: "ab050d55-a47d-4880-b65a-29f562773d7a",
            name: "Worry Beads",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "At the beginning of each player's upkeep, that player mills a card.",
            layout: "normal",
        },
        expected: {
            name: "Worry Beads",
            types: ["Artifact"],
            manaCost: {
                X: 3,
            },
            oracleText:
                "At the beginning of each player's upkeep, that player mills a card.",
            compiledTriggeredAbilities: [
                {
                    id: "worry-beads-trigger",
                    oracleText:
                        "At the beginning of each player's upkeep, that player mills a card.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "each",
                    },
                    effects: [
                        {
                            op: "mill",
                            player: {
                                ref: "$event.activePlayerId",
                            },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.44a — "it explores": the exploring permanent is the ability's own
    // source (`$source`), which the canned generator cannot model; the Op
    // carries its own permanent test. Exhibits `explore` acting on the source.
    {
        rule: "effect clause",
        card: {
            oracleId: "5007425e-a626-46f7-ab7d-777af97ee724",
            name: "Emperor's Vanguard",
            manaCost: "{3}{G}",
            typeLine: "Creature — Human Scout",
            oracleText:
                "Whenever this creature deals combat damage to a player, it explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard.)",
            power: "4",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Emperor's Vanguard",
            types: ["Creature"],
            subtypes: ["Human", "Scout"],
            manaCost: {
                X: 3,
                G: 1,
            },
            power: 4,
            toughness: 3,
            oracleText:
                "Whenever this creature deals combat damage to a player, it explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard.)",
            compiledTriggeredAbilities: [
                {
                    id: "emperor-s-vanguard-trigger",
                    oracleText:
                        "Whenever this creature deals combat damage to a player, it explores.",
                    head: {
                        kind: "combat-damage-to-player",
                    },
                    effects: [
                        {
                            op: "explore",
                            target: {
                                ref: "$source",
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 201.4 + CR 701.9a — "Choose a nonland card name. Target player reveals
    // their hand and discards all cards with that name": exhibits `nameCard`
    // and the discard that reads its pick back as a `$named` name filter, a
    // runtime binding the canned smoke scenario cannot build (issue #4528).
    {
        rule: "effect clause",
        card: {
            oracleId: "018107d1-ebf7-4657-bc91-c8374af55cc5",
            name: "Cabal Therapy",
            manaCost: "{B}",
            typeLine: "Sorcery",
            oracleText:
                "Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback—Sacrifice a creature. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
            layout: "normal",
        },
        expected: {
            name: "Cabal Therapy",
            types: ["Sorcery"],
            manaCost: { B: 1 },
            oracleText:
                "Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback—Sacrifice a creature. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
            effects: [
                {
                    op: "nameCard",
                    player: "controller",
                    prompt: "Choose a nonland card name.",
                    bind: "$named",
                    nameRestriction: "no-land",
                },
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { name: { ref: "$named" } },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
            flashback: { sacrifice: { types: ["Creature"] } },
        },
    },
    // CR 201.4 + CR 701.20a — "Choose a card name other than a basic land card
    // name. Reveal the top seven cards ... put all of them with that name into
    // your hand. Exile the rest.": exhibits `nameCard` read back by
    // `digMatchingToHand`'s `$named` filter (issue #4528).
    {
        rule: "effect clause",
        card: {
            oracleId: "308b49ad-ebab-41c4-9e09-44202549bafc",
            name: "Desperate Research",
            manaCost: "{1}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Choose a card name other than a basic land card name. Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest.",
            layout: "normal",
        },
        expected: {
            name: "Desperate Research",
            types: ["Sorcery"],
            manaCost: { X: 1, B: 1 },
            oracleText:
                "Choose a card name other than a basic land card name. Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest.",
            effects: [
                {
                    op: "nameCard",
                    player: "controller",
                    prompt: "Choose a card name other than a basic land card name.",
                    bind: "$named",
                    nameRestriction: "no-basic-land",
                },
                {
                    op: "digMatchingToHand",
                    player: "controller",
                    look: 7,
                    filter: { name: { ref: "$named" } },
                    destination: "exile",
                },
            ],
        },
    },
    // CR 107.3f (issue #4529) — "You may pay {X}. If you do, <effect>": the
    // controller nominates X as the payment is made and the payoff reads the
    // amount paid. Exhibits the "numeric ref to a runtime snapshot" form: the
    // canned smoke scenario cannot choose a payment, so this fixture is the
    // evidence that the `payVariableMana` + `ref` shape the grammar emits is
    // the one the hand-written catalogue writes (Decree of Justice).
    {
        rule: "effect clause",
        card: {
            oracleId: "87a4caa4-cb08-4a0c-b57a-d6d8474b1f5e",
            name: "Vigil for the Lost",
            manaCost: "{3}{W}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
            layout: "normal",
        },
        expected: {
            name: "Vigil for the Lost",
            types: ["Enchantment"],
            manaCost: { X: 3, W: 1 },
            oracleText:
                "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
            compiledTriggeredAbilities: [
                {
                    id: "vigil-for-the-lost-trigger",
                    oracleText:
                        "Whenever a creature you control dies, you may pay {X}. If you do, you gain X life.",
                    head: { kind: "died", scope: "yours" },
                    effects: [
                        {
                            op: "payVariableMana",
                            player: "controller",
                            prompt: "You may pay {X}. If you do, you gain X life",
                            bind: "$paid1",
                        },
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: { ref: "$paid1" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 106.1 + CR 608.2c — Cabal Ritual: exhibits the `if` Op's runtime "left" amount (a graveyard count), the card-dependent skip its threshold would otherwise quarantine on (issue #4541).
    {
        rule: "add mana instead if count",
        card: {
            oracleId: "5b5bf1fa-6502-4790-b66b-f0f8504ebc7c",
            name: "Cabal Ritual",
            manaCost: "{1}{B}",
            typeLine: "Instant",
            oracleText:
                "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
            layout: "normal",
        },
        expected: {
            name: "Cabal Ritual",
            types: ["Instant"],
            manaCost: { X: 1, B: 1 },
            oracleText:
                "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "graveyard",
                                controller: "controller",
                            },
                        },
                        op: "ge",
                        right: 7,
                    },
                    then: [{ op: "addMana", mana: { B: 5 } }],
                    else: [{ op: "addMana", mana: { B: 3 } }],
                },
            ],
        },
    },
    // CR 610.3 / ADR 0028 (issue #4526) — "exile <target> until this
    // permanent leaves the battlefield". Exhibits the "return only observable
    // after an exile armed a bundle" form: the canned smoke scenario has no
    // bundle to return, so this fixture is the evidence that the pair the
    // grammar emits — the arming exile and the synthesized, bundle-gated
    // departure trigger — is the one the hand-written catalogue writes
    // (Banishing Light's own hand-written twin). The printed CR 607.2a pair
    // (Journey to Nowhere) is refused, not fixtured: it has no duration, and
    // `exileWithAttachments` applies CR 610.3b (`linkExile.ts`).
    {
        rule: "effect clause",
        card: {
            name: "Banishing Light",
            manaCost: "{2}{W}",
            typeLine: "Enchantment",
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            oracleId: "f28b21a6-f7ce-437a-8c5b-0423cb55cefb",
            layout: "normal",
        },
        expected: {
            name: "Banishing Light",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 1 },
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            compiledTriggeredAbilities: [
                {
                    id: "banishing-light-trigger",
                    oracleText:
                        "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                        count: 1,
                        excludeTypes: ["Land"],
                        controller: "opponent",
                    },
                    effects: [
                        { op: "exileWithAttachments", target: { target: 0 } },
                    ],
                },
                {
                    id: "banishing-light-trigger-2",
                    oracleText:
                        "When Banishing Light leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
                    head: { kind: "left", scope: "self" },
                    condition: { kind: "holds-exile-bundle" },
                    effects: [{ op: "returnExiledForSource" }],
                },
            ],
        },
    },
    // CR 603.6c + CR 400.7e — "When this Aura is put into a graveyard from the
    // battlefield, return it to its owner's hand": the source's own exit to a
    // graveyard (`left-to-graveyard`, scope `self`), and `$source` naming the card
    // it became there. Exhibits the `moveZone` of a card in a graveyard, which the
    // canned smoke scenario cannot stage (issue #4546).
    {
        rule: "trigger head",
        card: {
            oracleId: "9d2d6479-531c-4ce1-b52b-00e36fa63b64",
            name: "Rancor",
            manaCost: "{G}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen this Aura is put into a graveyard from the battlefield, return it to its owner's hand.",
            layout: "normal",
        },
        expected: {
            name: "Rancor",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { G: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen this Aura is put into a graveyard from the battlefield, return it to its owner's hand.",
            compiledTriggeredAbilities: [
                {
                    id: "rancor-trigger",
                    oracleText:
                        "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.",
                    head: { kind: "left-to-graveyard", scope: "self" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 2, toughness: 0 },
                {
                    kind: "keyword-grant",
                    appliesTo: "host",
                    keyword: "trample",
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 603.6c + CR 404.1 + CR 603.2 — "Whenever a spell or ability an opponent
    // controls causes a land to be put into your graveyard from the battlefield,
    // return that card to the battlefield": a land owned by the controller, put
    // into their graveyard by an opponent's spell or ability, and `$event.card`
    // naming the card it became. Exhibits the graveyard → battlefield `moveZone`
    // the canned smoke scenario cannot stage (issue #4546).
    {
        rule: "trigger head",
        card: {
            oracleId: "b18e773c-611b-4c18-8b2d-8d3a7e5ddc93",
            name: "Sacred Ground",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
            layout: "normal",
        },
        expected: {
            name: "Sacred Ground",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
            compiledTriggeredAbilities: [
                {
                    id: "sacred-ground-trigger",
                    oracleText:
                        "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
                    head: {
                        kind: "left-to-graveyard",
                        scope: "any",
                        filter: { types: ["Land"] },
                        ownedBy: "you",
                        causedBy: "opponent",
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$event.card" },
                            to: "battlefield",
                        },
                    ],
                },
            ],
        },
    },
    // CR 603.2 + CR 603.6c + CR 400.7e — "Whenever another card is put into a
    // graveyard from anywhere, exile that card": a card reaching a graveyard by
    // any route (`graveyard-entry`) and `$event.card` naming it there. Exhibits
    // the graveyard → exile `moveZone` the canned smoke scenario cannot stage
    // (issue #4546).
    {
        rule: "trigger head",
        card: {
            oracleId: "994e27e1-0bff-47c9-a1e6-b9e3ae4ffb1e",
            name: "Planar Void",
            manaCost: "{B}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever another card is put into a graveyard from anywhere, exile that card.",
            layout: "normal",
        },
        expected: {
            name: "Planar Void",
            types: ["Enchantment"],
            manaCost: { B: 1 },
            oracleText:
                "Whenever another card is put into a graveyard from anywhere, exile that card.",
            compiledTriggeredAbilities: [
                {
                    id: "planar-void-trigger",
                    oracleText:
                        "Whenever another card is put into a graveyard from anywhere, exile that card.",
                    head: {
                        kind: "graveyard-entry",
                        graveyard: "any",
                        excludeSelf: true,
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$event.card" },
                            to: "exile",
                        },
                    ],
                },
            ],
        },
    },
    // CR 201.4 + CR 701.20a — "Choose a card name, then reveal a card at random
    // from your hand. If that card has the chosen name, …": the name pick and
    // the random reveal each bind a runtime value that the `if` gate reads
    // (`picksMatchFilter` over the hand), which the canned smoke scenario
    // cannot answer (issue #4550).
    {
        rule: "effect clause",
        card: {
            oracleId: "31415b9b-fb30-4132-a9a3-795b4573a901",
            name: "Cursed Scroll",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.",
            layout: "normal",
        },
        expected: {
            name: "Cursed Scroll",
            types: ["Artifact"],
            manaCost: { X: 1 },
            oracleText:
                "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.",
            activatedAbilities: [
                {
                    id: "cursed-scroll-ability",
                    oracleText:
                        "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.",
                    cost: { mana: { X: 3 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "nameCard",
                            player: "controller",
                            prompt: "Choose a card name.",
                            bind: "$named",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            zone: "hand",
                            random: true,
                            bind: "$revealed",
                        },
                        {
                            op: "if",
                            predicate: {
                                picksMatchFilter: { ref: "$revealed" },
                                player: "controller",
                                zone: "hand",
                                filter: { name: { ref: "$named" } },
                            },
                            then: [
                                {
                                    op: "dealDamage",
                                    amount: 2,
                                    to: { target: 0 },
                                },
                            ],
                        },
                    ],
                    targetRequirement: { type: "any", count: 1 },
                },
            ],
        },
    },
    // CR 701.23a + CR 701.20a + CR 701.24a — "Search your library for a land card, reveal it, put it into your hand, then shuffle" (issue #4553). The same runtime-sized `choice` / `reveal` / `moveZone` forms as Lay of the Land's basic-land fetch, on a plain `{ type: "Land" }` filter.
    {
        rule: "effect clause",
        card: {
            oracleId: "8fcf50cd-e6d0-4516-850f-d42ee75dcc3a",
            name: "Expedition Map",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Expedition Map",
            types: ["Artifact"],
            manaCost: { X: 1 },
            oracleText:
                "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
            activatedAbilities: [
                {
                    id: "expedition-map-ability",
                    oracleText:
                        "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
                    cost: { mana: { X: 2 }, tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Land" },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a land card.",
                            bind: "$found1",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            cards: { ref: "$found1" },
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a + CR 701.20a + CR 701.24a — "Search your library for a creature card, reveal that card, put it into your hand, then shuffle" behind an activated cost with a discard (issue #4553).
    {
        rule: "effect clause",
        card: {
            oracleId: "119d719d-e965-45b4-9bc9-ac03211b10c2",
            name: "Survival of the Fittest",
            manaCost: "{1}{G}",
            typeLine: "Enchantment",
            oracleText:
                "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Survival of the Fittest",
            types: ["Enchantment"],
            manaCost: { X: 1, G: 1 },
            oracleText:
                "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            activatedAbilities: [
                {
                    id: "survival-of-the-fittest-ability",
                    oracleText:
                        "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
                    cost: {
                        mana: { G: 1 },
                        discardFilter: {
                            filter: { type: "Creature" },
                            count: 1,
                        },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Creature" },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a creature card.",
                            bind: "$found1",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            cards: { ref: "$found1" },
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a + CR 701.20a + CR 701.24a — "you may search your library for a Goblin card, reveal that card, ..." behind a trigger's may-gate (issue #4553).
    {
        rule: "effect clause",
        card: {
            oracleId: "145737a7-c597-4dec-b752-207c2d0501e3",
            name: "Goblin Matron",
            manaCost: "{2}{R}",
            typeLine: "Creature — Goblin",
            oracleText:
                "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Goblin Matron",
            types: ["Creature"],
            subtypes: ["Goblin"],
            manaCost: { X: 2, R: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.",
            compiledTriggeredAbilities: [
                {
                    id: "goblin-matron-trigger",
                    oracleText:
                        "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Search your library for a Goblin card, reveal that card, put it into your hand, then shuffle?",
                            bind: "$may2",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may2" },
                            then: [
                                {
                                    op: "choice",
                                    kind: "search-library",
                                    player: "controller",
                                    zone: "library",
                                    filter: { subtype: "Goblin" },
                                    count: { min: 0, max: 1 },
                                    prompt: "Search your library for a Goblin card.",
                                    bind: "$found1",
                                },
                                {
                                    op: "reveal",
                                    player: "controller",
                                    cards: { ref: "$found1" },
                                },
                                {
                                    op: "moveZone",
                                    cards: { ref: "$found1" },
                                    player: "controller",
                                    from: "library",
                                    to: "hand",
                                },
                                {
                                    op: "libraryLook",
                                    action: "shuffle",
                                    player: "controller",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a + CR 110.5b + CR 701.24a — "Search your library for an Elf permanent card, put it onto the battlefield, then shuffle" (issue #4553): a runtime-sized `choice` and a library-to-battlefield `moveZone`, no reveal.
    {
        rule: "effect clause",
        card: {
            oracleId: "4f5921c1-b932-4d6b-bb8e-01992578abdc",
            name: "Skyshroud Poacher",
            manaCost: "{2}{G}{G}",
            typeLine: "Creature — Human Rebel",
            oracleText:
                "{3}, {T}: Search your library for an Elf permanent card, put it onto the battlefield, then shuffle.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Skyshroud Poacher",
            types: ["Creature"],
            subtypes: ["Human", "Rebel"],
            manaCost: { X: 2, G: 2 },
            power: 2,
            toughness: 2,
            oracleText:
                "{3}, {T}: Search your library for an Elf permanent card, put it onto the battlefield, then shuffle.",
            activatedAbilities: [
                {
                    id: "skyshroud-poacher-ability",
                    oracleText:
                        "{3}, {T}: Search your library for an Elf permanent card, put it onto the battlefield, then shuffle.",
                    cost: { mana: { X: 3 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: {
                                type: [
                                    "Artifact",
                                    "Battle",
                                    "Creature",
                                    "Enchantment",
                                    "Land",
                                    "Planeswalker",
                                ],
                                subtype: "Elf",
                            },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for an Elf permanent card.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found1" },
                            player: "controller",
                            from: "library",
                            to: "battlefield",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.6a + CR 113.7a (issue #4555) — "If a permanent's ability is
    // countered this way, destroy that permanent." Exhibits the form the
    // canned smoke scenario cannot build: the `destroy` reads the binding the
    // `counter` writes for the SOURCE of a countered ability (`bindSource`),
    // and the generator seeds no ability on the stack to counter. This fixture
    // is the evidence the grammar emits the pair the hand-written Teferi's
    // Response writes (sets/inv/blue.cards.ts — it round-trips, Guard C),
    // including the spell-or-ability target that makes the binding reachable.
    {
        rule: "counter",
        card: {
            oracleId: "b2faa8b6-e433-4171-9774-9170484530c4",
            name: "Teferi's Response",
            manaCost: "{1}{U}",
            typeLine: "Instant",
            oracleText:
                "Counter target spell or ability an opponent controls that targets a land you control. If a permanent's ability is countered this way, destroy that permanent.\nDraw two cards.",
            layout: "normal",
        },
        expected: {
            name: "Teferi's Response",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText:
                "Counter target spell or ability an opponent controls that targets a land you control. If a permanent's ability is countered this way, destroy that permanent.\nDraw two cards.",
            effects: [
                {
                    op: "counter",
                    target: { target: 0 },
                    bindSource: "$source1",
                },
                { op: "destroy", target: { ref: "$source1" } },
                { op: "draw", player: "controller", count: 2 },
            ],
            targetRequirement: {
                type: "spell",
                count: 1,
                controller: "opponent",
                spellStackKind: "any",
                spellTargetsPermanentFilter: {
                    types: "Land",
                    controller: "you",
                },
            },
        },
    },
    // CR 404.1 + CR 701.13a — "Exile target player's graveyard": the whole pile
    // of an announced player moves to exile. Exhibits the whole-zone `moveZone`
    // (`player`/`from`/`to`), a zone change the canned smoke scenario does not
    // model (issue #4556).
    {
        rule: "effect clause",
        card: {
            name: "Tormod's Crypt",
            manaCost: "{0}",
            typeLine: "Artifact",
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            oracleId: "1573f7f9-672c-421a-b1ac-3d0d8aea59ca",
            layout: "normal",
        },
        expected: {
            name: "Tormod's Crypt",
            types: ["Artifact"],
            manaCost: {},
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            activatedAbilities: [
                {
                    id: "tormod-s-crypt-ability",
                    oracleText:
                        "{T}, Sacrifice this artifact: Exile target player's graveyard.",
                    cost: { tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            from: "graveyard",
                            to: "exile",
                        },
                    ],
                    targetRequirement: { type: "player", count: 1 },
                },
            ],
        },
    },
    // CR 702.33e + CR 202.3 — a kicked spell re-bounds a conditional removal:
    // "Destroy target artifact if its mana value is 2 or less. If this spell was
    // kicked, destroy that artifact if its mana value is 5 or less instead."
    // The bound is an `if` on the target's mana value. Exhibits a predicate
    // reading a selected object's mana value, which the canned scenario cannot
    // size (issue #4556).
    {
        rule: "effect clause",
        card: {
            name: "Overload",
            manaCost: "{R}",
            typeLine: "Instant",
            oracleText:
                "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
            oracleId: "07159efc-c69f-4164-a8ca-9da641dbf702",
            layout: "normal",
        },
        expected: {
            name: "Overload",
            types: ["Instant"],
            manaCost: { R: 1 },
            oracleText:
                "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
            kickers: [
                { id: "kicker", description: "Kicker {2}", mana: { X: 2 } },
            ],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                left: { manaValue: { of: { target: 0 } } },
                                op: "le",
                                right: 5,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                    else: [
                        {
                            op: "if",
                            predicate: {
                                left: { manaValue: { of: { target: 0 } } },
                                op: "le",
                                right: 2,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Artifact", count: 1 },
        },
    },
    // CR 400.3 — "return a blue or black creature you control to its owner's
    // hand": the controller chooses one of their own permanents on resolution.
    // Exhibits `forEach` over the bound pick and its `moveZone` to hand (issue
    // #4556).
    {
        rule: "effect clause",
        card: {
            name: "Cavern Harpy",
            manaCost: "{U}{B}",
            typeLine: "Creature — Harpy Beast",
            oracleText:
                "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
            power: "2",
            toughness: "1",
            oracleId: "81c40bd8-b989-41e8-9527-eae8fb87311d",
            layout: "normal",
        },
        expected: {
            name: "Cavern Harpy",
            types: ["Creature"],
            subtypes: ["Harpy", "Beast"],
            manaCost: { U: 1, B: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "cavern-harpy-ability",
                    oracleText:
                        "Pay 1 life: Return this creature to its owner's hand.",
                    cost: { life: 1 },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "cavern-harpy-trigger",
                    oracleText:
                        "When this creature enters, return a blue or black creature you control to its owner's hand.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: "controller",
                            zone: "battlefield",
                            filter: { type: "Creature", color: ["U", "B"] },
                            count: 1,
                            prompt: "Return a blue or black creature you control to its owner's hand.",
                            bind: "$bounce1",
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$bounce1" },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$each" },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
]);
