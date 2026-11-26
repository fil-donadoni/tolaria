// Blade LINES (ADR 0186 Decision 9) — see `line.ts`.
//
// Each entry is a course of play the Bot must carry to its end through the
// live Brain path, the opponent's replies between its moves included. A Line
// the Bot cannot follow yet is `stretch`, with its `cause` written.

import type { BladeLine } from "./types";

export const BLADE_LINES: BladeLine[] = [
    {
        label: "line: hold the pump through the upkeep, answer the Shock with it, then let the stack resolve",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Giant Growth", owner: "me", zone: "hand" },
                { name: "Shock", owner: "opp", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "UPKEEP",
            turn: 4,
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        steps: [
            {
                expect: [{ kind: "pass" }],
                replies: [
                    {
                        kind: "cast-spell",
                        card: "Shock",
                        target: "Grizzly Bears",
                    },
                ],
            },
            {
                expect: [
                    {
                        kind: "cast-spell",
                        card: "Giant Growth",
                        target: "Grizzly Bears",
                    },
                ],
            },
            { expect: [{ kind: "pass" }] },
        ],
        note: "Three Bot decisions with the opponent acting between them. In the opponent's upkeep (CR 503.1) nothing threatens the Bears, so the Bot keeps Giant Growth. The opponent then casts Shock at the Bears in its draw step; the Bot answers with the Growth (a 5/5 survives 2 damage, CR 704.5g) and, holding priority with its own spell on top (CR 117.3c), passes so the stack resolves. The last decision has one legal move, so it lowers to an `unconstraining` gap, not a Verdict.",
    },

    {
        label: "line: Amulet Titan in one turn \u2014 transmute Tolaria West for Summoner's Pact, Pact for Primeval Titan, fetch Hanweir Battlements and Gruul Turf, haste, attack, fetch again",
        spec: {
            cards: [
                { name: "Amulet of Vigor", owner: "me", zone: "battlefield" },
                {
                    name: "Otawara, Soaring City",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Simic Growth Chamber",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Forest", owner: "me", zone: "battlefield", count: 6 },
                { name: "Tolaria West", owner: "me", zone: "hand" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
                { name: "Summoner's Pact", owner: "me", zone: "library" },
                { name: "Primeval Titan", owner: "me", zone: "library" },
                { name: "Hanweir Battlements", owner: "me", zone: "library" },
                { name: "Gruul Turf", owner: "me", zone: "library" },
                { name: "Mirrorpool", owner: "me", zone: "library" },
                { name: "Tolaria West", owner: "me", zone: "library" },
                { name: "Scapeshift", owner: "me", zone: "library", count: 4 },
                { name: "Forest", owner: "opp", zone: "library", count: 10 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "me",
            landCount: 0,
            libraryCount: 0,
            landsPlayed: { me: 1 },
            life: { me: 20, opp: 20 },
        },

        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        cause: "CAUSE_AMULET",
        steps: [
            { expect: [{ kind: "activate-ability", card: "Tolaria West" }] },
            {
                expect: [
                    { kind: "resolution-choice", cards: ["Summoner's Pact"] },
                ],
            },
            { expect: [{ kind: "cast-spell", card: "Summoner's Pact" }] },
            {
                expect: [
                    { kind: "resolution-choice", cards: ["Primeval Titan"] },
                ],
            },
            { expect: [{ kind: "cast-spell", card: "Primeval Titan" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "may-pay", accept: true }] },
            {
                expect: [
                    {
                        kind: "resolution-choice",
                        cards: ["Hanweir Battlements", "Gruul Turf"],
                    },
                ],
            },
            { expect: [{ kind: "resolution-choice" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            {
                expect: [
                    { kind: "pass" },
                    {
                        kind: "activate-ability",
                        card: "Hanweir Battlements",
                        target: "Primeval Titan",
                    },
                ],
            },
            { expect: [{ kind: "resolution-choice", cards: ["Forest"] }] },
            {
                expect: [
                    {
                        kind: "activate-ability",
                        card: "Hanweir Battlements",
                        target: "Primeval Titan",
                    },
                ],
            },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "declare-attackers", card: "Primeval Titan" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "may-pay", accept: true }] },
            {
                expect: [
                    {
                        kind: "resolution-choice",
                        cards: ["Mirrorpool", "Tolaria West"],
                    },
                ],
            },
        ],
        note: "NOTE_AMULET",
    },
    {
        label: "line: Amulet Titan one mana short \u2014 Tolaria West already transmuted, hold Summoner's Pact",
        spec: {
            cards: [
                { name: "Amulet of Vigor", owner: "me", zone: "battlefield" },
                {
                    name: "Otawara, Soaring City",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Simic Growth Chamber",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Forest", owner: "me", zone: "battlefield", count: 5 },
                { name: "Tolaria West", owner: "me", zone: "hand" },
                { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
                { name: "Summoner's Pact", owner: "me", zone: "library" },
                { name: "Primeval Titan", owner: "me", zone: "library" },
                { name: "Hanweir Battlements", owner: "me", zone: "library" },
                { name: "Gruul Turf", owner: "me", zone: "library" },
                { name: "Mirrorpool", owner: "me", zone: "library" },
                { name: "Tolaria West", owner: "me", zone: "library" },
                { name: "Scapeshift", owner: "me", zone: "library", count: 4 },
                { name: "Forest", owner: "opp", zone: "library", count: 10 },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "me",
            landCount: 0,
            libraryCount: 0,
            landsPlayed: { me: 1 },
            life: { me: 20, opp: 20 },
        },
        setup: [
            {
                kind: "move",
                seat: "me",
                move: { kind: "activate-ability", card: "Tolaria West" },
            },
            { kind: "move", seat: "opp", move: { kind: "pass" } },
            {
                kind: "move",
                seat: "me",
                move: { kind: "resolution-choice", cards: ["Summoner's Pact"] },
            },
        ],
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        cause: "CAUSE_SIBLING",
        steps: [{ expect: [{ kind: "pass" }] }],
        note: "NOTE_SIBLING",
    },
    {
        label: "line: Tron over two turns \u2014 Expedition Map for Urza's Tower now, Sylvan Scrying for Urza's Mine next turn",
        spec: {
            cards: [
                {
                    name: "Urza's Power Plant",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Expedition Map", owner: "me", zone: "battlefield" },
                { name: "Sylvan Scrying", owner: "me", zone: "hand" },
                {
                    name: "Urza's Tower",
                    owner: "me",
                    zone: "library",
                    count: 2,
                },
                { name: "Urza's Mine", owner: "me", zone: "library", count: 4 },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Mountain", owner: "opp", zone: "library", count: 10 },
                {
                    name: "Devourer of Destiny",
                    owner: "me",
                    zone: "library",
                    count: 6,
                },
                { name: "Stone Rain", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            activePlayer: "me",
            landCount: 0,
            libraryCount: 0,
            landsPlayed: { me: 0 },
            life: { me: 20, opp: 20 },
            rngSeed: 1,
        },

        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        cause: "CAUSE_TRON",
        steps: [
            { expect: [{ kind: "activate-ability", card: "Expedition Map" }] },
            {
                expect: [
                    { kind: "resolution-choice", cards: ["Urza's Tower"] },
                ],
            },
            { expect: [{ kind: "play-land", card: "Urza's Tower" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "declare-attackers" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            {
                expect: [{ kind: "pass" }],
                replies: [{ kind: "declare-attackers" }],
            },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "cast-spell", card: "Sylvan Scrying" }] },
            { expect: [{ kind: "resolution-choice", cards: ["Urza's Mine"] }] },
            { expect: [{ kind: "play-land", card: "Urza's Mine" }] },
        ],
        note: "NOTE_TRON",
    },
    {
        label: "line: Tron, the Tower destroyed between the turns \u2014 Sylvan Scrying re-reads the library for the last Urza's Tower",
        spec: {
            cards: [
                {
                    name: "Urza's Power Plant",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Expedition Map", owner: "me", zone: "battlefield" },
                { name: "Sylvan Scrying", owner: "me", zone: "hand" },
                {
                    name: "Urza's Tower",
                    owner: "me",
                    zone: "library",
                    count: 2,
                },
                { name: "Urza's Mine", owner: "me", zone: "library", count: 4 },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
                { name: "Mountain", owner: "opp", zone: "library", count: 10 },
                {
                    name: "Devourer of Destiny",
                    owner: "me",
                    zone: "library",
                    count: 6,
                },
                { name: "Stone Rain", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            activePlayer: "me",
            landCount: 0,
            libraryCount: 0,
            landsPlayed: { me: 0 },
            life: { me: 20, opp: 20 },
            rngSeed: 1,
        },

        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "stretch",
        cause: "CAUSE_TRONV",
        steps: [
            { expect: [{ kind: "activate-ability", card: "Expedition Map" }] },
            {
                expect: [
                    { kind: "resolution-choice", cards: ["Urza's Tower"] },
                ],
            },
            { expect: [{ kind: "play-land", card: "Urza's Tower" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "declare-attackers" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            {
                expect: [{ kind: "pass" }],
                replies: [
                    {
                        kind: "cast-spell",
                        card: "Stone Rain",
                        target: "Urza's Tower",
                    },
                ],
            },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            {
                expect: [{ kind: "pass" }],
                replies: [{ kind: "declare-attackers" }],
            },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "pass" }] },
            { expect: [{ kind: "cast-spell", card: "Sylvan Scrying" }] },
            {
                expect: [
                    { kind: "resolution-choice", cards: ["Urza's Tower"] },
                ],
            },
            { expect: [{ kind: "play-land", card: "Urza's Tower" }] },
        ],
        note: "NOTE_TRONV",
    },
];
