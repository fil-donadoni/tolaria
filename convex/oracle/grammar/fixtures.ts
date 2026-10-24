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
    // CR 609.7a / 609.7b / 615.1a (issue #5601) — "The next time a
    // <qualifier> source of your choice would deal damage to you this turn,
    // prevent that damage". Exhibits the shield reading the `pick-source`
    // choice's binding: the canned smoke scenario cannot make the choice, so
    // these fixtures are the evidence that the script the grammar emits is the
    // one the hand-written catalogue writes (the Circle of Protection cycle also
    // round-trips, Guard C). The shield's `match` — the qualifier its CR 609.7b
    // recheck reads — is a literal of the form, so each printed qualifier has
    // its own fixture: one colour per colour, "black or red", "artifact",
    // "land", and none.
    {
        rule: "effect clause",
        card: {
            oracleId: "df2738fe-9cd1-4347-8808-105fcfde1190",
            name: "Circle of Protection: Red",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: Red",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-red-ability",
                    oracleText:
                        "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: "R" },
                            count: 1,
                            prompt: "Choose a red source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["R"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "5f46f86a-9779-4ed3-99cb-76a03d380598",
            name: "Circle of Protection: White",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: The next time a white source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: White",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}: The next time a white source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-white-ability",
                    oracleText:
                        "{1}: The next time a white source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: "W" },
                            count: 1,
                            prompt: "Choose a white source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["W"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "d7572f17-f85d-45c0-ac64-43aac760eafe",
            name: "Circle of Protection: Blue",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: The next time a blue source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: Blue",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}: The next time a blue source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-blue-ability",
                    oracleText:
                        "{1}: The next time a blue source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: "U" },
                            count: 1,
                            prompt: "Choose a blue source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["U"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "7a5a8414-4da4-4dd0-93ae-210d50f4d6f6",
            name: "Circle of Protection: Black",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: The next time a black source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: Black",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}: The next time a black source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-black-ability",
                    oracleText:
                        "{1}: The next time a black source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: "B" },
                            count: 1,
                            prompt: "Choose a black source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["B"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "41b0f347-1398-4778-bf3f-4007d8a77162",
            name: "Circle of Protection: Green",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}: The next time a green source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: Green",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}: The next time a green source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-green-ability",
                    oracleText:
                        "{1}: The next time a green source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: "G" },
                            count: 1,
                            prompt: "Choose a green source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["G"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "b03eb0c4-89a4-420d-8a23-1a868a07d9cf",
            name: "Greater Realm of Preservation",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{1}{W}: The next time a black or red source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Greater Realm of Preservation",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{1}{W}: The next time a black or red source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "greater-realm-of-preservation-ability",
                    oracleText:
                        "{1}{W}: The next time a black or red source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 1, W: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { color: ["B", "R"] },
                            count: 1,
                            prompt: "Choose a black or red source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { colors: ["B", "R"] },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "2e61e9c0-a2b9-4a24-8cb0-5160accce183",
            name: "Circle of Protection: Artifacts",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Circle of Protection: Artifacts",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "circle-of-protection-artifacts-ability",
                    oracleText:
                        "{2}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 2 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { type: "Artifact" },
                            count: 1,
                            prompt: "Choose an artifact source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { cardType: "Artifact" },
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "605dd1b5-8946-4bd0-b31b-e99bf63a1bc4",
            name: "Rune of Protection: Lands",
            manaCost: "{1}{W}",
            typeLine: "Enchantment",
            oracleText:
                "{W}: The next time a land source of your choice would deal damage to you this turn, prevent that damage.\nCycling {2} ({2}, Discard this card: Draw a card.)",
            layout: "normal",
        },
        expected: {
            name: "Rune of Protection: Lands",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "{W}: The next time a land source of your choice would deal damage to you this turn, prevent that damage.\nCycling {2} ({2}, Discard this card: Draw a card.)",
            activatedAbilities: [
                {
                    id: "rune-of-protection-lands-ability",
                    oracleText:
                        "{W}: The next time a land source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { W: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            filter: { type: "Land" },
                            count: 1,
                            prompt: "Choose a land source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                            match: { cardType: "Land" },
                        },
                    ],
                },
                {
                    id: "cycling",
                    oracleText:
                        "Cycling {2} ({2}, Discard this card: Draw a card.)",
                    cost: {
                        mana: { generic: 2 },
                        discardThis: true,
                        cyclingCost: true,
                    },
                    activateFromHand: true,
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "265204a9-0ce2-4a0a-a9ea-8537cd94b079",
            name: "Pentagram of the Ages",
            manaCost: "{4}",
            typeLine: "Artifact",
            oracleText:
                "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.",
            layout: "normal",
        },
        expected: {
            name: "Pentagram of the Ages",
            types: ["Artifact"],
            manaCost: { X: 4 },
            oracleText:
                "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.",
            activatedAbilities: [
                {
                    id: "pentagram-of-the-ages-ability",
                    oracleText:
                        "{4}, {T}: The next time a source of your choice would deal damage to you this turn, prevent that damage.",
                    cost: { mana: { X: 4 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "pick-source",
                            player: "controller",
                            zone: "battlefield-or-stack",
                            count: 1,
                            prompt: "Choose a source.",
                            bind: "$source1",
                        },
                        {
                            op: "preventDamage",
                            mode: "next-from-source",
                            source: { ref: "$source1" },
                            to: { player: "controller" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
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
    // CR 701.9b — "Draw three cards, then discard two cards": the CONTROLLER
    // picks (`choice` kind `choose-hand-card`), then a `discard` Op consumes
    // the picks binding. Exhibits the controller-side "discard consumes a
    // choice binding" form the canned smoke scenario cannot answer (Mind Rot's
    // fixture covers the announced-player side), so this fixture is the
    // evidence the controller-side pair is emitted as `choose-hand-card` +
    // `discard` ref, with the kicked branch reusing the Mind Rot shape.
    {
        rule: "effect clause",
        card: {
            oracleId: "f8d227b6-1627-4ea1-b815-887094497abf",
            name: "Probe",
            manaCost: "{2}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Kicker {1}{B} (You may pay an additional {1}{B} as you cast this spell.)\nDraw three cards, then discard two cards. If this spell was kicked, target player discards two cards.",
            layout: "normal",
        },
        expected: {
            name: "Probe",
            types: ["Sorcery"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Kicker {1}{B} (You may pay an additional {1}{B} as you cast this spell.)\nDraw three cards, then discard two cards. If this spell was kicked, target player discards two cards.",
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {1}{B}",
                    mana: { X: 1, B: 1 },
                },
            ],
            effects: [
                { op: "draw", player: "controller", count: 3 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discard1",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard1" },
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
                            op: "choice",
                            kind: "discard-hand",
                            player: { target: 0 },
                            zone: "hand",
                            count: 2,
                            prompt: "Discard two cards.",
                            bind: "$discard2",
                        },
                        {
                            op: "discard",
                            player: { target: 0 },
                            cards: { ref: "$discard2" },
                        },
                    ],
                },
            ],
            additionalTargetRequirements: [
                {
                    type: "player",
                    count: 1,
                    announcedOnlyIfKicked: true,
                },
            ],
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
    // CR 701.21a + CR 101.4 + CR 105.2b — "Each player sacrifices a
    // multicolored permanent of their choice.": the same simultaneous `forEach`
    // as Innocent Blood over a colour-COUNT filter (`colorCountAtLeast: 2`, not a
    // colour). The smoke form names the filter, so it is its own form.
    {
        rule: "effect clause",
        card: {
            oracleId: "bc9acc14-24e0-4c03-a09a-2afee351f2cc",
            name: "Renounce the Guilds",
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText:
                "Each player sacrifices a multicolored permanent of their choice.",
            layout: "normal",
        },
        expected: {
            name: "Renounce the Guilds",
            types: ["Instant"],
            manaCost: {
                X: 1,
                W: 1,
            },
            oracleText:
                "Each player sacrifices a multicolored permanent of their choice.",
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
                                colorCountAtLeast: 2,
                            },
                            count: 1,
                            prompt: "Sacrifice a multicolored permanent.",
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
    // CR 700.4 + CR 111.1 — "Create a 2/2 green Bear creature token for each
    // nontoken creature put into your graveyard from the battlefield this
    // turn": the count is the controller's per-turn tally, a runtime amount the
    // canned smoke scenario cannot size (no death precedes the resolution).
    {
        rule: "create token",
        card: {
            oracleId: "ec79255f-4b4d-4a0a-89d8-c59ba640275b",
            name: "Caller of the Claw",
            manaCost: "{2}{G}",
            typeLine: "Creature — Elf",
            oracleText:
                "Flash\nWhen this creature enters, create a 2/2 green Bear creature token for each nontoken creature put into your graveyard from the battlefield this turn.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Caller of the Claw",
            types: ["Creature"],
            subtypes: ["Elf"],
            manaCost: { X: 2, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Flash\nWhen this creature enters, create a 2/2 green Bear creature token for each nontoken creature put into your graveyard from the battlefield this turn.",
            staticAbilities: ["flash"],
            compiledTriggeredAbilities: [
                {
                    id: "caller-of-the-claw-trigger",
                    oracleText:
                        "When this creature enters, create a 2/2 green Bear creature token for each nontoken creature put into your graveyard from the battlefield this turn.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Bear",
                                types: ["Creature"],
                                subtypes: ["Bear"],
                                power: 2,
                                toughness: 2,
                                colors: ["G"],
                            },
                            controller: "controller",
                            count: {
                                nontokenCreaturesToGraveyardThisTurn: {
                                    of: "controller",
                                },
                            },
                        },
                    ],
                },
            ],
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
    // CR 205.3i / 305.6 + CR 305.7 (issue #5173) — "Choose a land type and a
    // basic land type. Each land of the first chosen type becomes the second
    // chosen type until end of turn." Two `chooseLandType` picks read back by
    // a `forEach` over the lands of the first and a `setSubtype` with
    // `family: "land"` writing the second: runtime bindings the canned smoke
    // scenario cannot supply. The mill and phase-out modes ride along
    // unchanged.
    {
        rule: "effect clause",
        card: {
            oracleId: "c56d2c5b-c3e3-4236-bc38-286e250aa4f7",
            name: "Vision Charm",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Choose one —\n• Target player mills four cards.\n• Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn.\n• Target artifact phases out.",
            layout: "normal",
        },
        expected: {
            name: "Vision Charm",
            types: ["Instant"],
            manaCost: { U: 1 },
            oracleText:
                "Choose one —\n• Target player mills four cards.\n• Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn.\n• Target artifact phases out.",
            modes: [
                {
                    id: "vision-charm-mode-1",
                    label: "Target player mills four cards",
                    oracleText: "Target player mills four cards.",
                    effects: [{ op: "mill", player: { target: 0 }, count: 4 }],
                    targetRequirement: { type: "player", count: 1 },
                },
                {
                    id: "vision-charm-mode-2",
                    label: "Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn",
                    oracleText:
                        "Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn.",
                    effects: [
                        {
                            op: "chooseLandType",
                            player: "controller",
                            prompt: "Choose a land type",
                            bind: "$firstChosenType",
                        },
                        {
                            op: "chooseLandType",
                            player: "controller",
                            prompt: "Choose a basic land type",
                            bind: "$secondChosenType",
                            basic: true,
                        },
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: {
                                    type: "Land",
                                    subtype: { ref: "$firstChosenType" },
                                },
                            },
                            effects: [
                                {
                                    op: "setSubtype",
                                    target: { ref: "$each" },
                                    subtypes: { ref: "$secondChosenType" },
                                    family: "land",
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "vision-charm-mode-3",
                    label: "Target artifact phases out",
                    oracleText: "Target artifact phases out.",
                    effects: [{ op: "phaseOut", target: { target: 0 } }],
                    targetRequirement: { type: "Artifact", count: 1 },
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
    // CR 601.2d / 603.7a — "Distribute three +1/+1 counters among one, two,
    // or three target creatures", then the delayed take-back of each counter
    // put on a creature this way at the next cleanup step. The smoke planner
    // can scenario-ize neither the announced division nor the delayed body
    // (a list-captured binding walked by `forEach`, a `counters` remove of
    // counters it never seeded), so this row is the evidence for every card
    // printing a +1/+1 division (Elven Rite, Wurmskin Forger, …) and for the
    // cleanup-step take-back. Resolution: `__tests__/distributedCounters.test.ts`.
    {
        rule: "distributed counters",
        card: {
            oracleId: "77a43c24-398f-42c6-a0d3-b28b33a0ce12",
            name: "Bounty of the Hunt",
            manaCost: "{3}{G}{G}",
            typeLine: "Instant",
            oracleText:
                "You may exile a green card from your hand rather than pay this spell's mana cost.\nDistribute three +1/+1 counters among one, two, or three target creatures. For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step.",
            layout: "normal",
        },
        expected: {
            name: "Bounty of the Hunt",
            types: ["Instant"],
            manaCost: { X: 3, G: 2 },
            oracleText:
                "You may exile a green card from your hand rather than pay this spell's mana cost.\nDistribute three +1/+1 counters among one, two, or three target creatures. For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step.",
            effects: [
                {
                    op: "distributeCountersAsChosen",
                    counter: "+1/+1",
                    total: 3,
                    bind: "$placed1",
                },
                {
                    op: "delayedTrigger",
                    timing: "next-cleanup-step",
                    oracleText:
                        "For each +1/+1 counter you put on a creature this way, remove a +1/+1 counter from that creature at the beginning of the next cleanup step.",
                    capture: {
                        $placed: { select: { set: "bound", ref: "$placed1" } },
                    },
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$placed" },
                            effects: [
                                {
                                    op: "counters",
                                    action: "remove",
                                    counter: "+1/+1",
                                    target: { ref: "$each" },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: { min: 1 },
                divideAsChosen: { total: 3, kind: "counters" },
            },
            alternativeCosts: [
                {
                    id: "pitch-exile-green",
                    description: "Exile a green card from your hand",
                    hand: {
                        action: "exile",
                        requirements: [{ filter: { color: "G" }, count: 1 }],
                    },
                },
            ],
        },
    },
    // The same family with −1/−1 counters and an END-step take-back, on a
    // dies trigger. A distinct form from the row above: the skeleton keeps
    // the counter kind and the timing (`opSkeleton`), so Bounty of the Hunt's
    // row does not clear it — and this one clears Splendid Agony's −1/−1
    // division.
    {
        rule: "distributed counters",
        card: {
            oracleId: "7807122e-917f-4a79-876e-d1c10f7a38ed",
            name: "Shambling Swarm",
            manaCost: "{1}{B}{B}{B}",
            typeLine: "Creature — Horror",
            oracleText:
                "When this creature dies, distribute three -1/-1 counters among one, two, or three target creatures. For each -1/-1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next end step.",
            power: "3",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Shambling Swarm",
            types: ["Creature"],
            subtypes: ["Horror"],
            manaCost: { X: 1, B: 3 },
            power: 3,
            toughness: 3,
            oracleText:
                "When this creature dies, distribute three -1/-1 counters among one, two, or three target creatures. For each -1/-1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next end step.",
            compiledTriggeredAbilities: [
                {
                    id: "shambling-swarm-trigger",
                    oracleText:
                        "When this creature dies, distribute three -1/-1 counters among one, two, or three target creatures. For each -1/-1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next end step.",
                    head: { kind: "died", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: { min: 1 },
                        divideAsChosen: { total: 3, kind: "counters" },
                    },
                    effects: [
                        {
                            op: "distributeCountersAsChosen",
                            counter: "-1/-1",
                            total: 3,
                            bind: "$placed1",
                        },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "For each -1/-1 counter you put on a creature this way, remove a -1/-1 counter from that creature at the beginning of the next end step.",
                            capture: {
                                $placed: {
                                    select: { set: "bound", ref: "$placed1" },
                                },
                            },
                            effects: [
                                {
                                    op: "forEach",
                                    select: { set: "bound", ref: "$placed" },
                                    effects: [
                                        {
                                            op: "counters",
                                            action: "remove",
                                            counter: "-1/-1",
                                            target: { ref: "$each" },
                                            count: 1,
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
    // CR 601.2c + CR 120.3 — "deals N damage to each of X targets": a sweep
    // over the announced set (`forEach { set: "targets" }`), which the canned
    // smoke scenario refuses (a runtime-selected set). The fixed amount and the
    // X amount are two forms: the gate keys a skip on the Op's skeleton.
    {
        rule: "effect clause",
        card: {
            oracleId: "0ba1837b-67a1-40d1-b617-8c94834d02ba",
            name: "Meteor Blast",
            manaCost: "{X}{R}{R}{R}",
            typeLine: "Sorcery",
            oracleText: "Meteor Blast deals 4 damage to each of X targets.",
            layout: "normal",
        },
        expected: {
            name: "Meteor Blast",
            types: ["Sorcery"],
            manaCost: { X: "X", R: 3 },
            oracleText: "Meteor Blast deals 4 damage to each of X targets.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        { op: "dealDamage", amount: 4, to: { ref: "$each" } },
                    ],
                },
            ],
            targetRequirement: { type: "any", count: "X" },
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "157813c8-af83-41b5-9ffb-4abd167c1bfc",
            name: "Firestorm",
            manaCost: "{R}",
            typeLine: "Instant",
            oracleText:
                "As an additional cost to cast this spell, discard X cards.\nFirestorm deals X damage to each of X targets.",
            layout: "normal",
        },
        expected: {
            name: "Firestorm",
            types: ["Instant"],
            additionalCosts: { discard: { count: "X" } },
            manaCost: { R: 1 },
            oracleText:
                "As an additional cost to cast this spell, discard X cards.\nFirestorm deals X damage to each of X targets.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { X: true },
                            to: { ref: "$each" },
                        },
                    ],
                },
            ],
            targetRequirement: { type: "any", count: "X" },
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
    // CR 701.24a + CR 404.1 — "When this card is put into your graveyard from
    // your library, shuffle your graveyard into your library": the whole
    // graveyard moves into the library and the library is shuffled. Exhibits the
    // whole-zone move at a milled-self head: the canned smoke scenario models
    // no graveyard-to-library move, so this fixture is the evidence the
    // `moveZone` + `libraryLook` pair the grammar emits is Feldon's Cane's
    // hand-written composition.
    {
        rule: "effect clause",
        card: {
            oracleId: "bd5478df-3854-404b-8634-9debcef69b99",
            name: "Gaea's Blessing",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText:
                "Target player shuffles up to three target cards from their graveyard into their library.\nDraw a card.\nWhen this card is put into your graveyard from your library, shuffle your graveyard into your library.",
            layout: "normal",
        },
        expected: {
            name: "Gaea's Blessing",
            types: ["Sorcery"],
            manaCost: { X: 1, G: 1 },
            oracleText:
                "Target player shuffles up to three target cards from their graveyard into their library.\nDraw a card.\nWhen this card is put into your graveyard from your library, shuffle your graveyard into your library.",
            compiledTriggeredAbilities: [
                {
                    id: "gaea-s-blessing-trigger",
                    oracleText:
                        "When this card is put into your graveyard from your library, shuffle your graveyard into your library.",
                    head: { kind: "library-to-graveyard" },
                    effects: [
                        {
                            op: "moveZone",
                            player: "controller",
                            from: "graveyard",
                            to: "library",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "graveyard",
                    count: { min: 0, max: 3 },
                    prompt: "Shuffle up to three target cards from that player's graveyard into their library.",
                    bind: "$reclaimed1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$reclaimed1" },
                    player: { target: 0 },
                    from: "graveyard",
                    to: "library",
                },
                { op: "libraryLook", action: "shuffle", player: { target: 0 } },
                { op: "draw", player: "controller", count: 1 },
            ],
            targetRequirement: { type: "player", count: 1 },
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
    // CR 701.23d (search) + CR 701.20a (reveal) + CR 701.24a (shuffle) —
    // "Search your library for three cards and reveal them. Target opponent
    // chooses one. Put that card into your hand and the rest into your
    // graveyard. Then shuffle.": a quantity search, the opponent's pick from
    // the revealed pile, the split, the shuffle (issue #5254). Exhibits the
    // tutor's card-dependent forms: the opponent's `choice` reads a binding
    // only the search writes, and both `moveZone`s change zones on objects
    // the generator does not model. Intuition is the one printing.
    {
        rule: "effect clause",
        card: {
            oracleId: "3c9faba7-f2d3-4978-be94-020dc8003dc0",
            name: "Intuition",
            manaCost: "{2}{U}",
            typeLine: "Instant",
            oracleText:
                "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Intuition",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: 3,
                    prompt: "Search your library for three cards.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$found1" },
                },
                {
                    op: "choice",
                    kind: "choose-library-card",
                    player: { target: 0 },
                    zoneOwnerId: "controller",
                    zone: "library",
                    candidates: [{ ref: "$found1" }],
                    count: 1,
                    prompt: "Choose one of the revealed cards. Its owner puts that card into their hand and the rest into their graveyard.",
                    bind: "$picked2",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked2" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
            ],
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
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
    // CR 615.1a — "Prevent all combat damage that would be dealt to and dealt
    // by this creature this turn": a two-way shield on the ability's own
    // source, exhibiting the "preventDamage acts on $source" card-dependent
    // form.
    {
        rule: "effect clause",
        card: {
            oracleId: "12a8c546-d0d1-4c3d-bfca-c1e59cef349a",
            name: "Moonlight Geist",
            manaCost: "{2}{W}",
            typeLine: "Creature — Spirit",
            oracleText:
                "Flying\n{3}{W}: Prevent all combat damage that would be dealt to and dealt by this creature this turn.",
            power: "2",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Moonlight Geist",
            types: ["Creature"],
            subtypes: ["Spirit"],
            manaCost: { X: 2, W: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Flying\n{3}{W}: Prevent all combat damage that would be dealt to and dealt by this creature this turn.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "moonlight-geist-ability",
                    oracleText:
                        "{3}{W}: Prevent all combat damage that would be dealt to and dealt by this creature this turn.",
                    cost: { mana: { X: 3, W: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "preventDamage",
                            mode: "combat-to-and-by",
                            target: { ref: "$source" },
                            duration: { phase: "end-of-turn" },
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
    // CR 118.1 + CR 608.2h + CR 202.3 — "the exiled card's mana value" where
    // the card is the one the ability's own "Exile the top card of your
    // library" cost exiled (Phyrexian Devourer): read off the cost snapshot as
    // the `sacrificed` value. The canned smoke scenario never pays a cost, so
    // no snapshot exists to read and the form would sit in quarantine without
    // evidence (issue #5327).
    {
        rule: "effect clause",
        card: {
            oracleId: "28b1ed69-784c-4642-86c7-104792d5afc2",
            name: "Phyrexian Devourer",
            manaCost: "{6}",
            typeLine: "Artifact Creature — Phyrexian Construct",
            oracleText:
                "When this creature's power is 7 or greater, sacrifice it.\nExile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Phyrexian Devourer",
            types: ["Artifact", "Creature"],
            subtypes: ["Phyrexian", "Construct"],
            manaCost: { X: 6 },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature's power is 7 or greater, sacrifice it.\nExile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.",
            activatedAbilities: [
                {
                    id: "phyrexian-devourer-ability",
                    oracleText:
                        "Exile the top card of your library: Put X +1/+1 counters on this creature, where X is the exiled card's mana value.",
                    cost: { exileTopOfLibrary: true },
                    useStack: true,
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: { sacrificed: { read: "manaValue" } },
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "phyrexian-devourer-trigger",
                    oracleText:
                        "When this creature's power is 7 or greater, sacrifice it.",
                    head: { kind: "power-reached", atLeast: 7 },
                    effects: [{ op: "sacrifice", target: { ref: "$source" } }],
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
    // CR 118.12 + CR 506.2 + CR 510.1c (issue #6205) — "you may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn": a fixed mana `mayPay` gating a destroy and the source's own assignment suppression, the `$source` subject the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            name: "Goblin Vandal",
            manaCost: "{R}",
            typeLine: "Creature — Goblin Rogue",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn.",
            power: "1",
            toughness: "1",
            oracleId: "50bebbb9-01b7-4eb6-8efd-307c9bcd2517",
            layout: "normal",
        },
        expected: {
            name: "Goblin Vandal",
            types: ["Creature"],
            subtypes: ["Goblin", "Rogue"],
            manaCost: { R: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn.",
            compiledTriggeredAbilities: [
                {
                    id: "goblin-vandal-trigger",
                    oracleText:
                        "Whenever this creature attacks and isn't blocked, you may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn.",
                    head: { kind: "attacks-unblocked" },
                    targetRequirement: {
                        type: "Artifact",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: { R: 1 },
                            prompt: "You may pay {R}. If you do, destroy target artifact defending player controls and this creature assigns no combat damage this turn",
                            bind: "$paid1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$paid1" },
                            then: [
                                { op: "destroy", target: { target: 0 } },
                                {
                                    op: "markAssignsNoCombatDamage",
                                    target: { ref: "$source" },
                                },
                            ],
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
    // CR 607.2a + CR 400.7 — the PRINTED linked pair, return to hand: the enters
    // trigger's exile instruction is stamped `linkToSource` by the card pass
    // (`linkExile.ts`) and the leaves trigger returns `exiledWithSource` to the
    // owner's hand. The canned smoke scenario cannot stage a hand exile and a
    // later departure, so this fixture is the evidence that the pair the grammar
    // emits is the one the hand-written catalogue writes (Tidehollow Sculler).
    {
        rule: "effect clause",
        card: {
            oracleId: "fb46b300-8a39-40d2-8bc7-31b90c822e22",
            name: "Mesmeric Fiend",
            manaCost: "{1}{B}",
            typeLine: "Creature — Nightmare Horror",
            oracleText:
                "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.\nWhen this creature leaves the battlefield, return the exiled card to its owner's hand.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Mesmeric Fiend",
            types: ["Creature"],
            subtypes: ["Nightmare", "Horror"],
            manaCost: { X: 1, B: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.\nWhen this creature leaves the battlefield, return the exiled card to its owner's hand.",
            compiledTriggeredAbilities: [
                {
                    id: "mesmeric-fiend-trigger",
                    oracleText:
                        "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "player",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        { op: "reveal", player: { target: 0 }, zone: "hand" },
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zoneOwnerId: { target: 0 },
                            zone: "hand",
                            filter: { excludeType: "Land" },
                            count: 1,
                            prompt: "Choose a nonland card from that player's hand.",
                            bind: "$picked1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$picked1" },
                            player: { target: 0 },
                            from: "hand",
                            to: "exile",
                            linkToSource: true,
                        },
                    ],
                },
                {
                    id: "mesmeric-fiend-trigger-2",
                    oracleText:
                        "When this creature leaves the battlefield, return the exiled card to its owner's hand.",
                    head: { kind: "left", scope: "self" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { exiledWithSource: true },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    },
    // CR 607.2a + CR 110.2a — the PRINTED linked pair, the whole pile back to
    // the battlefield: the activated `exile` is stamped `linkToSource` by the
    // card pass (`linkExile.ts`) and the leaves trigger returns every card
    // stamped with this source, each under its owner's control, as one event.
    // The canned smoke scenario cannot stage a linked exile pile and a later
    // departure, so this fixture is the evidence for the form (Parallax Tide
    // prints the same pair over lands).
    {
        rule: "effect clause",
        card: {
            oracleId: "0accfb04-bc8b-4cab-997a-2337ac42db8f",
            name: "Parallax Wave",
            manaCost: "{2}{W}{W}",
            typeLine: "Enchantment",
            oracleText:
                "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
            layout: "normal",
        },
        expected: {
            name: "Parallax Wave",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 2 },
            oracleText:
                "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
            staticAbilities: ["fading 5"],
            activatedAbilities: [
                {
                    id: "parallax-wave-ability",
                    oracleText:
                        "Remove a fade counter from this enchantment: Exile target creature.",
                    cost: { removeCounter: { type: "fade", count: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "exile",
                            target: { target: 0 },
                            linkToSource: true,
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "parallax-wave-trigger",
                    oracleText:
                        "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.",
                    head: { kind: "left", scope: "self" },
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "exiledWithSource" },
                            simultaneous: true,
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$each" },
                                    from: "exile",
                                    to: "battlefield",
                                },
                            ],
                        },
                    ],
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
    // CR 120.3 + CR 702.9a — "deals X damage to each creature without flying and each player": the creature half is a keyword-excluded sweep, the player half a sweep over players, each carrying the chosen-cost X. Exhibits the X amount, the `$each` object recipient and the `$each` player recipient the canned smoke scenario cannot build (issue #4557).
    {
        rule: "effect clause",
        card: {
            oracleId: "9a40614b-50a3-422c-849e-53c8b7d3d204",
            name: "Earthquake",
            manaCost: "{X}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Earthquake deals X damage to each creature without flying and each player.",
            layout: "normal",
        },
        expected: {
            name: "Earthquake",
            types: ["Sorcery"],
            manaCost: { X: "X", R: 1 },
            oracleText:
                "Earthquake deals X damage to each creature without flying and each player.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", excludeAbility: "flying" },
                    },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { X: true },
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
                            amount: { X: true },
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
        },
    },
    // CR 105.1 + CR 701.19c — "Destroy all green creatures. They can't be regenerated.": a colour-scoped sweep whose destroy carries `cantBeRegenerated` on every swept creature. Exhibits the `$each` destroy target with the no-regeneration flag (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "dd84d291-cb7a-4f44-81cd-9f1181bb5ae5",
            name: "Perish",
            manaCost: "{2}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Destroy all green creatures. They can't be regenerated.",
            layout: "normal",
        },
        expected: {
            name: "Perish",
            types: ["Sorcery"],
            manaCost: { X: 2, B: 1 },
            oracleText:
                "Destroy all green creatures. They can't be regenerated.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", color: "G" },
                    },
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$each" },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
        },
    },
    // CR 105.1 + CR 701.26a — "Tap all blue creatures": the colour-scoped tap sweep (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "b4541f38-23c1-4f51-a35b-0b222cdaed2c",
            name: "Riptide",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText: "Tap all blue creatures.",
            layout: "normal",
        },
        expected: {
            name: "Riptide",
            types: ["Instant"],
            manaCost: { U: 1 },
            oracleText: "Tap all blue creatures.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", color: "U" },
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
    },
    // CR 105.1 + CR 613.4c — "White creatures you control get +2/+2 until end of turn": a colour-scoped group pump over the controller's creatures (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "32d78ffd-5bed-45e8-be6a-420149a263bb",
            name: "Guardians' Pledge",
            manaCost: "{1}{W}{W}",
            typeLine: "Instant",
            oracleText:
                "White creatures you control get +2/+2 until end of turn.",
            layout: "normal",
        },
        expected: {
            name: "Guardians' Pledge",
            types: ["Instant"],
            manaCost: { X: 1, W: 2 },
            oracleText:
                "White creatures you control get +2/+2 until end of turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", color: "W" },
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
    },
    // CR 400.3 + CR 110.1 — "Return all permanents to their owners' hands": a bounce sweep, one `moveZone` to the hand per permanent. Exhibits the sweep `moveZone` of `$each` the canned smoke scenario cannot model (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "7cafc972-a6f5-4cac-a3d3-8a3ae36ffb1e",
            name: "Upheaval",
            manaCost: "{4}{U}{U}",
            typeLine: "Sorcery",
            oracleText: "Return all permanents to their owners' hands.",
            layout: "normal",
        },
        expected: {
            name: "Upheaval",
            types: ["Sorcery"],
            manaCost: { X: 4, U: 2 },
            oracleText: "Return all permanents to their owners' hands.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "permanents", zone: "battlefield" },
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
    },
    // CR 400.3 — "Return all artifacts target player owns to their hand": a bounce sweep scoped to an announced player's battlefield, one `moveZone` to the hand per artifact. Exhibits the sweep `moveZone` of `$each` under a target-player controller the canned smoke scenario cannot model (issue #5701).
    {
        rule: "effect clause",
        card: {
            oracleId: "ed1e5d24-c8a8-48fe-a88f-1003ad432477",
            name: "Hurkyl's Recall",
            manaCost: "{1}{U}",
            typeLine: "Instant",
            oracleText:
                "Return all artifacts target player owns to their hand.",
            layout: "normal",
        },
        expected: {
            name: "Hurkyl's Recall",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText:
                "Return all artifacts target player owns to their hand.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Artifact" },
                        controller: { target: 0 },
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "hand",
                        },
                    ],
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 202.3 + CR 122.1 — "Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact": an `if` over the iterated permanent's mana value against the source's live counter tally. Exhibits the mana-value-versus-counters comparison (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "ca1144c2-49a3-49b4-9085-3094141769ea",
            name: "Powder Keg",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText:
                "At the beginning of your upkeep, you may put a fuse counter on this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
            layout: "normal",
        },
        expected: {
            name: "Powder Keg",
            types: ["Artifact"],
            manaCost: { X: 2 },
            oracleText:
                "At the beginning of your upkeep, you may put a fuse counter on this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
            activatedAbilities: [
                {
                    id: "powder-keg-ability",
                    oracleText:
                        "{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
                    cost: { tap: true, sacrifice: true },
                    useStack: true,
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
                                        left: {
                                            manaValue: { of: { ref: "$each" } },
                                        },
                                        op: "eq",
                                        right: {
                                            counters: {
                                                of: { ref: "$source" },
                                                type: "fuse",
                                            },
                                        },
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
            compiledTriggeredAbilities: [
                {
                    id: "powder-keg-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you may put a fuse counter on this artifact.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Put a fuse counter on this artifact?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "counters",
                                    action: "add",
                                    counter: "fuse",
                                    target: { ref: "$source" },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 205.3 — "Destroy all non-Aura enchantments": the negative subtype on a sweep filter, `excludeSubtype` (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "87547bf0-02cf-4d83-9a1f-c82d2f1a22f1",
            name: "Tranquil Domain",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText: "Destroy all non-Aura enchantments.",
            layout: "normal",
        },
        expected: {
            name: "Tranquil Domain",
            types: ["Instant"],
            manaCost: { X: 1, G: 1 },
            oracleText: "Destroy all non-Aura enchantments.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Enchantment", excludeSubtype: "Aura" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    },
    // CR 205.3 + CR 613.4c — "Goblin creatures get +3/+0 until end of turn": a bare subtype group with no controller names every Goblin creature, whoever controls it (issue #4557).
    {
        rule: "mass subject",
        card: {
            oracleId: "696ee797-0c32-4bff-8c3d-02d05835b138",
            name: "Goblin Pyromancer",
            manaCost: "{3}{R}",
            typeLine: "Creature — Goblin Wizard",
            oracleText:
                "When this creature enters, Goblin creatures get +3/+0 until end of turn.\nAt the beginning of the end step, destroy all Goblins.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Goblin Pyromancer",
            types: ["Creature"],
            subtypes: ["Goblin", "Wizard"],
            manaCost: { X: 3, R: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "When this creature enters, Goblin creatures get +3/+0 until end of turn.\nAt the beginning of the end step, destroy all Goblins.",
            compiledTriggeredAbilities: [
                {
                    id: "goblin-pyromancer-trigger",
                    oracleText:
                        "When this creature enters, Goblin creatures get +3/+0 until end of turn.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: { type: "Creature", subtype: "Goblin" },
                            },
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$each" },
                                    power: 3,
                                    toughness: 0,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "goblin-pyromancer-trigger-2",
                    oracleText:
                        "At the beginning of the end step, destroy all Goblins.",
                    head: { kind: "phase", phase: "END_STEP", scope: "each" },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: { subtype: "Goblin" },
                            },
                            effects: [
                                { op: "destroy", target: { ref: "$each" } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.20a + CR 701.9b — "Target opponent reveals their hand. You choose
    // <a card> from it. That player discards that card.": the controller picks
    // from the revealed hand. Exhibits `discard` of a choice binding, the
    // pick the canned smoke scenario cannot make (issue #4566).
    {
        rule: "effect clause",
        card: {
            oracleId: "33d405ea-7a9a-4970-b70f-9c05d90dd6f0",
            name: "Duress",
            manaCost: "{B}",
            typeLine: "Sorcery",
            oracleText:
                "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.",
            layout: "normal",
        },
        expected: {
            name: "Duress",
            types: ["Sorcery"],
            manaCost: { B: 1 },
            oracleText:
                "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.",
            effects: [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeType: ["Land", "Creature"] },
                    count: 1,
                    prompt: "Choose a noncreature, nonland card from that player's hand.",
                    bind: "$picked1",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked1" },
                },
            ],
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
        },
    },
    // CR 701.20a reveal + CR 701.13a exile — "… You choose a nonland card from
    // it and exile that card.": the same pick, exiled. Exhibits `moveZone` of a choice
    // binding from a hand to exile, a zone change the canned smoke scenario
    // does not model (issue #4566).
    {
        rule: "effect clause",
        card: {
            oracleId: "28a972a6-cf67-4ee3-aa91-f7b2549f6c48",
            name: "Castigate",
            manaCost: "{W}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Target opponent reveals their hand. You choose a nonland card from it and exile that card.",
            layout: "normal",
        },
        expected: {
            name: "Castigate",
            types: ["Sorcery"],
            manaCost: { W: 1, B: 1 },
            oracleText:
                "Target opponent reveals their hand. You choose a nonland card from it and exile that card.",
            effects: [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeType: "Land" },
                    count: 1,
                    prompt: "Choose a nonland card from that player's hand.",
                    bind: "$picked1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked1" },
                    player: { target: 0 },
                    from: "hand",
                    to: "exile",
                },
            ],
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
        },
    },
    // CR 608.2c + CR 701.13a — "you may exile a card from your hand. If you
    // do, untap this land.": a `mayPay` hand leg gating the untap. Exhibits
    // `tapUntap` of `$source`, an object the canned smoke scenario does not
    // pick (issue #4566).
    {
        rule: "effect clause",
        card: {
            oracleId: "6bb00a28-8b5a-4049-93b7-3db02de88aeb",
            name: "Forsaken City",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "This land doesn't untap during your untap step.\nAt the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.\n{T}: Add one mana of any color.",
            layout: "normal",
        },
        expected: {
            name: "Forsaken City",
            types: ["Land"],
            oracleText:
                "This land doesn't untap during your untap step.\nAt the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.\n{T}: Add one mana of any color.",
            staticAbilities: ["does-not-untap"],
            activatedAbilities: [
                {
                    id: "forsaken-city-mana",
                    oracleText: "{T}: Add one mana of any color.",
                    cost: { tap: true },
                    useStack: false,
                    manaChoices: [
                        { W: 1 },
                        { U: 1 },
                        { B: 1 },
                        { R: 1 },
                        { G: 1 },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "forsaken-city-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: {
                                hand: {
                                    action: "exile",
                                    requirements: [{ filter: {}, count: 1 }],
                                },
                            },
                            prompt: "Exile a card from your hand?",
                            bind: "$paid1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$paid1" },
                            then: [
                                {
                                    op: "tapUntap",
                                    action: "untap",
                                    target: { ref: "$source" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 118.12a (issue #4548) — "sacrifice it unless you <payment>" as the
    // body of an enters trigger. Both cards exhibit the card-dependent forms
    // the canned smoke scenario cannot size: the `sacrifice` Op reading the
    // `if not paid` branch, and (Phyrexian Dreadnought) the `mayPay` cost leg
    // whose threshold is a runtime "count". Together they are the evidence
    // that the `mayPay` + `if not` pair the grammar emits is the one the
    // hand-written catalogue writes (Phyrexian Dreadnought round-trips).
    {
        rule: "effect clause",
        card: {
            name: "Rogue Elephant",
            manaCost: "{G}",
            typeLine: "Creature — Elephant",
            oracleText:
                "When this creature enters, sacrifice it unless you sacrifice a Forest.",
            power: "3",
            toughness: "3",
            oracleId: "bed7ac55-fe40-46d0-bc22-1c8d11f41459",
            layout: "normal",
        },
        expected: {
            name: "Rogue Elephant",
            types: ["Creature"],
            subtypes: ["Elephant"],
            manaCost: { G: 1 },
            power: 3,
            toughness: 3,
            oracleText:
                "When this creature enters, sacrifice it unless you sacrifice a Forest.",
            compiledTriggeredAbilities: [
                {
                    id: "rogue-elephant-trigger",
                    oracleText:
                        "When this creature enters, sacrifice it unless you sacrifice a Forest.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: {
                                permanent: {
                                    action: "sacrifice",
                                    filter: { subtypes: ["Forest"] },
                                    count: 1,
                                },
                            },
                            prompt: "Sacrifice a permanent, or sacrifice Rogue Elephant?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { not: { binding: "$may1" } },
                            then: [
                                { op: "sacrifice", target: { ref: "$source" } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 118.12a — the GRAVEYARD-leg payment: "return a basic land card from
    // your graveyard to your hand" lowers to `CostLegs.graveyard` (one card,
    // `{ type: "Land", supertype: "Basic" }`), the leg the engine pays by
    // moving the payer's chosen card graveyard → hand.
    {
        rule: "effect clause",
        card: {
            name: "Harvest Wurm",
            manaCost: "{1}{G}",
            typeLine: "Creature — Wurm",
            oracleText:
                "When this creature enters, sacrifice it unless you return a basic land card from your graveyard to your hand.",
            power: "3",
            toughness: "2",
            oracleId: "cd539212-ef7b-4f78-8d62-c42289aedc51",
            layout: "normal",
        },
        expected: {
            name: "Harvest Wurm",
            types: ["Creature"],
            subtypes: ["Wurm"],
            manaCost: { X: 1, G: 1 },
            power: 3,
            toughness: 2,
            oracleText:
                "When this creature enters, sacrifice it unless you return a basic land card from your graveyard to your hand.",
            compiledTriggeredAbilities: [
                {
                    id: "harvest-wurm-trigger",
                    oracleText:
                        "When this creature enters, sacrifice it unless you return a basic land card from your graveyard to your hand.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: {
                                graveyard: {
                                    action: "return",
                                    filter: {
                                        type: "Land",
                                        supertype: "Basic",
                                    },
                                    count: 1,
                                },
                            },
                            prompt: "Return a basic land card from your graveyard to your hand, or sacrifice Harvest Wurm?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { not: { binding: "$may1" } },
                            then: [
                                { op: "sacrifice", target: { ref: "$source" } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            name: "Phyrexian Dreadnought",
            manaCost: "{1}",
            typeLine: "Artifact Creature — Phyrexian Dreadnought",
            oracleText:
                "Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
            power: "12",
            toughness: "12",
            oracleId: "a7950edb-5670-46fd-a30e-0fe888a5a32b",
            layout: "normal",
        },
        expected: {
            name: "Phyrexian Dreadnought",
            types: ["Artifact", "Creature"],
            subtypes: ["Phyrexian", "Dreadnought"],
            manaCost: { X: 1 },
            power: 12,
            toughness: 12,
            oracleText:
                "Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "phyrexian-dreadnought-trigger",
                    oracleText:
                        "When this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: {
                                permanent: {
                                    action: "sacrifice",
                                    filter: { types: ["Creature"] },
                                    count: { minTotalPower: 12 },
                                },
                            },
                            prompt: "Sacrifice creatures with total power 12 or greater, or sacrifice Phyrexian Dreadnought?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { not: { binding: "$may1" } },
                            then: [
                                { op: "sacrifice", target: { ref: "$source" } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 601.2b + CR 107.3a — "As an additional cost to cast this spell, discard X cards": the caster announces X with no {X} pip in the printed cost, and the effects read it back as the chosen-cost X. Exhibits the X draw count and X damage amount the canned smoke scenario cannot build (issue #4563).
    {
        rule: "additional cost",
        card: {
            oracleId: "e12ed186-01c1-4da5-b90f-cfbb77c4e8d0",
            name: "Channeled Force",
            manaCost: "{2}{U}{R}",
            typeLine: "Instant",
            oracleText:
                "As an additional cost to cast this spell, discard X cards.\nTarget player draws X cards. Channeled Force deals X damage to up to one target creature or planeswalker.",
            layout: "normal",
        },
        expected: {
            name: "Channeled Force",
            types: ["Instant"],
            manaCost: { X: 2, U: 1, R: 1 },
            oracleText:
                "As an additional cost to cast this spell, discard X cards.\nTarget player draws X cards. Channeled Force deals X damage to up to one target creature or planeswalker.",
            effects: [
                { op: "draw", player: { target: 0 }, count: { X: true } },
                { op: "dealDamage", amount: { X: true }, to: { target: 1 } },
            ],
            targetRequirement: { type: "player", count: 1 },
            additionalTargetRequirements: [
                {
                    type: ["Creature", "Planeswalker"],
                    count: { min: 0, max: 1 },
                },
            ],
            additionalCosts: { discard: { count: "X" } },
        },
    },
    // CR 205.1a + CR 613.1d — "it becomes a 4/4 Ape creature." behind
    // "if this permanent is an enchantment": the source's card types and subtype
    // line are replaced for good. Exhibits `setCardTypes` / `setSubtype` /
    // `setBasePT` acting on `$source`, which the canned smoke scenario cannot
    // drive (the source is the permanent the trigger is printed on).
    {
        rule: "effect clause",
        card: {
            oracleId: "2315b044-bfd2-40dd-a73e-4cf064b36999",
            name: "Hidden Gibbons",
            manaCost: "{1}{G}{G}",
            typeLine: "Enchantment",
            oracleText:
                "When an opponent casts an instant spell, if this permanent is an enchantment, it becomes a 4/4 Ape creature.",
            layout: "normal",
        },
        expected: {
            name: "Hidden Gibbons",
            types: ["Enchantment"],
            manaCost: { X: 1, G: 2 },
            oracleText:
                "When an opponent casts an instant spell, if this permanent is an enchantment, it becomes a 4/4 Ape creature.",
            compiledTriggeredAbilities: [
                {
                    id: "hidden-gibbons-trigger",
                    oracleText:
                        "When an opponent casts an instant spell, if this permanent is an enchantment, it becomes a 4/4 Ape creature.",
                    head: {
                        kind: "spell-cast",
                        scope: "opponent",
                        filter: { types: ["Instant"] },
                    },
                    condition: { kind: "self-has-type", type: "Enchantment" },
                    effects: [
                        {
                            op: "setCardTypes",
                            target: { ref: "$source" },
                            types: ["Creature"],
                        },
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Ape"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 4,
                        },
                    ],
                },
            ],
        },
    },
    // CR 205.1b + CR 613.1d — "This land becomes a 3/3 green Ape creature with
    // trample until end of turn. It's still a land.": the source animates
    // itself. Exhibits the `animate` Op acting on `$source`, which the canned
    // smoke scenario cannot drive (the source must be a land with a payable
    // activation), so this fixture is the evidence the Op is emitted as the
    // hand-written manlands write it (sets/ulg/colorless.cards.ts, issue #4564).
    {
        rule: "effect clause",
        card: {
            oracleId: "b53f216d-1592-4eee-b204-502a805fbc8c",
            name: "Treetop Village",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "This land enters tapped.\n{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn. It's still a land. (It can deal excess combat damage to the player or planeswalker it's attacking.)",
            layout: "normal",
        },
        expected: {
            name: "Treetop Village",
            types: ["Land"],
            oracleText:
                "This land enters tapped.\n{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn. It's still a land. (It can deal excess combat damage to the player or planeswalker it's attacking.)",
            activatedAbilities: [
                {
                    id: "treetop-village-mana",
                    oracleText: "{T}: Add {G}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { G: 1 },
                },
                {
                    id: "treetop-village-ability-2",
                    oracleText:
                        "{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn. It's still a land.",
                    cost: { mana: { X: 1, G: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 3,
                            toughness: 3,
                            subtype: "Ape",
                            colors: ["G"],
                            grantedAbilities: ["trample"],
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    animatesSelf: true,
                },
            ],
            entersTapped: true,
        },
    },
    // CR 113.1a + CR 613.1f — "This land becomes a 1/1 black Skeleton creature
    // with "{B}: Regenerate this creature" until end of turn. It's still a
    // land.": the source animates itself and gains an activated ability for the
    // same duration. Exhibits `animate` on `$source` followed by `grantAbility`
    // naming the `grantTemplates[]` entry the quote lowers to; the canned smoke
    // scenario cannot drive either.
    {
        rule: "effect clause",
        card: {
            oracleId: "f3bf22cf-0a6f-4fb6-ba82-63ce290308d6",
            name: "Spawning Pool",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                'This land enters tapped.\n{T}: Add {B}.\n{1}{B}: This land becomes a 1/1 black Skeleton creature with "{B}: Regenerate this creature" until end of turn. It\'s still a land. (If it regenerates, the next time it would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)',
            layout: "normal",
        },
        expected: {
            name: "Spawning Pool",
            types: ["Land"],
            oracleText:
                'This land enters tapped.\n{T}: Add {B}.\n{1}{B}: This land becomes a 1/1 black Skeleton creature with "{B}: Regenerate this creature" until end of turn. It\'s still a land. (If it regenerates, the next time it would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)',
            activatedAbilities: [
                {
                    id: "spawning-pool-mana",
                    oracleText: "{T}: Add {B}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { B: 1 },
                },
                {
                    id: "spawning-pool-ability-2",
                    oracleText:
                        '{1}{B}: This land becomes a 1/1 black Skeleton creature with "{B}: Regenerate this creature" until end of turn. It\'s still a land.',
                    cost: { mana: { X: 1, B: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 1,
                            toughness: 1,
                            subtype: "Skeleton",
                            colors: ["B"],
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "grantAbility",
                            target: { ref: "$source" },
                            grantedActivatedId: "spawning-pool-grant",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    animatesSelf: true,
                },
            ],
            entersTapped: true,
            grantTemplates: [
                {
                    id: "spawning-pool-grant",
                    oracleText: "{B}: Regenerate this creature.",
                    cost: { mana: { B: 1 } },
                    useStack: true,
                    effects: [{ op: "regenerate", target: { ref: "$source" } }],
                },
            ],
        },
    },
    // The same self animation with another subtype, colour and keyword: the
    // smoke form keeps those literals, so each distinct clause needs its own
    // evidence (issue #4564).
    {
        rule: "effect clause",
        card: {
            name: "Faerie Conclave",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "This land enters tapped.\n{T}: Add {U}.\n{1}{U}: This land becomes a 2/1 blue Faerie creature with flying until end of turn. It's still a land.",
            oracleId: "0c25f6b1-8fb3-4406-9605-0282d2dbbcec",
            layout: "normal",
        },
        expected: {
            name: "Faerie Conclave",
            types: ["Land"],
            oracleText:
                "This land enters tapped.\n{T}: Add {U}.\n{1}{U}: This land becomes a 2/1 blue Faerie creature with flying until end of turn. It's still a land.",
            activatedAbilities: [
                {
                    id: "faerie-conclave-mana",
                    oracleText: "{T}: Add {U}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { U: 1 },
                },
                {
                    id: "faerie-conclave-ability-2",
                    oracleText:
                        "{1}{U}: This land becomes a 2/1 blue Faerie creature with flying until end of turn. It's still a land.",
                    cost: { mana: { X: 1, U: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$source" },
                            power: 2,
                            toughness: 1,
                            subtype: "Faerie",
                            colors: ["U"],
                            grantedAbilities: ["flying"],
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    animatesSelf: true,
                },
            ],
            entersTapped: true,
        },
    },
    // The same self animation with an added Artifact type and no colour or
    // keyword (Mishra's Foundry prints the same clause; issue #4564).
    {
        rule: "effect clause",
        card: {
            name: "Mishra's Factory",
            manaCost: "",
            typeLine: "Land",
            oracleText:
                "{T}: Add {C}.\n{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.\n{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
            oracleId: "5963e0ef-e0bc-4611-ad4f-813a4c0eacfb",
            layout: "normal",
        },
        expected: {
            name: "Mishra's Factory",
            types: ["Land"],
            oracleText:
                "{T}: Add {C}.\n{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.\n{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
            activatedAbilities: [
                {
                    id: "mishra-s-factory-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "mishra-s-factory-ability-2",
                    oracleText:
                        "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.",
                    cost: { mana: { X: 1 } },
                    useStack: true,
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
                    animatesSelf: true,
                },
                {
                    id: "mishra-s-factory-ability-3",
                    oracleText:
                        "{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        subtypeFilter: ["Assembly-Worker"],
                    },
                },
            ],
        },
    },
    // CR 404.1 + CR 701.24a — "Target player shuffles up to two target cards
    // from their graveyard into their library": the controller picks up to N
    // of that player's graveyard cards (`choice` kind `choose-graveyard-card`,
    // `count` a min/max range), they move into that player's library, and the
    // library is shuffled. Exhibits the runtime-sized `choice` count and the
    // graveyard `moveZone` the canned smoke scenario cannot model, so this
    // fixture is the evidence the trio is emitted as the hand-written Krosan
    // Reclamation (sets/jud/green.cards.ts) writes it, modulo the binding name.
    {
        rule: "effect clause",
        card: {
            oracleId: "e69252a6-8c27-4af9-8cbe-11eb416a6a46",
            name: "Krosan Reclamation",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText:
                "Target player shuffles up to two target cards from their graveyard into their library.\nFlashback {1}{G} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
            layout: "normal",
        },
        expected: {
            name: "Krosan Reclamation",
            types: ["Instant"],
            manaCost: { X: 1, G: 1 },
            oracleText:
                "Target player shuffles up to two target cards from their graveyard into their library.\nFlashback {1}{G} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "graveyard",
                    count: { min: 0, max: 2 },
                    prompt: "Shuffle up to two target cards from that player's graveyard into their library.",
                    bind: "$reclaimed1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$reclaimed1" },
                    player: { target: 0 },
                    from: "graveyard",
                    to: "library",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { target: 0 },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
            flashback: { X: 1, G: 1 },
        },
    },
    // CR 400.3 — "Put target creature you control on top of its
    // owner's library": exhibits `moveZone` of a live permanent to a library,
    // a zone change the canned smoke scenario does not model (issue #5406).
    {
        rule: "effect clause",
        card: {
            oracleId: "6e93cb9a-44c8-49fb-b6a7-bfdf7bd725fe",
            name: "Civic Guildmage",
            manaCost: "{W}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "{G}, {T}: Target creature gets +0/+1 until end of turn.\n{U}, {T}: Put target creature you control on top of its owner's library.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Civic Guildmage",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: { W: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "{G}, {T}: Target creature gets +0/+1 until end of turn.\n{U}, {T}: Put target creature you control on top of its owner's library.",
            activatedAbilities: [
                {
                    id: "civic-guildmage-ability",
                    oracleText:
                        "{G}, {T}: Target creature gets +0/+1 until end of turn.",
                    cost: { mana: { G: 1 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: 0,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
                {
                    id: "civic-guildmage-ability-2",
                    oracleText:
                        "{U}, {T}: Put target creature you control on top of its owner's library.",
                    cost: { mana: { U: 1 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { target: 0 },
                            to: "library",
                            position: 1,
                        },
                    ],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                    },
                },
            ],
        },
    },
    // CR 509.1c — "Target creature blocks this creature this turn if able":
    // exhibits `restrictCombat` `must-block` naming the ability's own source as
    // the attacker, a turn-scoped requirement that only manifests at a later
    // declare-blockers step (issue #3713).
    {
        rule: "effect clause",
        card: {
            oracleId: "aaaaf370-6486-4e17-9a93-92e05ebcf29f",
            name: "Rampant Elephant",
            manaCost: "{3}{W}",
            typeLine: "Creature — Elephant",
            oracleText:
                "{G}: Target creature blocks this creature this turn if able.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Rampant Elephant",
            types: ["Creature"],
            subtypes: ["Elephant"],
            manaCost: { X: 3, W: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "{G}: Target creature blocks this creature this turn if able.",
            activatedAbilities: [
                {
                    id: "rampant-elephant-ability",
                    oracleText:
                        "{G}: Target creature blocks this creature this turn if able.",
                    cost: { mana: { G: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "restrictCombat",
                            restriction: "must-block",
                            target: { target: 0 },
                            attacker: { ref: "$source" },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        },
    },
    // CR 110.2a + CR 400.7 — "Put target creature card from a graveyard onto the battlefield under your control": a graveyard-slot `moveZone` to the battlefield that names its new controller (`controller: "controller"`) over ANY graveyard, a different skeleton from Zombify's (issue #4568).
    {
        rule: "effect clause",
        card: {
            name: "Reanimate",
            manaCost: "{B}",
            typeLine: "Sorcery",
            oracleText:
                "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
            oracleId: "a044474a-cd72-4e9d-bd8d-a08f2de9cdc0",
            layout: "normal",
        },
        expected: {
            name: "Reanimate",
            types: ["Sorcery"],
            manaCost: { B: 1 },
            oracleText:
                "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                    controller: "controller",
                    bind: "$that1",
                },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
        },
    },
    // CR 400.7 — "Return all enchantment cards from your graveyard to the battlefield": a simultaneous `forEach` over the controller's graveyard cards, each `moveZone`d to the battlefield (issue #4568).
    {
        rule: "effect clause",
        card: {
            name: "Replenish",
            manaCost: "{3}{W}",
            typeLine: "Sorcery",
            oracleText:
                "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
            oracleId: "523ae937-5535-490d-96ea-07f331b5e5ad",
            layout: "normal",
        },
        expected: {
            name: "Replenish",
            types: ["Sorcery"],
            manaCost: { X: 3, W: 1 },
            oracleText:
                "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: "controller",
                        filter: { type: "Enchantment" },
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "battlefield",
                        },
                    ],
                },
            ],
        },
    },
    // CR 404.2 — "Exile the bottom card of target player's graveyard": a `moveZone` of the positional graveyard selector, the player an announced slot (issue #4568).
    {
        rule: "effect clause",
        card: {
            name: "Phyrexian Furnace",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "{T}: Exile the bottom card of target player's graveyard.\n{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
            oracleId: "4aafb7e7-b9fc-44ae-9c54-da11fd9dcc17",
            layout: "normal",
        },
        expected: {
            name: "Phyrexian Furnace",
            types: ["Artifact"],
            manaCost: { X: 1 },
            oracleText:
                "{T}: Exile the bottom card of target player's graveyard.\n{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
            activatedAbilities: [
                {
                    id: "phyrexian-furnace-ability",
                    oracleText:
                        "{T}: Exile the bottom card of target player's graveyard.",
                    cost: { tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: {
                                zone: "graveyard",
                                position: "bottom",
                                player: { target: 0 },
                            },
                            to: "exile",
                        },
                    ],
                    targetRequirement: { type: "player", count: 1 },
                },
                {
                    id: "phyrexian-furnace-ability-2",
                    oracleText:
                        "{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
                    cost: { mana: { X: 1 }, sacrifice: true },
                    useStack: true,
                    effects: [
                        { op: "moveZone", target: { target: 0 }, to: "exile" },
                        { op: "draw", player: "controller", count: 1 },
                    ],
                    targetRequirement: {
                        type: "card",
                        count: 1,
                        zone: "graveyard",
                        controller: "any",
                    },
                },
            ],
        },
    },
    // CR 101.4 + CR 400.7 — "Each player puts a creature card from their graveyard onto the battlefield": a `forEach` over the players, each `choice` of a graveyard card then `moveZone` of the pick (issue #4568).
    {
        rule: "effect clause",
        card: {
            name: "Exhume",
            manaCost: "{1}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Each player puts a creature card from their graveyard onto the battlefield.",
            oracleId: "fbe61f74-1b3c-4e12-8758-7029872c9ff1",
            layout: "normal",
        },
        expected: {
            name: "Exhume",
            types: ["Sorcery"],
            manaCost: { X: 1, B: 1 },
            oracleText:
                "Each player puts a creature card from their graveyard onto the battlefield.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-graveyard-card",
                            player: { ref: "$each" },
                            zone: "graveyard",
                            filter: { type: "Creature" },
                            count: 1,
                            prompt: "Exhume: put a creature card from your graveyard onto the battlefield.",
                            bind: "$picked",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$picked" },
                            player: { ref: "$each" },
                            from: "graveyard",
                            to: "battlefield",
                        },
                    ],
                },
            ],
        },
    },
    // CR 101.4 + CR 400.7 — "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield": the same `forEach` over the players on the HAND, with a 0..1 pick (issue #4568).
    {
        rule: "effect clause",
        card: {
            name: "Show and Tell",
            manaCost: "{2}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
            oracleId: "b83a3ba0-249e-4c39-bbf0-cb005413f7d2",
            layout: "normal",
        },
        expected: {
            name: "Show and Tell",
            types: ["Sorcery"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
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
                                type: [
                                    "Artifact",
                                    "Creature",
                                    "Enchantment",
                                    "Land",
                                ],
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
        },
    },
    // CR 400.7 + CR 205.3 — "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield": the controller's own 0..1 hand pick filtered by creature type minus instants and sorceries, then the `moveZone` of the pick (issue #5203).
    {
        rule: "effect clause",
        card: {
            name: "Goblin Lackey",
            manaCost: "{R}",
            typeLine: "Creature — Goblin",
            oracleText:
                "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.",
            power: "1",
            toughness: "1",
            oracleId: "213fbbdd-f1bc-4bba-9124-7b26e9a706c8",
            layout: "normal",
        },
        expected: {
            name: "Goblin Lackey",
            types: ["Creature"],
            subtypes: ["Goblin"],
            manaCost: { R: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.",
            compiledTriggeredAbilities: [
                {
                    id: "goblin-lackey-trigger",
                    oracleText:
                        "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "player",
                    },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zone: "hand",
                            filter: {
                                subtype: "Goblin",
                                excludeType: ["Instant", "Sorcery"],
                            },
                            count: { min: 0, max: 1 },
                            prompt: "You may put a Goblin permanent card from your hand onto the battlefield.",
                            bind: "$picked",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$picked" },
                            player: "controller",
                            from: "hand",
                            to: "battlefield",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.21a + CR 120.3 — "Whenever this creature is dealt damage, sacrifice that many permanents": the controller's own edict sized by the damage the head carried, `choice` count `{ ref: "$event.amount" }` (a computed exact count, issue #5559) then the `sacrifice` of the picks (issue #5203).
    {
        rule: "effect clause",
        card: {
            name: "Phyrexian Negator",
            manaCost: "{2}{B}",
            typeLine: "Creature — Phyrexian Horror",
            oracleText:
                "Whenever this creature is dealt damage, sacrifice that many permanents.",
            power: "5",
            toughness: "5",
            oracleId: "f22fcd17-bc24-41df-81ce-6d11208861b9",
            layout: "normal",
        },
        expected: {
            name: "Phyrexian Negator",
            types: ["Creature"],
            subtypes: ["Phyrexian", "Horror"],
            manaCost: { X: 2, B: 1 },
            power: 5,
            toughness: 5,
            oracleText:
                "Whenever this creature is dealt damage, sacrifice that many permanents.",
            compiledTriggeredAbilities: [
                {
                    id: "phyrexian-negator-trigger",
                    oracleText:
                        "Whenever this creature is dealt damage, sacrifice that many permanents.",
                    head: { kind: "damage-taken", scope: "self" },
                    effects: [
                        {
                            op: "choice",
                            kind: "sacrifice-permanents",
                            player: "controller",
                            zone: "battlefield",
                            filter: {},
                            count: { ref: "$event.amount" },
                            prompt: "Sacrifice that many permanents.",
                            bind: "$sacrifice1",
                        },
                        {
                            op: "sacrifice",
                            permanents: { ref: "$sacrifice1" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 702.33e + CR 702.33f + CR 603.4 — "When this creature enters, if it was kicked with its {R} kicker, …": a check-time gate on ONE named kicker plus the resolution-time `additionalCostPaid` branch. Exhibits a kicker-payment amount the canned smoke scenario casts unkicked (issue #4571).
    {
        rule: "kicked trigger condition",
        card: {
            name: "Thornscape Battlemage",
            manaCost: "{2}{G}",
            typeLine: "Creature — Elf Wizard",
            oracleText:
                "Kicker {R} and/or {W} (You may pay an additional {R} and/or {W} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.\nWhen this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
            power: "2",
            toughness: "2",
            oracleId: "8d4d6806-cb01-49e3-91cc-fb0e7f7a8684",
            layout: "normal",
        },
        expected: {
            name: "Thornscape Battlemage",
            types: ["Creature"],
            subtypes: ["Elf", "Wizard"],
            manaCost: { X: 2, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {R} and/or {W} (You may pay an additional {R} and/or {W} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.\nWhen this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
            compiledTriggeredAbilities: [
                {
                    id: "thornscape-battlemage-trigger",
                    oracleText:
                        "When this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-r" },
                    targetRequirement: { type: "any", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-r" },
                                op: "ge",
                                right: 1,
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
                },
                {
                    id: "thornscape-battlemage-trigger-2",
                    oracleText:
                        "When this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-w" },
                    targetRequirement: { type: "Artifact", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-w" },
                                op: "ge",
                                right: 1,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
            kickers: [
                { id: "kicker-r", description: "Kicker {R}", mana: { R: 1 } },
                { id: "kicker-w", description: "Kicker {W}", mana: { W: 1 } },
            ],
        },
    },
    // CR 701.26b + CR 109.2 — "untap up to seven lands": a `choice` over every battlefield with a ranged runtime pick, then a `forEach` over the picks. Exhibits a runtime `count` and a runtime-selected set the canned generator does not size (issue #4571).
    {
        rule: "effect clause",
        card: {
            name: "Palinchron",
            manaCost: "{5}{U}{U}",
            typeLine: "Creature — Illusion",
            oracleText:
                "Flying\nWhen this creature enters, untap up to seven lands.\n{2}{U}{U}: Return this creature to its owner's hand.",
            power: "4",
            toughness: "5",
            oracleId: "0023888e-7bec-43e0-8dee-d1a4eb94b372",
            layout: "normal",
        },
        expected: {
            name: "Palinchron",
            types: ["Creature"],
            subtypes: ["Illusion"],
            manaCost: { X: 5, U: 2 },
            power: 4,
            toughness: 5,
            oracleText:
                "Flying\nWhen this creature enters, untap up to seven lands.\n{2}{U}{U}: Return this creature to its owner's hand.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "palinchron-ability",
                    oracleText:
                        "{2}{U}{U}: Return this creature to its owner's hand.",
                    cost: { mana: { X: 2, U: 2 } },
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
                    id: "palinchron-trigger",
                    oracleText:
                        "When this creature enters, untap up to seven lands.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: "controller",
                            zone: "battlefield",
                            allControllers: true,
                            filter: { type: "Land" },
                            count: { min: 0, max: 7 },
                            prompt: "Untap up to seven lands.",
                            bind: "$untapped1",
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$untapped1" },
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
    // CR 107.1b + CR 107.3 — "you gain X life, where X is the number of cards in your hand minus 4": a `difference` of a hand count and a constant, an arithmetic combination the canned predictor does not size (issue #4571).
    {
        rule: "effect clause",
        card: {
            name: "Ivory Tower",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            oracleId: "d416a4ed-9f16-4a8b-8aee-03c630e1eb6c",
            layout: "normal",
        },
        expected: {
            name: "Ivory Tower",
            types: ["Artifact"],
            manaCost: { X: 1 },
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            compiledTriggeredAbilities: [
                {
                    id: "ivory-tower-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                difference: {
                                    from: {
                                        count: {
                                            zone: "hand",
                                            controller: "controller",
                                        },
                                    },
                                    minus: 4,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // CR 508.1 + CR 613.4c — "it gets +2/+0 until end of turn for each other attacking Goblin": a `pump` whose power is a scaled `count` of attacking creatures excluding the source, an amount the canned generator does not model (issue #4571).
    {
        rule: "effect clause",
        card: {
            name: "Goblin Piledriver",
            manaCost: "{1}{R}",
            typeLine: "Creature — Goblin Warrior",
            oracleText:
                "Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)\nWhenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
            power: "1",
            toughness: "2",
            oracleId: "4d74d12b-1ffb-482f-8bac-635a8d4d32e9",
            layout: "normal",
        },
        expected: {
            name: "Goblin Piledriver",
            types: ["Creature"],
            subtypes: ["Goblin", "Warrior"],
            manaCost: { X: 1, R: 1 },
            power: 1,
            toughness: 2,
            oracleText:
                "Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)\nWhenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
            staticAbilities: ["protection from blue"],
            compiledTriggeredAbilities: [
                {
                    id: "goblin-piledriver-trigger",
                    oracleText:
                        "Whenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
                    head: { kind: "attacks" },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: {
                                count: {
                                    zone: "battlefield",
                                    acrossAllPlayers: true,
                                    filter: {
                                        type: "Creature",
                                        subtype: "Goblin",
                                        isAttacking: true,
                                        excludeSource: true,
                                    },
                                    times: 2,
                                },
                            },
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 702.33f — the {G} and {U} kicker ids of the same per-kicker gate (a smoke form is keyed by the kicker id it reads), so the Battlemage cycle's other kickers clear too (issue #4571).
    {
        rule: "kicked trigger condition",
        card: {
            name: "Sunscape Battlemage",
            manaCost: "{2}{W}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "Kicker {1}{G} and/or {2}{U} (You may pay an additional {1}{G} and/or {2}{U} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.\nWhen this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
            power: "2",
            toughness: "2",
            oracleId: "c8fd2232-e499-4889-a2ca-e486ea87d02b",
            layout: "normal",
        },
        expected: {
            name: "Sunscape Battlemage",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: { X: 2, W: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {1}{G} and/or {2}{U} (You may pay an additional {1}{G} and/or {2}{U} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.\nWhen this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
            compiledTriggeredAbilities: [
                {
                    id: "sunscape-battlemage-trigger",
                    oracleText:
                        "When this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-g" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        requireAbility: "flying",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-g" },
                                op: "ge",
                                right: 1,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
                {
                    id: "sunscape-battlemage-trigger-2",
                    oracleText:
                        "When this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-u" },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-u" },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                { op: "draw", player: "controller", count: 2 },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker-g",
                    description: "Kicker {1}{G}",
                    mana: { X: 1, G: 1 },
                },
                {
                    id: "kicker-u",
                    description: "Kicker {2}{U}",
                    mana: { X: 2, U: 1 },
                },
            ],
        },
    },
    // CR 702.33f — the {B} and {G} kicker ids of the per-kicker gate (issue #4571).
    {
        rule: "kicked trigger condition",
        card: {
            name: "Thunderscape Battlemage",
            manaCost: "{2}{R}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "Kicker {1}{B} and/or {G} (You may pay an additional {1}{B} and/or {G} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{B} kicker, target player discards two cards.\nWhen this creature enters, if it was kicked with its {G} kicker, destroy target enchantment.",
            power: "2",
            toughness: "2",
            oracleId: "9aa66e7d-d5e3-4c48-9c68-b61ff2af0b1a",
            layout: "normal",
        },
        expected: {
            name: "Thunderscape Battlemage",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: { X: 2, R: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {1}{B} and/or {G} (You may pay an additional {1}{B} and/or {G} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{B} kicker, target player discards two cards.\nWhen this creature enters, if it was kicked with its {G} kicker, destroy target enchantment.",
            compiledTriggeredAbilities: [
                {
                    id: "thunderscape-battlemage-trigger",
                    oracleText:
                        "When this creature enters, if it was kicked with its {1}{B} kicker, target player discards two cards.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-b" },
                    targetRequirement: { type: "player", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-b" },
                                op: "ge",
                                right: 1,
                            },
                            then: [
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
                        },
                    ],
                },
                {
                    id: "thunderscape-battlemage-trigger-2",
                    oracleText:
                        "When this creature enters, if it was kicked with its {G} kicker, destroy target enchantment.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "kicker-paid", kickerId: "kicker-g" },
                    targetRequirement: { type: "Enchantment", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { additionalCostPaid: "kicker-g" },
                                op: "ge",
                                right: 1,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker-b",
                    description: "Kicker {1}{B}",
                    mana: { X: 1, B: 1 },
                },
                { id: "kicker-g", description: "Kicker {G}", mana: { G: 1 } },
            ],
        },
    },
    // CR 508.1 + CR 613.4c — "it gets +1/+1 until end of turn for each other attacking Kavu": the same scaled-count pump on BOTH stats (the smoke form differs from the +2/+0 power-only one), clearing Kavu Mauler (issue #4571).
    {
        rule: "effect clause",
        card: {
            name: "Kavu Mauler",
            manaCost: "{4}{G}{G}",
            typeLine: "Creature — Kavu",
            oracleText:
                "Trample\nWhenever this creature attacks, it gets +1/+1 until end of turn for each other attacking Kavu.",
            power: "4",
            toughness: "4",
            oracleId: "6ffbcaba-5437-4fb6-a2d6-e94b1e6dc1d2",
            layout: "normal",
        },
        expected: {
            name: "Kavu Mauler",
            types: ["Creature"],
            subtypes: ["Kavu"],
            manaCost: { X: 4, G: 2 },
            power: 4,
            toughness: 4,
            oracleText:
                "Trample\nWhenever this creature attacks, it gets +1/+1 until end of turn for each other attacking Kavu.",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "kavu-mauler-trigger",
                    oracleText:
                        "Whenever this creature attacks, it gets +1/+1 until end of turn for each other attacking Kavu.",
                    head: { kind: "attacks" },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: {
                                count: {
                                    zone: "battlefield",
                                    acrossAllPlayers: true,
                                    filter: {
                                        type: "Creature",
                                        subtype: "Kavu",
                                        isAttacking: true,
                                        excludeSource: true,
                                    },
                                },
                            },
                            toughness: {
                                count: {
                                    zone: "battlefield",
                                    acrossAllPlayers: true,
                                    filter: {
                                        type: "Creature",
                                        subtype: "Kavu",
                                        isAttacking: true,
                                        excludeSource: true,
                                    },
                                },
                            },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    },
    // CR 608.2h + CR 119.3 — "Exile target creature. Its controller gains life
    // equal to its power": the recipient is the controller read off the
    // snapshot the exile took, a player parameter that is a `ref` the canned
    // smoke scenario cannot size (issue #4573).
    {
        rule: "effect clause",
        card: {
            oracleId: "b1544f21-7e98-461b-aed5-e748b0168c52",
            name: "Swords to Plowshares",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText:
                "Exile target creature. Its controller gains life equal to its power.",
            layout: "normal",
        },
        expected: {
            name: "Swords to Plowshares",
            types: ["Instant"],
            manaCost: { W: 1 },
            oracleText:
                "Exile target creature. Its controller gains life equal to its power.",
            effects: [
                { op: "exile", target: { target: 0 }, bind: "$that1" },
                {
                    op: "gainLife",
                    player: { ref: "$that1.controller" },
                    amount: { ref: "$that1.power" },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 201.2 + CR 404.1 — "Draw a card, then draw cards equal to the number
    // of cards named {self} in all graveyards": a count over every player's
    // graveyard filtered by an exact name, neither of which the canned smoke
    // scenario can synthesise (issue #4573).
    {
        rule: "effect clause",
        card: {
            oracleId: "1ca25379-d194-4670-a7bf-525ad11cf436",
            name: "Accumulated Knowledge",
            manaCost: "{1}{U}",
            typeLine: "Instant",
            oracleText:
                "Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.",
            layout: "normal",
        },
        expected: {
            name: "Accumulated Knowledge",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText:
                "Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        count: {
                            zone: "graveyard",
                            acrossAllPlayers: true,
                            filter: { name: "Accumulated Knowledge" },
                        },
                    },
                },
            ],
        },
    },
    // CR 101.4 + CR 701.21a — "Each player chooses from among the permanents
    // they control an artifact, a creature, an enchantment, and a land, then
    // sacrifices the rest": `chooseCategorized` acts on `$each`, which the
    // canned smoke scenario does not model (issue #4573).
    {
        rule: "effect clause",
        card: {
            oracleId: "b0479ca4-e925-4aa7-a4fa-f7e01f899ac5",
            name: "Cataclysm",
            manaCost: "{2}{W}{W}",
            typeLine: "Sorcery",
            oracleText:
                "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest.",
            layout: "normal",
        },
        expected: {
            name: "Cataclysm",
            types: ["Sorcery"],
            manaCost: { X: 2, W: 2 },
            oracleText:
                "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "chooseCategorized",
                            player: { ref: "$each" },
                            zone: "battlefield",
                            categories: [
                                {
                                    label: "Artifact",
                                    filter: { type: "Artifact" },
                                },
                                {
                                    label: "Creature",
                                    filter: { type: "Creature" },
                                },
                                {
                                    label: "Enchantment",
                                    filter: { type: "Enchantment" },
                                },
                                { label: "Land", filter: { type: "Land" } },
                            ],
                            onPicked: "keep",
                            sweep: { action: "sacrifice" },
                            prompt: "Choose an artifact, a creature, an enchantment, and a land to keep; the rest are sacrificed.",
                        },
                    ],
                },
            ],
        },
    },
    // CR 101.4 + CR 701.21a — "Each player chooses from the lands they control a land of each basic land type, then sacrifices the rest": `chooseCategorized` over the five basic land types acts on `$each`, which the canned smoke scenario does not model (issue #5501).
    {
        rule: "effect clause",
        card: {
            oracleId: "4a7b89b2-5fe9-4d39-9d42-3ca78bcf6d40",
            name: "Global Ruin",
            manaCost: "{4}{W}",
            typeLine: "Sorcery",
            oracleText:
                "Each player chooses from the lands they control a land of each basic land type, then sacrifices the rest.",
            layout: "normal",
        },
        expected: {
            name: "Global Ruin",
            types: ["Sorcery"],
            manaCost: { X: 4, W: 1 },
            oracleText:
                "Each player chooses from the lands they control a land of each basic land type, then sacrifices the rest.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "chooseCategorized",
                            player: { ref: "$each" },
                            zone: "battlefield",
                            categories: [
                                {
                                    label: "Plains",
                                    filter: { subtype: "Plains" },
                                },
                                {
                                    label: "Island",
                                    filter: { subtype: "Island" },
                                },
                                {
                                    label: "Swamp",
                                    filter: { subtype: "Swamp" },
                                },
                                {
                                    label: "Mountain",
                                    filter: { subtype: "Mountain" },
                                },
                                {
                                    label: "Forest",
                                    filter: { subtype: "Forest" },
                                },
                            ],
                            onPicked: "keep",
                            sweep: {
                                filter: { type: "Land" },
                                action: "sacrifice",
                            },
                            prompt: "Choose a land of each basic land type to keep; the rest are sacrificed.",
                        },
                    ],
                },
            ],
        },
    },
    // CR 101.4 — "Each player chooses a land they control of each basic land type. Return those lands to their owners' hands.": the two-sentence bounce, `chooseCategorized` on `$each` (issue #5501).
    {
        rule: "effect clause",
        card: {
            oracleId: "a7be1624-04cc-4ed5-8b05-63b633893dee",
            name: "Planar Overlay",
            manaCost: "{2}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Each player chooses a land they control of each basic land type. Return those lands to their owners' hands.",
            layout: "normal",
        },
        expected: {
            name: "Planar Overlay",
            types: ["Sorcery"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Each player chooses a land they control of each basic land type. Return those lands to their owners' hands.",
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
                                {
                                    label: "Plains",
                                    filter: { subtype: "Plains" },
                                },
                                {
                                    label: "Island",
                                    filter: { subtype: "Island" },
                                },
                                {
                                    label: "Swamp",
                                    filter: { subtype: "Swamp" },
                                },
                                {
                                    label: "Mountain",
                                    filter: { subtype: "Mountain" },
                                },
                                {
                                    label: "Forest",
                                    filter: { subtype: "Forest" },
                                },
                            ],
                            onPicked: "returnToHand",
                            prompt: "Choose a land of each basic land type to return to hand.",
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.20a + CR 701.9a — "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards": reveal and `chooseCategorized` on `$each` (issue #5501).
    {
        rule: "effect clause",
        card: {
            oracleId: "cd16634e-b894-4cff-9d5b-408932863c1f",
            name: "Noxious Vapors",
            manaCost: "{1}{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.",
            layout: "normal",
        },
        expected: {
            name: "Noxious Vapors",
            types: ["Sorcery"],
            manaCost: { X: 1, B: 2 },
            oracleText:
                "Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.",
            effects: [
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "reveal",
                            player: { ref: "$each" },
                            zone: "hand",
                        },
                    ],
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
        },
    },
    // CR 608.2h + CR 119.3 — "Destroy target artifact. It can't be
    // regenerated. That artifact's controller gains life equal to its mana
    // value": the same acted-on controller as Swords to Plowshares, with the
    // amount read off the snapshot's mana value rather than its power
    // (issue #4573).
    {
        rule: "effect clause",
        card: {
            oracleId: "8d6e39b0-a190-40a0-a8e1-ee82f477376f",
            name: "Crumble",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText:
                "Destroy target artifact. It can't be regenerated. That artifact's controller gains life equal to its mana value.",
            layout: "normal",
        },
        expected: {
            name: "Crumble",
            types: ["Instant"],
            manaCost: { G: 1 },
            oracleText:
                "Destroy target artifact. It can't be regenerated. That artifact's controller gains life equal to its mana value.",
            effects: [
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                    bind: "$that1",
                },
                {
                    op: "gainLife",
                    player: { ref: "$that1.controller" },
                    amount: { ref: "$that1.manaValue" },
                },
            ],
            targetRequirement: { type: "Artifact", count: 1 },
        },
    },
    // CR 120.1 + CR 202.3 + CR 608.2h — "Destroy target artifact. That
    // artifact deals damage equal to its mana value to this creature": the
    // DEALER is the object the destroy acted on, read off its `bind` snapshot
    // (issue #4572), exhibiting the "amount is a runtime snapshot" and
    // "dealDamage lands on $source" card-dependent forms.
    {
        rule: "effect clause",
        card: {
            oracleId: "0afc2d2f-4fdb-440f-9c35-45bf103c0437",
            name: "Goblin Tinkerer",
            manaCost: "{1}{R}",
            typeLine: "Creature — Goblin Artificer",
            oracleText:
                "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.",
            power: "1",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Goblin Tinkerer",
            types: ["Creature"],
            subtypes: ["Goblin", "Artificer"],
            manaCost: { X: 1, R: 1 },
            power: 1,
            toughness: 2,
            oracleText:
                "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.",
            activatedAbilities: [
                {
                    id: "goblin-tinkerer-ability",
                    oracleText:
                        "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.",
                    cost: { mana: { R: 1 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "destroy",
                            target: { target: 0 },
                            bind: "$that1",
                        },
                        {
                            op: "dealDamage",
                            amount: { ref: "$that1.manaValue" },
                            to: { ref: "$source" },
                            source: { ref: "$that1" },
                        },
                    ],
                    targetRequirement: { type: "Artifact", count: 1 },
                },
            ],
        },
    },
    // CR 702.8a + CR 603.7a — the Mirage flash permission and its off-timing
    // cleanup sacrifice. Exhibits `delayedTrigger` capturing `$source` and the
    // `sacrifice` of that capture, armed by an entered trigger gated on
    // `castOffSorceryTiming` (issue #5256).
    {
        rule: "flash cast cleanup sacrifice",
        card: {
            oracleId: "2636aafa-83f9-4b72-b729-04e1c3aa0eec",
            name: "Spider Climb",
            manaCost: "{G}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nEnchant creature\nEnchanted creature gets +0/+3 and has reach. (It can block creatures with flying.)",
            layout: "normal",
        },
        expected: {
            name: "Spider Climb",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { G: 1 },
            oracleText:
                "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nEnchant creature\nEnchanted creature gets +0/+3 and has reach. (It can block creatures with flying.)",
            compiledTriggeredAbilities: [
                {
                    id: "spider-climb-cleanup-sacrifice",
                    oracleText:
                        "If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.",
                    head: { kind: "entered", scope: "self" },
                    condition: { kind: "cast-off-sorcery-timing" },
                    effects: [
                        {
                            op: "delayedTrigger",
                            timing: "next-cleanup-step",
                            oracleText:
                                "At the beginning of the next cleanup step, the controller of this permanent sacrifices it.",
                            capture: { $becomes: { ref: "$source" } },
                            effects: [
                                {
                                    op: "sacrifice",
                                    target: { ref: "$becomes" },
                                },
                            ],
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 0, toughness: 3 },
                { kind: "keyword-grant", appliesTo: "host", keyword: "reach" },
            ],
            castAsThoughFlash: true,
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 603.7a + CR 111.1 — "Sacrifice it at the beginning of the next end
    // step" after a token is created: the delayed body sacrifices the token
    // `createToken` bound (issue #5256).
    {
        rule: "effect clause",
        card: {
            oracleId: "c5f5b7e5-af1e-4c8a-8d44-3e2152955d4e",
            name: "Tidal Wave",
            manaCost: "{2}{U}",
            typeLine: "Instant",
            oracleText:
                "Create a 5/5 blue Wall creature token with defender. Sacrifice it at the beginning of the next end step.",
            layout: "normal",
        },
        expected: {
            name: "Tidal Wave",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Create a 5/5 blue Wall creature token with defender. Sacrifice it at the beginning of the next end step.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Wall",
                        types: ["Creature"],
                        subtypes: ["Wall"],
                        power: 5,
                        toughness: 5,
                        colors: ["U"],
                        staticAbilities: ["defender"],
                    },
                    controller: "controller",
                    bind: "$that1",
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Sacrifice it at the beginning of the next end step.",
                    capture: { $captured: { ref: "$that1" } },
                    effects: [
                        { op: "sacrifice", target: { ref: "$captured" } },
                    ],
                },
            ],
        },
    },
    // CR 603.7a + CR 111.1 — "Exile it at the beginning of the next end step"
    // after a token is created, on an activated ability: the delayed body
    // exiles the token `createToken` bound (issue #5256).
    {
        rule: "effect clause",
        card: {
            oracleId: "650949ca-609b-46c5-bc6b-6f782cdcb6d2",
            name: "Rakdos Guildmage",
            manaCost: "{B/R}{B/R}",
            typeLine: "Creature — Zombie Shaman",
            oracleText:
                "({B/R} can be paid with either {B} or {R}.)\n{3}{B}, Discard a card: Target creature gets -2/-2 until end of turn.\n{3}{R}: Create a 2/1 red Goblin creature token with haste. Exile it at the beginning of the next end step.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Rakdos Guildmage",
            types: ["Creature"],
            subtypes: ["Zombie", "Shaman"],
            manaCost: {
                hybrid: [
                    ["B", "R"],
                    ["B", "R"],
                ],
            },
            power: 2,
            toughness: 2,
            oracleText:
                "({B/R} can be paid with either {B} or {R}.)\n{3}{B}, Discard a card: Target creature gets -2/-2 until end of turn.\n{3}{R}: Create a 2/1 red Goblin creature token with haste. Exile it at the beginning of the next end step.",
            activatedAbilities: [
                {
                    id: "rakdos-guildmage-ability",
                    oracleText:
                        "{3}{B}, Discard a card: Target creature gets -2/-2 until end of turn.",
                    cost: {
                        mana: { X: 3, B: 1 },
                        discardFilter: { filter: {}, count: 1 },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: -2,
                            toughness: -2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
                {
                    id: "rakdos-guildmage-ability-2",
                    oracleText:
                        "{3}{R}: Create a 2/1 red Goblin creature token with haste. Exile it at the beginning of the next end step.",
                    cost: { mana: { X: 3, R: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Goblin",
                                types: ["Creature"],
                                subtypes: ["Goblin"],
                                power: 2,
                                toughness: 1,
                                colors: ["R"],
                                staticAbilities: ["haste"],
                            },
                            controller: "controller",
                            bind: "$that1",
                        },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Exile it at the beginning of the next end step.",
                            capture: { $captured: { ref: "$that1" } },
                            effects: [
                                { op: "exile", target: { ref: "$captured" } },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 701.23b (stated quality) + CR 702.34a
    // (flashback) + CR 404.1 (graveyard) + CR 701.24a (shuffle) — "Search
    // target player's library for up to three cards with flashback and put
    // them into that player's graveyard. Then the player shuffles.": the
    // optional range narrowed by a `hasFlashback` filter. Exhibits the
    // runtime-sized `{ min, max }` `choice` count and the `moveZone` out of
    // the target's library the canned generator cannot model.
    {
        rule: "effect clause",
        card: {
            oracleId: "938f48a9-766e-41d3-a425-9c3a6adf675b",
            name: "Quiet Speculation",
            manaCost: "{2}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Search target player's library for up to three cards with flashback and put them into that player's graveyard. Then the player shuffles.",
            layout: "normal",
        },
        expected: {
            name: "Quiet Speculation",
            types: ["Sorcery"],
            manaCost: { X: 2, U: 1 },
            oracleText:
                "Search target player's library for up to three cards with flashback and put them into that player's graveyard. Then the player shuffles.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    zoneOwnerId: { target: 0 },
                    filter: { hasFlashback: true },
                    count: { min: 0, max: 3 },
                    prompt: "Search that player's library for up to three cards with flashback.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: { target: 0 },
                    from: "library",
                    to: "graveyard",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { target: 0 },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 701.23a (search) + CR 701.23b (stated quality) + CR 406.1 (exile) +
    // CR 701.24a (shuffle) — "Search target player's library for a card and
    // exile it. Then that player shuffles.": the controller searches the
    // TARGET player's library and the find is exiled, so its owner is denied
    // it. Exhibits the card-dependent forms the canned generator cannot
    // model: a `choice` sized at RUNTIME by the target's library, and a
    // `moveZone` of the picked cards out of that library (issue #5252).
    {
        rule: "effect clause",
        card: {
            oracleId: "36e937a9-e15e-4404-bcdd-c2b0943a34ad",
            name: "Extract",
            manaCost: "{U}",
            typeLine: "Sorcery",
            oracleText:
                "Search target player's library for a card and exile it. Then that player shuffles.",
            layout: "normal",
        },
        expected: {
            name: "Extract",
            types: ["Sorcery"],
            manaCost: { U: 1 },
            oracleText:
                "Search target player's library for a card and exile it. Then that player shuffles.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    zoneOwnerId: { target: 0 },
                    count: 1,
                    prompt: "Search that player's library for a card.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: { target: 0 },
                    from: "library",
                    to: "exile",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { target: 0 },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 701.23a (search) + CR 701.23b (stated quality) + CR 406.1 (exile) +
    // CR 701.24a (shuffle) — "Search target player's library for up to seven
    // cards and exile them. Then that player shuffles.": the optional range of
    // the target-library search. Exhibits the runtime-sized `{ min, max }`
    // `choice` count the canned generator cannot size (issue #5252).
    {
        rule: "effect clause",
        card: {
            oracleId: "8daed4d8-1a43-4452-85dd-51b320714489",
            name: "Denying Wind",
            manaCost: "{7}{U}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Search target player's library for up to seven cards and exile them. Then that player shuffles.",
            layout: "normal",
        },
        expected: {
            name: "Denying Wind",
            types: ["Sorcery"],
            manaCost: { X: 7, U: 2 },
            oracleText:
                "Search target player's library for up to seven cards and exile them. Then that player shuffles.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    zoneOwnerId: { target: 0 },
                    count: { min: 0, max: 7 },
                    prompt: "Search that player's library for up to seven cards.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: { target: 0 },
                    from: "library",
                    to: "exile",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { target: 0 },
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 303.4f + CR 113.6b — "you may return this card from your graveyard to
    // the battlefield attached to that creature": an Aura returning from the
    // graveyard to the host the effect names, the creature the head fired for.
    // Exhibits `moveZone` of `$source` out of the graveyard with `attachTo`.
    {
        rule: "effect clause",
        card: {
            oracleId: "3535daf2-7dce-4fda-92ce-ad2a1ee95197",
            name: "Dragon Breath",
            manaCost: "{1}{R}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nEnchanted creature has haste.\n{R}: Enchanted creature gets +1/+0 until end of turn.\nWhen a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature.",
            layout: "normal",
        },
        expected: {
            name: "Dragon Breath",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { X: 1, R: 1 },
            oracleText:
                "Enchant creature\nEnchanted creature has haste.\n{R}: Enchanted creature gets +1/+0 until end of turn.\nWhen a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature.",
            activatedAbilities: [
                {
                    id: "dragon-breath-ability",
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
            compiledTriggeredAbilities: [
                {
                    id: "dragon-breath-trigger",
                    oracleText:
                        "When a creature with mana value 6 or greater enters, you may return this card from your graveyard to the battlefield attached to that creature.",
                    head: {
                        kind: "entered",
                        scope: "any",
                        filter: { types: ["Creature"], manaValueAtLeast: 6 },
                    },
                    zone: "graveyard",
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Return this card from your graveyard to the battlefield attached to that creature?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$source" },
                                    from: "graveyard",
                                    to: "battlefield",
                                    attachTo: { ref: "$event.instanceId" },
                                },
                            ],
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                { kind: "keyword-grant", appliesTo: "host", keyword: "haste" },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    },
    // CR 603.2 + CR 701.6a + CR 122.1 — "Whenever an opponent casts a spell,
    // counter that spell and put a depletion counter on this enchantment. If
    // there are three or more depletion counters on this enchantment,
    // sacrifice it.": the cast head's `$event.spell` countered with no
    // announcement, and the source's own tally gating its sacrifice. Exhibits
    // `counter` on a spell the canned smoke scenario cannot stage and an `if`
    // reading a runtime tally it does not size.
    {
        rule: "trigger head",
        card: {
            oracleId: "f2fc46e2-5e19-4999-a4cd-1e84697066c1",
            name: "Decree of Silence",
            manaCost: "{6}{U}{U}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it.\nCycling {4}{U}{U} ({4}{U}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, you may counter target spell.",
            layout: "normal",
        },
        expected: {
            name: "Decree of Silence",
            types: ["Enchantment"],
            manaCost: {
                X: 6,
                U: 2,
            },
            oracleText:
                "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it.\nCycling {4}{U}{U} ({4}{U}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, you may counter target spell.",
            activatedAbilities: [
                {
                    id: "cycling",
                    oracleText:
                        "Cycling {4}{U}{U} ({4}{U}{U}, Discard this card: Draw a card.)",
                    cost: {
                        mana: {
                            generic: 4,
                            U: 2,
                        },
                        discardThis: true,
                        cyclingCost: true,
                    },
                    activateFromHand: true,
                    useStack: true,
                    effects: [
                        {
                            op: "draw",
                            player: "controller",
                            count: 1,
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "decree-of-silence-trigger",
                    oracleText:
                        "Whenever an opponent casts a spell, counter that spell and put a depletion counter on this enchantment. If there are three or more depletion counters on this enchantment, sacrifice it.",
                    head: {
                        kind: "spell-cast",
                        scope: "opponent",
                    },
                    effects: [
                        {
                            op: "counter",
                            target: {
                                ref: "$event.spell",
                            },
                        },
                        {
                            op: "counters",
                            action: "add",
                            counter: "depletion",
                            target: {
                                ref: "$source",
                            },
                            count: 1,
                        },
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    counters: {
                                        of: {
                                            ref: "$source",
                                        },
                                        type: "depletion",
                                    },
                                },
                                op: "ge",
                                right: 3,
                            },
                            then: [
                                {
                                    op: "sacrifice",
                                    target: {
                                        ref: "$source",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "decree-of-silence-trigger-2",
                    oracleText:
                        "When you cycle this card, you may counter target spell.",
                    head: {
                        kind: "cycled",
                    },
                    targetRequirement: {
                        type: "spell",
                        count: 1,
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Counter target spell?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: {
                                binding: "$may1",
                            },
                            then: [
                                {
                                    op: "counter",
                                    target: {
                                        target: 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.23a (search) + CR 701.20a (reveal) — Land Grant: "Search your
    // library for a Forest card, reveal that card, put it into your hand, then
    // shuffle", behind the reveal-hand alternative cost (CR 118.9). The
    // tutor's `choice` filters on a SUBTYPE, a runtime-sized shape the
    // basic-land fixture above does not exhibit, so the Forest tutor reaches
    // no card without this row.
    {
        rule: "effect clause",
        card: {
            oracleId: "e36f4649-934d-4e8a-bd5f-39f164ea6937",
            name: "Land Grant",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText:
                "If you have no land cards in hand, you may reveal your hand rather than pay this spell's mana cost.\nSearch your library for a Forest card, reveal that card, put it into your hand, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Land Grant",
            types: ["Sorcery"],
            manaCost: {
                X: 1,
                G: 1,
            },
            oracleText:
                "If you have no land cards in hand, you may reveal your hand rather than pay this spell's mana cost.\nSearch your library for a Forest card, reveal that card, put it into your hand, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        subtype: "Forest",
                    },
                    count: {
                        min: 0,
                        max: 1,
                    },
                    prompt: "Search your library for a Forest card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: {
                        ref: "$found1",
                    },
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
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
            alternativeCosts: [
                {
                    id: "reveal-hand-no-land-cards",
                    description: "Reveal your hand",
                    condition: {
                        kind: "no-hand-cards",
                        filter: {
                            type: "Land",
                        },
                    },
                    revealHand: true,
                },
            ],
        },
    },
    // CR 608.2c + CR 615.12 + CR 614.9 + CR 603.7a — "that creature" / "the
    // creature" after ONE announced creature target name that target: the
    // regeneration lock, the recipient-bound damage lock and a delayed dies
    // trigger whose body exiles the card from the graveyard. Exhibits
    // `moveZone` of a captured departed object, a zone change the canned smoke
    // scenario does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "84050a10-e1f1-413e-aa21-5c1f47bb2a64",
            name: "Whippoorwill",
            manaCost: "{G}",
            typeLine: "Creature — Bird",
            oracleText:
                "{G}{G}, {T}: Target creature can't be regenerated this turn. Damage that would be dealt to that creature this turn can't be prevented or dealt instead to another permanent or player. When the creature dies this turn, exile the creature.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Whippoorwill",
            types: ["Creature"],
            subtypes: ["Bird"],
            manaCost: { G: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "{G}{G}, {T}: Target creature can't be regenerated this turn. Damage that would be dealt to that creature this turn can't be prevented or dealt instead to another permanent or player. When the creature dies this turn, exile the creature.",
            activatedAbilities: [
                {
                    id: "whippoorwill-ability",
                    oracleText:
                        "{G}{G}, {T}: Target creature can't be regenerated this turn. Damage that would be dealt to that creature this turn can't be prevented or dealt instead to another permanent or player. When the creature dies this turn, exile the creature.",
                    cost: { mana: { G: 2 }, tap: true },
                    useStack: true,
                    effects: [
                        { op: "preventRegeneration", target: { target: 0 } },
                        { op: "lockDamage", target: { target: 0 } },
                        {
                            op: "delayedTrigger",
                            timing: "dies",
                            oracleText:
                                "When the creature dies this turn, exile the creature.",
                            watch: { target: 0 },
                            capture: { $captured: { target: 0 } },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$captured" },
                                    from: "graveyard",
                                    to: "exile",
                                },
                            ],
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
            ],
        },
    },
    // CR 603.3d + CR 701.20a — "that player chooses target player who controls
    // more creatures than they do and is their opponent. The first player may
    // reveal cards … until they reveal a creature card": the head's player
    // digs, behind a cost-free `mayPay`. Exhibits `mayPay` and
    // `revealUntilMatch` on an `$event` player, a recipient the canned smoke
    // scenario cannot pick (issue #5692).
    {
        rule: "effect clause",
        card: {
            oracleId: "cf14de50-d123-400c-862e-2c95fd2aa23f",
            name: "Oath of Druids",
            manaCost: "{1}{G}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.",
            layout: "normal",
        },
        expected: {
            name: "Oath of Druids",
            types: ["Enchantment"],
            manaCost: { X: 1, G: 1 },
            oracleText:
                "At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.",
            compiledTriggeredAbilities: [
                {
                    id: "oath-of-druids-trigger",
                    oracleText:
                        "At the beginning of each player's upkeep, that player chooses target player who controls more creatures than they do and is their opponent. The first player may reveal cards from the top of their library until they reveal a creature card. If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "each" },
                    targetRequirement: {
                        type: "player",
                        count: 1,
                        playerControlsMoreThan: {
                            type: "Creature",
                            than: "active",
                        },
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: { ref: "$event.activePlayerId" },
                            prompt: "Reveal cards from the top of your library until you reveal a creature card?",
                            bind: "$revealed",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$revealed" },
                            then: [
                                {
                                    op: "revealUntilMatch",
                                    player: { ref: "$event.activePlayerId" },
                                    filter: { type: "Creature" },
                                    match: "battlefield",
                                    rest: "graveyard",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 701.12a + CR 608.2b — "exchange control of this creature
    // and up to one target creature an opponent controls. If you don't or can't
    // make an exchange, sacrifice this creature. This ability still resolves if
    // its target becomes illegal.": the three sentences are one ability. Exhibits
    // `gainControl` and `sacrifice` of `$source`, which the canned smoke scenario
    // does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "7f06c098-6482-4bf3-a9a1-110d6d5b5703",
            name: "Gilded Drake",
            manaCost: "{1}{U}",
            typeLine: "Creature — Drake",
            oracleText:
                "Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.",
            power: "3",
            toughness: "3",
            layout: "normal",
        },
        expected: {
            name: "Gilded Drake",
            types: ["Creature"],
            subtypes: ["Drake"],
            manaCost: {
                X: 1,
                U: 1,
            },
            power: 3,
            toughness: 3,
            oracleText:
                "Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.",
            staticAbilities: ["flying"],
            compiledTriggeredAbilities: [
                {
                    id: "gilded-drake-trigger",
                    oracleText:
                        "When this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    resolvesIfTargetsIllegal: true,
                    targetRequirement: {
                        type: "Creature",
                        count: {
                            min: 0,
                            max: 1,
                        },
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: {
                                    ref: "$source",
                                },
                                filter: {},
                                controlledBy: "controller",
                            },
                            then: [
                                {
                                    op: "if",
                                    predicate: {
                                        targetIsAnother: {
                                            target: 0,
                                        },
                                    },
                                    then: [
                                        {
                                            op: "gainControl",
                                            target: {
                                                ref: "$source",
                                            },
                                            controller: {
                                                controllerOf: {
                                                    target: 0,
                                                },
                                            },
                                        },
                                        {
                                            op: "gainControl",
                                            target: {
                                                target: 0,
                                            },
                                            controller: "controller",
                                        },
                                    ],
                                    else: [
                                        {
                                            op: "sacrifice",
                                            target: {
                                                ref: "$source",
                                            },
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
    // CR 608.2h + CR 702.29c — "When you cycle this card, you may have it deal
    // X damage to target creature, where X is the number of Goblins on the
    // battlefield": "have it deal" is "it deals" behind a head whose "it" is
    // the source, and the count carries no controller (CR 109.2). Exhibits a
    // `count` over every player's battlefield, a set the canned smoke scenario
    // cannot size (issue #5709).
    {
        rule: "effect clause",
        card: {
            oracleId: "467ea3e3-7767-405a-9d1a-8fa5de696376",
            name: "Gempalm Incinerator",
            manaCost: "{2}{R}",
            typeLine: "Creature — Goblin",
            oracleText:
                "Cycling {1}{R} ({1}{R}, Discard this card: Draw a card.)\nWhen you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield.",
            power: "2",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Gempalm Incinerator",
            types: ["Creature"],
            subtypes: ["Goblin"],
            manaCost: {
                X: 2,
                R: 1,
            },
            power: 2,
            toughness: 1,
            oracleText:
                "Cycling {1}{R} ({1}{R}, Discard this card: Draw a card.)\nWhen you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield.",
            activatedAbilities: [
                {
                    id: "cycling",
                    oracleText:
                        "Cycling {1}{R} ({1}{R}, Discard this card: Draw a card.)",
                    cost: {
                        mana: {
                            generic: 1,
                            R: 1,
                        },
                        discardThis: true,
                        cyclingCost: true,
                    },
                    activateFromHand: true,
                    useStack: true,
                    effects: [
                        {
                            op: "draw",
                            player: "controller",
                            count: 1,
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "gempalm-incinerator-trigger",
                    oracleText:
                        "When you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins on the battlefield.",
                    head: {
                        kind: "cycled",
                    },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Have it deal X damage to target creature, where X is the number of Goblins on the battlefield?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: {
                                binding: "$may1",
                            },
                            then: [
                                {
                                    op: "dealDamage",
                                    amount: {
                                        count: {
                                            zone: "battlefield",
                                            acrossAllPlayers: true,
                                            filter: {
                                                subtype: "Goblin",
                                            },
                                        },
                                    },
                                    to: {
                                        target: 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // CR 603.7a — "Return this artifact / it / that card to … at the beginning
    // of the next end step": a delayed trigger whose body is one zone move.
    // Rakalite exhibits the `$source` capture, Liberate the capture of an
    // exiled card's binding, Dragon Mask the capture of the announced target.
    {
        rule: "effect clause",
        card: {
            oracleId: "0fd7c711-3ff4-4691-914f-242e6737066c",
            name: "Rakalite",
            manaCost: "{6}",
            typeLine: "Artifact",
            oracleText:
                "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
            layout: "normal",
        },
        expected: {
            name: "Rakalite",
            types: ["Artifact"],
            manaCost: { X: 6 },
            oracleText:
                "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
            activatedAbilities: [
                {
                    id: "rakalite-ability",
                    oracleText:
                        "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
                    cost: { mana: { X: 2 } },
                    useStack: true,
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
                    targetRequirement: { type: "any", count: 1 },
                },
            ],
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "96794470-31ea-478f-b11c-dc8342a508e2",
            name: "Liberate",
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText:
                "Exile target creature you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            layout: "normal",
        },
        expected: {
            name: "Liberate",
            types: ["Instant"],
            manaCost: { X: 1, W: 1 },
            oracleText:
                "Exile target creature you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            effects: [
                { op: "exile", target: { target: 0 }, bind: "$that1" },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                    capture: { $c: { ref: "$that1" } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$c" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                },
            ],
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
        },
    },
    {
        rule: "effect clause",
        card: {
            oracleId: "b5109270-b052-489c-951c-d4b21a41ff6f",
            name: "Dragon Mask",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "{3}, {T}: Target creature you control gets +2/+2 until end of turn. Return it to its owner's hand at the beginning of the next end step.",
            layout: "normal",
        },
        expected: {
            name: "Dragon Mask",
            types: ["Artifact"],
            manaCost: { X: 3 },
            oracleText:
                "{3}, {T}: Target creature you control gets +2/+2 until end of turn. Return it to its owner's hand at the beginning of the next end step.",
            activatedAbilities: [
                {
                    id: "dragon-mask-ability",
                    oracleText:
                        "{3}, {T}: Target creature you control gets +2/+2 until end of turn. Return it to its owner's hand at the beginning of the next end step.",
                    cost: { mana: { X: 3 }, tap: true },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Return it to its owner's hand at the beginning of the next end step.",
                            capture: { $c: { target: 0 } },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$c" },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "you",
                    },
                },
            ],
        },
    },
    // CR 608.2c + CR 400.7 + CR 701.23a — "Exile all cards from target
    // player's graveyard other than basic land cards. For each card exiled this
    // way, search that player's library for all cards with the same name …":
    // the three sentences fold into one `forEach` over the graveyard. Exhibits
    // the `forEach` construct over a runtime-selected set and `moveZone` by
    // name, which the canned smoke scenario does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "3abd345a-69a5-486e-ada9-dd1ca0decc28",
            name: "Haunting Echoes",
            manaCost: "{3}{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
            layout: "normal",
        },
        expected: {
            name: "Haunting Echoes",
            types: ["Sorcery"],
            manaCost: { X: 3, B: 2 },
            oracleText:
                "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: { target: 0 },
                        filter: {
                            any: [
                                { excludeType: "Land" },
                                { excludeSupertype: "Basic" },
                            ],
                        },
                    },
                    effects: [
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            fromZones: ["graveyard"],
                            filter: {
                                name: { ref: "$each.name" },
                                any: [
                                    { excludeType: "Land" },
                                    { excludeSupertype: "Basic" },
                                ],
                            },
                            to: "exile",
                        },
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            fromZones: ["library"],
                            filter: { name: { ref: "$each.name" } },
                            to: "exile",
                        },
                    ],
                },
                { op: "libraryLook", action: "shuffle", player: { target: 0 } },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
    },
    // CR 701.26a + CR 122.1 — "that player taps an untapped artifact, creature,
    // or land they control for each fade counter on this artifact": the choice's
    // size is the source's live counter count and its chooser the head's
    // player, both runtime bindings the canned smoke scenario does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "c4ea0931-43e0-4214-9e0b-213eee3a7e69",
            name: "Tangle Wire",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nAt the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
            layout: "normal",
        },
        expected: {
            name: "Tangle Wire",
            types: ["Artifact"],
            manaCost: { X: 3 },
            oracleText:
                "Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nAt the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
            staticAbilities: ["fading 4"],
            compiledTriggeredAbilities: [
                {
                    id: "tangle-wire-trigger",
                    oracleText:
                        "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "each" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: { ref: "$event.activePlayerId" },
                            zone: "battlefield",
                            filter: {
                                type: ["Artifact", "Creature", "Land"],
                                tapped: false,
                            },
                            count: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: "fade",
                                },
                            },
                            prompt: "Tap an untapped artifact, creature, or land you control.",
                            bind: "$tapped1",
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$tapped1" },
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
    // Verb Frames (issue #6557, CR 701.23a) — the search frame's card-type disjunction, revealed, shuffled, then placed on top. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "fb81f95c-70f8-4eb7-8d15-15d0ae23ec03",
            name: "Mystical Tutor",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.",
            layout: "normal",
        },
        expected: {
            name: "Mystical Tutor",
            types: ["Instant"],
            manaCost: {
                U: 1,
            },
            oracleText:
                "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: ["Instant", "Sorcery"],
                    },
                    count: {
                        min: 0,
                        max: 1,
                    },
                    prompt: "Search your library for an instant or sorcery card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: {
                        ref: "$found1",
                    },
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
                    player: "controller",
                    from: "library",
                    to: "library-top",
                },
            ],
        },
    },
    // Verb Frames (issue #6557, CR 701.23a) — the search frame's single card type put onto the battlefield, behind an additional cost. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "254878f0-be90-4653-a395-0c41258fceaf",
            name: "Tinker",
            manaCost: "{2}{U}",
            typeLine: "Sorcery",
            oracleText:
                "As an additional cost to cast this spell, sacrifice an artifact.\nSearch your library for an artifact card, put that card onto the battlefield, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Tinker",
            types: ["Sorcery"],
            manaCost: {
                X: 2,
                U: 1,
            },
            oracleText:
                "As an additional cost to cast this spell, sacrifice an artifact.\nSearch your library for an artifact card, put that card onto the battlefield, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: "Artifact",
                    },
                    count: {
                        min: 0,
                        max: 1,
                    },
                    prompt: "Search your library for an artifact card.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
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
            additionalCosts: {
                sacrificeFilter: {
                    types: ["Artifact"],
                },
            },
        },
    },
    // Verb Frames (issue #6557, CR 701.23a) — the moveZone frame's graveyard destination on a plain 'a card' (mandatory, CR 701.23b). Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "299fc083-0834-4064-8344-f895aff68867",
            name: "Entomb",
            manaCost: "{B}",
            typeLine: "Instant",
            oracleText:
                "Search your library for a card, put that card into your graveyard, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Entomb",
            types: ["Instant"],
            manaCost: {
                B: 1,
            },
            oracleText:
                "Search your library for a card, put that card into your graveyard, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
            ],
        },
    },
    // Verb Frames (issue #6557, CR 701.23a) — the 'up to N' quantity with 'them' into the graveyard. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "8203c621-a1a0-4865-8c9a-0d4064c86107",
            name: "Buried Alive",
            manaCost: "{2}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Search your library for up to three creature cards, put them into your graveyard, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Buried Alive",
            types: ["Sorcery"],
            manaCost: {
                X: 2,
                B: 1,
            },
            oracleText:
                "Search your library for up to three creature cards, put them into your graveyard, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: "Creature",
                    },
                    count: {
                        min: 0,
                        max: 3,
                    },
                    prompt: "Search your library for up to three creature cards.",
                    bind: "$found1",
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                },
            ],
        },
    },
    // Verb Frames (issue #6557, CR 701.23a) — the search frame's colour class. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "86cebe2a-95e7-4f22-99cc-e805aeaf347e",
            name: "Merchant Scroll",
            manaCost: "{1}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Search your library for a blue instant card, reveal that card, put it into your hand, then shuffle.",
            layout: "normal",
        },
        expected: {
            name: "Merchant Scroll",
            types: ["Sorcery"],
            manaCost: {
                X: 1,
                U: 1,
            },
            oracleText:
                "Search your library for a blue instant card, reveal that card, put it into your hand, then shuffle.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: "Instant",
                        color: "U",
                    },
                    count: {
                        min: 0,
                        max: 1,
                    },
                    prompt: "Search your library for a blue instant card.",
                    bind: "$found1",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: {
                        ref: "$found1",
                    },
                },
                {
                    op: "moveZone",
                    cards: {
                        ref: "$found1",
                    },
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
    // Verb Frames (issue #6557, CR 701.23a) — the search frame's mana-value ceiling on a subtyped permanent card. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "1ea0c775-fde0-4a21-b4c2-8bcec0e4f4f8",
            name: "Rathi Assassin",
            manaCost: "{2}{B}{B}",
            typeLine: "Creature — Phyrexian Zombie Mercenary Assassin",
            oracleText:
                "{1}{B}{B}, {T}: Destroy target tapped nonblack creature.\n{3}, {T}: Search your library for a Mercenary permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        expected: {
            name: "Rathi Assassin",
            types: ["Creature"],
            subtypes: ["Phyrexian", "Zombie", "Mercenary", "Assassin"],
            manaCost: {
                X: 2,
                B: 2,
            },
            power: 2,
            toughness: 2,
            oracleText:
                "{1}{B}{B}, {T}: Destroy target tapped nonblack creature.\n{3}, {T}: Search your library for a Mercenary permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.",
            activatedAbilities: [
                {
                    id: "rathi-assassin-ability",
                    oracleText:
                        "{1}{B}{B}, {T}: Destroy target tapped nonblack creature.",
                    cost: {
                        mana: {
                            X: 1,
                            B: 2,
                        },
                        tap: true,
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "destroy",
                            target: {
                                target: 0,
                            },
                        },
                    ],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        excludeColors: ["B"],
                        tappedFilter: "tapped",
                    },
                },
                {
                    id: "rathi-assassin-ability-2",
                    oracleText:
                        "{3}, {T}: Search your library for a Mercenary permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.",
                    cost: {
                        mana: {
                            X: 3,
                        },
                        tap: true,
                    },
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
                                subtype: "Mercenary",
                                manaValueAtMost: 3,
                            },
                            count: {
                                min: 0,
                                max: 1,
                            },
                            prompt: "Search your library for a Mercenary permanent card with mana value 3 or less.",
                            bind: "$found1",
                        },
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$found1",
                            },
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
    // Verb Frames (issue #6557, CR 701.23a) — the to-top ordering on an activated ability beside a static line. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "2c275a85-5a15-46cd-a6e7-add63f9b853d",
            name: "Sterling Grove",
            manaCost: "{G}{W}",
            typeLine: "Enchantment",
            oracleText:
                "Other enchantments you control have shroud. (They can't be the targets of spells or abilities.)\n{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
            layout: "normal",
        },
        expected: {
            name: "Sterling Grove",
            types: ["Enchantment"],
            manaCost: {
                W: 1,
                G: 1,
            },
            oracleText:
                "Other enchantments you control have shroud. (They can't be the targets of spells or abilities.)\n{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
            activatedAbilities: [
                {
                    id: "sterling-grove-ability",
                    oracleText:
                        "{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
                    cost: {
                        mana: {
                            X: 1,
                        },
                        sacrifice: true,
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: {
                                type: "Enchantment",
                            },
                            count: {
                                min: 0,
                                max: 1,
                            },
                            prompt: "Search your library for an enchantment card.",
                            bind: "$found1",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            cards: {
                                ref: "$found1",
                            },
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                        {
                            op: "moveZone",
                            cards: {
                                ref: "$found1",
                            },
                            player: "controller",
                            from: "library",
                            to: "library-top",
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    filter: {
                        types: ["Enchantment"],
                        controllerRelation: "you",
                        excludeSource: true,
                    },
                    keyword: "shroud",
                },
            ],
        },
    },
    // Verb Frames (issue #6557, CR 701.23a) — the mana-value ceiling on a card-type disjunction, behind a trigger's may-gate. Exhibits the runtime-sized `choice` / `moveZone` forms the canned generator does not model.
    {
        rule: "effect clause",
        card: {
            oracleId: "47a785ed-8095-4685-8daa-02c4e2b0ffcd",
            name: "Spellseeker",
            manaCost: "{2}{U}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "When this creature enters, you may search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        expected: {
            name: "Spellseeker",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: {
                X: 2,
                U: 1,
            },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature enters, you may search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.",
            compiledTriggeredAbilities: [
                {
                    id: "spellseeker-trigger",
                    oracleText:
                        "When this creature enters, you may search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle?",
                            bind: "$may2",
                        },
                        {
                            op: "if",
                            predicate: {
                                binding: "$may2",
                            },
                            then: [
                                {
                                    op: "choice",
                                    kind: "search-library",
                                    player: "controller",
                                    zone: "library",
                                    filter: {
                                        type: ["Instant", "Sorcery"],
                                        manaValueAtMost: 2,
                                    },
                                    count: {
                                        min: 0,
                                        max: 1,
                                    },
                                    prompt: "Search your library for an instant or sorcery card with mana value 2 or less.",
                                    bind: "$found1",
                                },
                                {
                                    op: "reveal",
                                    player: "controller",
                                    cards: {
                                        ref: "$found1",
                                    },
                                },
                                {
                                    op: "moveZone",
                                    cards: {
                                        ref: "$found1",
                                    },
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
]);
