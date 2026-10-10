// PROTOTYPE — throwaway. Mock Limited pool + deck, basics with six real
// printings each, and the column/sort logic the builder variants share.
import { PROTO_CARDS, type ProtoCard } from "../proto-cards";

const byName = new Map(PROTO_CARDS.map((c) => [c.name, c]));
const card = (name: string): ProtoCard => {
    const c = byName.get(name);
    if (!c) throw new Error(`proto builder: unknown card ${name}`);
    return c;
};

export const PACK_SOURCE = {
    name: "Vintage Cube",
    featureCardId: card("Black Lotus").id,
};
export const DEFAULT_DECK_NAME = `${PACK_SOURCE.name} Draft`;

/** 23 spells in the deck (UB tempo-reanimator), 22 in the sideboard. */
const DECK_NAMES = [
    "Tamiyo, Inquisitive Student",
    "Faerie Mastermind",
    "Snapcaster Mage",
    "Brazen Borrower",
    "Spellseeker",
    "Subtlety",
    "Dark Confidant",
    "Orcish Bowmasters",
    "Barrowgoyf",
    "Sheoldred, the Apocalypse",
    "Grief",
    "Griselbrand",
    "Brainstorm",
    "Counterspell",
    "Mana Drain",
    "Fatal Push",
    "Infernal Grasp",
    "Demonic Tutor",
    "Hymn to Tourach",
    "Force of Will",
    "Jace, the Mind Sculptor",
    "Liliana of the Veil",
    "Animate Dead",
];
const SIDE_NAMES = [
    "Mother of Runes",
    "Stoneforge Mystic",
    "Ragavan, Nimble Pilferer",
    "Bonecrusher Giant",
    "Swords to Plowshares",
    "Balance",
    "Wrath of God",
    "Lightning Bolt",
    "Chain Lightning",
    "Fireblast",
    "Necropotence",
    "Mox Sapphire",
    "Black Lotus",
    "Maze of Ith",
    "Fact or Fiction",
    "Ponder",
    "Time Walk",
    "Toxic Deluge",
    "Reanimate",
    "Parallax Wave",
    "Bolas's Citadel",
    "Urborg, Tomb of Yawgmoth",
];

export const POOL: ProtoCard[] = [...DECK_NAMES, ...SIDE_NAMES].map(card);
export const INITIAL_DECK = new Set(DECK_NAMES);

/** A small booster for the draft-room fly demo. */
export const DEMO_PACK: ProtoCard[] = [
    "Glorybringer",
    "Counterspell",
    "Skyclave Apparition",
    "Toxic Deluge",
    "Fury",
    "Ponder",
    "Recurring Nightmare",
    "Ledger Shredder",
].map(card);

// ── Basics ─────────────────────────────────────────────────────────────────

export type BasicKey = "W" | "U" | "B" | "R" | "G";
export interface BasicPrinting {
    id: string;
    set: string;
    setName: string;
}
export interface BasicDef {
    key: BasicKey;
    name: string;
    printings: BasicPrinting[];
}

const P = (set: string, id: string, setName: string): BasicPrinting => ({
    set,
    id,
    setName,
});

export const BASICS: BasicDef[] = [
    {
        key: "W",
        name: "Plains",
        printings: [
            P(
                "LEA",
                "b1623d57-4729-4796-b3f7-f1837a05c6ed",
                "Limited Edition Alpha"
            ),
            P("ICE", "7b68bdb0-41cc-48f6-905e-7da1ff4ba5e0", "Ice Age"),
            P("MIR", "888f32ad-3bdd-4c46-b3f0-522ac9763591", "Mirage"),
            P(
                "P02",
                "27ecf285-c48f-4ac3-9b75-0ee0ff052767",
                "Portal Second Age"
            ),
            P("ONS", "7bf7d68a-dbd0-45f3-acbb-59ee38e6057e", "Onslaught"),
            P("8ED", "a37c667a-f035-49b2-9f34-9831e186ae82", "Eighth Edition"),
        ],
    },
    {
        key: "U",
        name: "Island",
        printings: [
            P(
                "LEA",
                "90a57c0e-fa61-45ef-955d-d296403967d5",
                "Limited Edition Alpha"
            ),
            P("ICE", "ef2d6fc9-ddad-4dd2-b218-afa1a5449b7e", "Ice Age"),
            P("MIR", "df84bf1b-8698-4c3e-baa9-926f0efc6a12", "Mirage"),
            P(
                "P02",
                "b0a83b1a-a734-4726-9d14-c75ef04798d1",
                "Portal Second Age"
            ),
            P("ONS", "36e062ec-df51-40c0-ad8a-2ee1cb8f8f17", "Onslaught"),
            P("8ED", "4146a316-c409-4121-931f-1d3b5ae63675", "Eighth Edition"),
        ],
    },
    {
        key: "B",
        name: "Swamp",
        printings: [
            P(
                "LEA",
                "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
                "Limited Edition Alpha"
            ),
            P("ICE", "4695653a-5c4c-4ff3-b80c-f4b6c685f370", "Ice Age"),
            P("MIR", "f2d28477-8be1-4caf-8185-64f47905ccb1", "Mirage"),
            P(
                "P02",
                "80c0bd18-fdee-4cb2-8a7e-dd86bb8a6bbe",
                "Portal Second Age"
            ),
            P("ONS", "0356ae45-e5ca-46b9-8ebc-42bf4776e89c", "Onslaught"),
            P("8ED", "066b5162-8724-4df3-a3d5-274036d0049d", "Eighth Edition"),
        ],
    },
    {
        key: "R",
        name: "Mountain",
        printings: [
            P(
                "LEA",
                "eace2c85-976c-425e-9800-5a6ccbd91b56",
                "Limited Edition Alpha"
            ),
            P("ARN", "c321d0e1-ff30-4424-979b-25e1a33e45d5", "Arabian Nights"),
            P("ICE", "4ecf39c3-3b5f-4263-a7b5-9881bded3494", "Ice Age"),
            P("MIR", "97004cdc-0baf-415d-8e87-7f36667c4628", "Mirage"),
            P(
                "P02",
                "bdfbb15a-d7f4-470a-9d36-78c710a6d397",
                "Portal Second Age"
            ),
            P("ONS", "05f9bdca-0d54-46c7-b803-9083dfc9ee24", "Onslaught"),
        ],
    },
    {
        key: "G",
        name: "Forest",
        printings: [
            P(
                "LEA",
                "6f1c8cb0-38eb-408b-94e8-16db83999b3b",
                "Limited Edition Alpha"
            ),
            P("ICE", "fbdcbd97-90a9-45ea-94f6-2a1c6faaf965", "Ice Age"),
            P("MIR", "a0ae7a81-9a61-4112-af22-369c525b2eb1", "Mirage"),
            P(
                "P02",
                "89f4fcbb-86a8-475f-a547-d59014bb7a98",
                "Portal Second Age"
            ),
            P("ONS", "b361b42d-401f-440a-bae9-35338b5dde0e", "Onslaught"),
            P("8ED", "ac82d07b-f8f2-4cdd-b799-98d4dc228e5c", "Eighth Edition"),
        ],
    },
];

