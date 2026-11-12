// PROTOTYPE (zone-target highlight) — the REAL scenarios the switcher loads
// into the current game (debugSetupScenario, the debug sheet's own loader):
// every one declares its stack, so each is the engine's own state — no
// simulated targets (owner feedback 2026-11-12: the sims were fakes).
//
// Shared board: deep graveyards with identical duplicates (3x Llanowar
// Elves, target the MIDDLE one), cards in both exiles.

const BOARD = [
    { name: "Swamp", owner: "me", zone: "battlefield", count: 3 },
    { name: "Plains", owner: "me", zone: "battlefield", count: 3 },
    { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
    { name: "Lion Sash", owner: "me", zone: "battlefield" },
    { name: "Phyrexian Furnace", owner: "me", zone: "battlefield" },
    { name: "Dark Ritual", owner: "me", zone: "hand" },
    { name: "Sengir Vampire", owner: "me", zone: "graveyard" },
    { name: "Hypnotic Specter", owner: "me", zone: "graveyard" },
    { name: "Swords to Plowshares", owner: "me", zone: "graveyard" },
    { name: "Wrath of God", owner: "me", zone: "graveyard" },
    { name: "Swamp", owner: "me", zone: "graveyard" },
    { name: "Plains", owner: "me", zone: "graveyard" },
    { name: "Dark Ritual", owner: "me", zone: "exile" },
    { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
    { name: "Island", owner: "opp", zone: "battlefield", count: 2 },
    { name: "Swamp", owner: "opp", zone: "battlefield" },
    { name: "Deathrite Shaman", owner: "opp", zone: "battlefield" },
    { name: "Counterspell", owner: "opp", zone: "hand" },
    { name: "Llanowar Elves", owner: "opp", zone: "graveyard", count: 3 },
    { name: "Serra Angel", owner: "opp", zone: "graveyard" },
    { name: "Shivan Dragon", owner: "opp", zone: "graveyard" },
    { name: "Lightning Bolt", owner: "opp", zone: "graveyard", count: 2 },
    { name: "Counterspell", owner: "opp", zone: "graveyard" },
    { name: "Brainstorm", owner: "opp", zone: "graveyard" },
    { name: "Forest", owner: "opp", zone: "graveyard" },
    { name: "Brainstorm", owner: "opp", zone: "exile" },
    { name: "Island", owner: "opp", zone: "exile" },
];

const BASE = { phase: "PRECOMBAT_MAIN", turn: 5, cards: BOARD };

export type ProtoScenario = { key: string; label: string; spec: unknown };

export const PROTO_SCENARIOS: ProtoScenario[] = [
    {
        key: "single",
        label: "1-item stack · Reanimate → middle Llanowar Elves",
        spec: {
            ...BASE,
            stack: [
                {
                    kind: "spell",
                    name: "Reanimate",
                    controller: "me",
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Llanowar Elves",
                            seat: "opp",
                            nth: 1,
                        },
                    ],
                },
            ],
        },
    },
    {
        key: "multi",
        label: "multi-target · Restock (2 cards) + Deathrite on one of them",
        spec: {
            ...BASE,
            stack: [
                {
                    kind: "spell",
                    name: "Restock",
                    controller: "me",
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Sengir Vampire",
                            seat: "me",
                        },
                        {
                            kind: "graveyard-card",
                            name: "Wrath of God",
                            seat: "me",
                        },
                    ],
                },
                {
                    kind: "ability",
                    name: "Deathrite Shaman",
                    controller: "opp",
                    abilityId: "deathrite-shaman-graveyard-hate",
                    castOffSorceryTiming: true,
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Wrath of God",
                            seat: "me",
                        },
                    ],
                },
            ],
        },
    },
    {
        key: "big",
        label: "big stack · 6 items, both graveyards + Counterspell on Krosan Reclamation",
        spec: {
            ...BASE,
            stack: [
                {
                    kind: "spell",
                    name: "Reanimate",
                    controller: "me",
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Llanowar Elves",
                            seat: "opp",
                            nth: 1,
                        },
                    ],
                },
                {
                    kind: "spell",
                    name: "Krosan Reclamation",
                    controller: "opp",
                    castOffSorceryTiming: true,
                    targets: [{ kind: "player", seat: "opp" }],
                },
                {
                    kind: "ability",
                    name: "Lion Sash",
                    controller: "me",
                    abilityId: "lion-sash-graveyard-hate",
                    castOffSorceryTiming: true,
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Shivan Dragon",
                            seat: "opp",
                        },
                    ],
                },
                {
                    kind: "ability",
                    name: "Deathrite Shaman",
                    controller: "opp",
                    abilityId: "deathrite-shaman-land-mana",
                    castOffSorceryTiming: true,
                    targets: [
                        { kind: "graveyard-card", name: "Swamp", seat: "me" },
                    ],
                },
                {
                    kind: "ability",
                    name: "Phyrexian Furnace",
                    controller: "me",
                    abilityId: "phyrexian-furnace-exile-draw",
                    castOffSorceryTiming: true,
                    targets: [
                        {
                            kind: "graveyard-card",
                            name: "Serra Angel",
                            seat: "opp",
                        },
                    ],
                },
                // A spell targeting another object ON THE STACK (B2 must
                // report it in its row too).
                {
                    kind: "spell",
                    name: "Counterspell",
                    controller: "me",
                    castOffSorceryTiming: true,
                    targets: [{ kind: "stack", index: 1 }],
                },
            ],
        },
    },
];
