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
    // CR 603.6a + CR 305.6 — "At the beginning of each player's upkeep, if
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
    // CR 603.6a — "At the beginning of each player's upkeep, that player
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
]);
