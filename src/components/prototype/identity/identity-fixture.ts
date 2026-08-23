// PROTOTYPE — throwaway (branch prototype/identity-v4). Static fixture of real
// Scryfall print ids from data/card-index.json so the skin is judged against
// real art, not placeholders.

export type FixtureColor = "W" | "U" | "B" | "R" | "G" | "C" | "L" | "M";

export interface FixtureCard {
    id: string;
    name: string;
    type: string;
    color: FixtureColor;
    cost?: string[]; // mana symbols, e.g. ["1","R"]
    pt?: string;
    tapped?: boolean;
    sick?: boolean;
    playable?: boolean;
    targetable?: boolean;
    attacking?: boolean;
}

export const ID = {
    jackalPup: "3707ab74-9aec-4d30-86e0-ffa5f72d5b4f",
    moggFanatic: "ca2ecfd4-c874-4468-8601-87aa110d5a00",
    bolt: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    fireblast: "b1eb5b2c-1f02-48a6-a287-88eb189d6780",
    mountain: "eace2c85-976c-425e-9800-5a6ccbd91b56",
    ballLightning: "c1ba83ab-83f5-421d-bba1-0f925870b5c8",
    cursedScroll: "31415b9b-fb30-4132-a9a3-795b4573a901",
    serra: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    swords: "386ea9eb-abc1-4862-aa2d-8fb808d79490",
    counterspell: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    island: "90a57c0e-fa61-45ef-955d-d296403967d5",
    plains: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    wrath: "a2788d69-6a3a-42f0-8736-cc6b57755ecd",
    tundra: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb",
    fof: "7fd4d018-dcf3-4439-8445-02d66e44f7d3",
    fow: "9a879b60-4381-447d-8a5a-8e0b6a1d49ca",
    brainstorm: "8d42d7aa-7f53-4cfc-842a-086aab2448d1",
    wasteland: "99ff731b-8399-40c8-b539-ba6ba5783771",
    sylvan: "f486df00-7c4a-4ff0-bb0b-c8b5432ac742",
    llanowar: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb",
    factory: "a696c5b6-f216-454d-8029-74e84bbd1428",
    shivan: "fefbf149-f988-4f8b-9f53-56f5878116a6",
    lotus: "b0faa7f2-b547-42c4-a810-839da50dadfe",
    ancestral: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b",
    timeWalk: "e0139f60-d48e-46fb-9f5a-1e3d7558c834",
    solRing: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd",
    juzam: "31bf3f14-b5df-498b-a1bb-965885c82401",
    hyppie: "b43b900f-2d9b-442b-9699-058483604ec9",
    erhnam: "42bc0c3f-0a52-4bdc-83da-6484bf3102f3",
    meddling: "176f84c6-aa5e-449c-bd2b-cc91a898f0c7",
    ftk: "e5056bca-bd90-4b50-8630-105558f8ef92",
    cradle: "25b0b816-0583-44aa-9dc5-f3ff48993a51",
    kird: "ebe8845e-df1c-481c-949c-aab84af99a05",
    incinerate: "9c3f00af-010d-4485-b8b7-47400d99c496",
    volcanic: "0324641d-af55-4c53-b4dc-c8262e967da5",
    foothills: "cdad38f7-9dfa-4f1b-9fac-41ab2b253f53",
    forest: "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
    swamp: "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
    ritual: "ebb6664d-23ca-456e-9916-afcd6f26aa7f",
    duress: "ca367f49-0f4a-4b7f-8104-851893fbcd8a",
    moxPearl: "8ebe4be7-e12a-4596-a899-fbd5b152e879",
    greaves: "61a28870-cf78-4323-9d82-cee764067764",
} as const;

export interface FixtureDeck {
    name: string;
    featured: string;
    colors: FixtureColor[];
    cards: number;
    format: string;
    archetype: string;
}

export const DECKS: FixtureDeck[] = [
    {
        name: "Sligh",
        featured: ID.ballLightning,
        colors: ["R"],
        cards: 60,
        format: "Premodern",
        archetype: "Aggro",
    },
    {
        name: "The Deck",
        featured: ID.serra,
        colors: ["W", "U"],
        cards: 60,
        format: "Old School",
        archetype: "Control",
    },
    {
        name: "Stompy",
        featured: ID.cradle,
        colors: ["G"],
        cards: 60,
        format: "Premodern",
        archetype: "Aggro",
    },
    {
        name: "Suicide Black",
        featured: ID.juzam,
        colors: ["B"],
        cards: 60,
        format: "Old School",
        archetype: "Aggro",
    },
    {
        name: "Draw-Go",
        featured: ID.fow,
        colors: ["U"],
        cards: 60,
        format: "Premodern",
        archetype: "Control",
    },
    {
        name: "Zoo",
        featured: ID.kird,
        colors: ["R", "G", "W"],
        cards: 60,
        format: "Premodern",
        archetype: "Aggro",
    },
    {
        name: "Reanimator",
        featured: ID.hyppie,
        colors: ["B", "U"],
        cards: 60,
        format: "Premodern",
        archetype: "Combo",
    },
    {
        name: "Dragon Cube",
        featured: ID.shivan,
        colors: ["R", "U", "G"],
        cards: 40,
        format: "Limited",
        archetype: "Draft",
    },
];

