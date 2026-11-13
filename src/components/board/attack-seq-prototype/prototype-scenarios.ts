// PROTOTYPE (issue #9500) — REAL scenarios the switcher loads into the current
// game (debugSetupScenario), opened in DECLARE_ATTACKERS so "Attack with all"
// starts the sequence at once. Two identical Grizzly Bears on purpose: the
// banner's name alone cannot tell them apart.
const LANDS = [
    { name: "Forest", owner: "me", zone: "battlefield", count: 3 },
    { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
    { name: "Island", owner: "opp", zone: "battlefield", count: 3 },
    { name: "Swamp", owner: "opp", zone: "battlefield", count: 2 },
];

export type ProtoScenario = { key: string; label: string; spec: unknown };

export const PROTO_SCENARIOS: ProtoScenario[] = [
    {
        key: "5v2pw",
        label: "5 attackers (2x Grizzly Bears) vs Jace + Liliana",
        spec: {
            phase: "DECLARE_ATTACKERS",
            turn: 6,
            cards: [
                ...LANDS,
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Llanowar Elves", owner: "me", zone: "battlefield" },
                { name: "Savannah Lions", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Serra Angel", owner: "me", zone: "battlefield" },
                {
                    name: "Jace, the Mind Sculptor",
                    owner: "opp",
                    zone: "battlefield",
                },
                {
                    name: "Liliana of the Veil",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
        },
    },
    {
        key: "2v1pw",
        label: "2 attackers vs Chandra",
        spec: {
            phase: "DECLARE_ATTACKERS",
            turn: 6,
            cards: [
                ...LANDS,
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Serra Angel", owner: "me", zone: "battlefield" },
                {
                    name: "Chandra, Torch of Defiance",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
        },
    },
];