export const INITIAL_BASICS: Record<BasicKey, number> = {
    W: 0,
    U: 9,
    B: 8,
    R: 0,
    G: 0,
};

// ── Grouping & sorting ─────────────────────────────────────────────────────

export type GroupBy = "mv" | "color";
export type SortBy = "color" | "mv" | "name";
export type TypeFilter = "all" | "creatures" | "non-creatures";

/** The coupling the grill decided: the sort is the OTHER axis. */
export const DEFAULT_SORT: Record<GroupBy, SortBy> = {
    mv: "color",
    color: "mv",
};

export interface ColumnDef {
    key: string;
    label: string;
    /** Mana-symbol file name for the header, when the column is a colour. */
    symbol?: string;
}
export interface Column extends ColumnDef {
    cards: ProtoCard[];
}

const MV_COLUMNS: ColumnDef[] = [
    { key: "1", label: "0–1" },
    { key: "2", label: "2" },
    { key: "3", label: "3" },
    { key: "4", label: "4" },
    { key: "5", label: "5" },
    { key: "6", label: "6+" },
];
const COLOR_COLUMNS: ColumnDef[] = [
    { key: "W", label: "White", symbol: "W" },
    { key: "U", label: "Blue", symbol: "U" },
    { key: "B", label: "Black", symbol: "B" },
    { key: "R", label: "Red", symbol: "R" },
    { key: "G", label: "Green", symbol: "G" },
    { key: "M", label: "Multi" },
    { key: "C", label: "Colorless", symbol: "C" },
];
export const LANDS_COLUMN: ColumnDef = { key: "L", label: "Lands" };

export const isCreature = (c: ProtoCard) => c.types.includes("Creature");
export const isLand = (c: ProtoCard) => c.types.includes("Land");

const COLOR_ORDER = "WUBRG";
function colorRank(c: ProtoCard): number {
    if (c.colors.length > 1) return 5;
    if (c.colors.length === 0) return 6;
    return COLOR_ORDER.indexOf(c.colors[0]);
}
function colorKey(c: ProtoCard): string {
    if (c.colors.length > 1) return "M";
    if (c.colors.length === 0) return "C";
    return c.colors[0];
}
function mvKey(c: ProtoCard): string {
    return String(Math.min(6, Math.max(1, c.cmc)));
}

export function compareBy(sort: SortBy) {
    return (a: ProtoCard, b: ProtoCard) => {
        const byColor = colorRank(a) - colorRank(b);
        const byMv = a.cmc - b.cmc;
        const byName = a.name.localeCompare(b.name);
        if (sort === "color") return byColor || byMv || byName;
        if (sort === "mv") return byMv || byColor || byName;
        return byName;
    };
}

export function columnDefs(groupBy: GroupBy): ColumnDef[] {
    return groupBy === "mv" ? MV_COLUMNS : COLOR_COLUMNS;
}

/** Group `cards` into columns. Lands get their own trailing column (they
 *  only ever appear in the non-creature row). `keepEmpty` keeps every
 *  column — the combined MTGO grid needs aligned columns across the divider. */
export function buildColumns(
    cards: ProtoCard[],
    groupBy: GroupBy,
    sortBy: SortBy,
    keepEmpty = false
): Column[] {
    const defs = [...columnDefs(groupBy), LANDS_COLUMN];
    const keyOf = (c: ProtoCard) =>
        isLand(c) ? "L" : groupBy === "mv" ? mvKey(c) : colorKey(c);
    const cols = defs.map((d) => ({
        ...d,
        cards: cards.filter((c) => keyOf(c) === d.key).sort(compareBy(sortBy)),
    }));
    return keepEmpty
        ? cols.filter((c) => c.key !== "L" || c.cards.length > 0)
        : cols.filter((c) => c.cards.length > 0);
}

export const SORT_LABEL: Record<SortBy, string> = {
    color: "Colour",
    mv: "Mana value",
    name: "Name",
};

/** Height of a pile of `n` cards: one full card + (n-1) peeks. Reads the
 *  `--cw` / `--peek` custom properties set by the variant root. */
export function pileHeight(n: number): string {
    if (n <= 0) return "calc(var(--cw) * 0.5)";
    return `calc(var(--cw) * 1.3934 + ${n - 1} * var(--peek))`;
}