export const PRESETS: FixtureDeck[] = [
    {
        name: "Power Nine",
        featured: ID.lotus,
        colors: ["M"],
        cards: 60,
        format: "Vintage",
        archetype: "Showcase",
    },
    {
        name: "Elves",
        featured: ID.llanowar,
        colors: ["G"],
        cards: 60,
        format: "Premodern",
        archetype: "Combo",
    },
    {
        name: "Burn",
        featured: ID.fireblast,
        colors: ["R"],
        cards: 60,
        format: "Premodern",
        archetype: "Aggro",
    },
    {
        name: "Meddling Mage",
        featured: ID.meddling,
        colors: ["W", "U"],
        cards: 60,
        format: "Premodern",
        archetype: "Tempo",
    },
];

export const LIMITED_EVENTS = [
    {
        name: "Limited Edition Alpha · Draft",
        seats: "6/8",
        status: "Drafting",
        featured: ID.serra,
    },
    {
        name: "Vintage Cube · Draft",
        seats: "8/8",
        status: "Pick 4 / 15",
        featured: ID.timeWalk,
    },
    {
        name: "Arabian Nights · Sealed",
        seats: "2/8",
        status: "Open",
        featured: ID.erhnam,
    },
];

// ---- Board fixture ------------------------------------------------------

export const OPP_LANDS: FixtureCard[] = [
    { id: ID.tundra, name: "Tundra", type: "Land", color: "L", tapped: true },
    {
        id: ID.island,
        name: "Island",
        type: "Basic Land",
        color: "L",
        tapped: true,
    },
    {
        id: ID.island,
        name: "Island",
        type: "Basic Land",
        color: "L",
        tapped: true,
    },
    { id: ID.plains, name: "Plains", type: "Basic Land", color: "L" },
    { id: ID.factory, name: "Mishra's Factory", type: "Land", color: "L" },
];
export const OPP_PERMS: FixtureCard[] = [
    {
        id: ID.serra,
        name: "Serra Angel",
        type: "Creature — Angel",
        color: "W",
        pt: "4/4",
        targetable: true,
    },
    {
        id: ID.meddling,
        name: "Meddling Mage",
        type: "Creature — Human Wizard",
        color: "M",
        pt: "2/2",
        targetable: true,
    },
    {
        id: ID.moxPearl,
        name: "Mox Pearl",
        type: "Artifact",
        color: "C",
        tapped: true,
    },
    { id: ID.solRing, name: "Sol Ring", type: "Artifact", color: "C" },
];
export const OWN_PERMS: FixtureCard[] = [
    {
        id: ID.jackalPup,
        name: "Jackal Pup",
        type: "Creature — Hound",
        color: "R",
        pt: "2/1",
        attacking: true,
    },
    {
        id: ID.moggFanatic,
        name: "Mogg Fanatic",
        type: "Creature — Goblin",
        color: "R",
        pt: "1/1",
    },
    {
        id: ID.ballLightning,
        name: "Ball Lightning",
        type: "Creature — Elemental",
        color: "R",
        pt: "6/1",
        sick: true,
    },
    {
        id: ID.cursedScroll,
        name: "Cursed Scroll",
        type: "Artifact",
        color: "C",
    },
];
export const OWN_LANDS: FixtureCard[] = [
    {
        id: ID.mountain,
        name: "Mountain",
        type: "Basic Land",
        color: "L",
        tapped: true,
    },
    {
        id: ID.mountain,
        name: "Mountain",
        type: "Basic Land",
        color: "L",
        tapped: true,
    },
    { id: ID.mountain, name: "Mountain", type: "Basic Land", color: "L" },
    { id: ID.foothills, name: "Wooded Foothills", type: "Land", color: "L" },
    { id: ID.wasteland, name: "Wasteland", type: "Land", color: "L" },
];
export const HAND: FixtureCard[] = [
    {
        id: ID.bolt,
        name: "Lightning Bolt",
        type: "Instant",
        color: "R",
        cost: ["R"],
        playable: true,
    },
    {
        id: ID.fireblast,
        name: "Fireblast",
        type: "Instant",
        color: "R",
        cost: ["4", "R", "R"],
    },
    {
        id: ID.incinerate,
        name: "Incinerate",
        type: "Instant",
        color: "R",
        cost: ["1", "R"],
        playable: true,
    },
    { id: ID.mountain, name: "Mountain", type: "Basic Land", color: "L" },
    {
        id: ID.kird,
        name: "Kird Ape",
        type: "Creature — Ape",
        color: "R",
        cost: ["R"],
    },
    {
        id: ID.ftk,
        name: "Flametongue Kavu",
        type: "Creature — Kavu",
        color: "R",
        cost: ["3", "R"],
    },
    {
        id: ID.greaves,
        name: "Lightning Greaves",
        type: "Artifact — Equipment",
        color: "C",
        cost: ["2"],
    },
];
export const STACK: {
    card: FixtureCard;
    owner: "you" | "opp";
    note: string;
}[] = [
    {
        card: {
            id: ID.counterspell,
            name: "Counterspell",
            type: "Instant",
            color: "U",
            cost: ["U", "U"],
        },
        owner: "opp",
        note: "targets Lightning Bolt",
    },
    {
        card: {
            id: ID.bolt,
            name: "Lightning Bolt",
            type: "Instant",
            color: "R",
            cost: ["R"],
        },
        owner: "you",
        note: "targets Serra Angel",
    },
];
export const GRAVEYARD_TOP = ID.swords;
export const AVATARS = { you: ID.fireblast, opp: ID.brainstorm };
