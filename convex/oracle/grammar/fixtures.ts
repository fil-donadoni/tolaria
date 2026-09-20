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
]);
