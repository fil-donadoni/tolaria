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
    // the hand-written Mind Rot (sets/por/black.ts) writes it — the same
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
    // (Liliana of the Veil's -2, sets/isd/black.ts).
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
    // (sets/ody/black.ts) writes them, the card the round-trip also compares.
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
    // (sets/inv/multicolor.ts) writes them (issue #4125).
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
    // Counterspell writes (sets/lea/blue.ts — it round-trips, Guard C), for
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
    // control (the hand-written Resurrection, sets/lea/white.ts, writes the same
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
    // the colour pick the hand-written Rainbow Crow writes (sets/inv/blue.ts
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
    // "+2/+2", sets/bok/colorless.ts), for every Aura whose pump is a fixed
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
    // CR 120.3 — "<self> deals N damage to each creature and each player":
    // the fixed two-set damage recipient union lowers to a PAIR of `forEach`
    // sweeps (one over battlefield creatures, one over players), because
    // `dealDamage.to` names one recipient and the sentence names two disjoint
    // sets. Exhibits the "$each object ref" and "$each player ref" forms the
    // canned smoke scenario cannot build, so this fixture is the evidence the
    // pair is emitted the way the hand-written Pestilence writes it
    // (`sets/lea/black.ts`).
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
]);
