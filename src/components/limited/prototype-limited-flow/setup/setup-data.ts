// PROTOTYPE — throwaway. Mock Pack Sources + setup state for /limited/new.
import { getArtCropImageUrl } from "~/lib/images";
import { protoCard } from "../proto-cards";

export type EventType = "draft" | "sealed";
export type GamesFormat = "bo1" | "bo3";

export interface PackSource {
    id: string;
    name: string;
    codes: string;
    feature: string;
    /** Implemented percentage of the pool. */
    pct: number;
    missing: number;
    cube?: boolean;
    cubeCards?: number;
    blurb: string;
}

export const SOURCES: PackSource[] = [
    {
        id: "vintage-cube",
        name: "Vintage Cube",
        codes: "CUBE",
        feature: "Black Lotus",
        pct: 88,
        missing: 48,
        cube: true,
        cubeCards: 372,
        blurb: "Singleton power: one copy of every card, 360 cards dealt across the table.",
    },
    {
        id: "lea",
        name: "Limited Edition Alpha",
        codes: "LEA",
        feature: "Mox Sapphire",
        pct: 100,
        missing: 0,
        blurb: "The original 1993 set, rares and all.",
    },
    {
        id: "ice",
        name: "Ice Age",
        codes: "ICE",
        feature: "Necropotence",
        pct: 97,
        missing: 6,
        blurb: "Snow, cumulative upkeep and a very cold meta.",
    },
    {
        id: "drk",
        name: "The Dark",
        codes: "DRK",
        feature: "Maze of Ith",
        pct: 100,
        missing: 0,
        blurb: "Slow, grindy and surprisingly deep.",
    },
    {
        id: "inv",
        name: "Invasion",
        codes: "INV",
        feature: "Fact or Fiction",
        pct: 94,
        missing: 11,
        blurb: "Multicolour gold cards and kicker.",
    },
    {
        id: "inv-block",
        name: "Invasion Block",
        codes: "INV · PLS · APC",
        feature: "Dromar, the Banisher",
        pct: 91,
        missing: 29,
        blurb: "Three packs, three sets: INV, then Planeshift, then Apocalypse.",
    },
];

export const artOf = (s: PackSource) =>
    getArtCropImageUrl(protoCard(s.feature).id);
export const artOfCard = (name: string) =>
    getArtCropImageUrl(protoCard(name).id);

export interface SetupState {
    type: EventType;
    sourceId: string;
    seats: number;
    timer: boolean;
    gamesFormat: GamesFormat;
    deadline: boolean;
    deadlineMin: number;
    boosters: number;
    openDecklists: boolean;
}

export const FIRST_VISIT: SetupState = {
    type: "draft",
    sourceId: "vintage-cube",
    seats: 8,
    timer: true,
    gamesFormat: "bo3",
    deadline: false,
    deadlineMin: 50,
    boosters: 6,
    openDecklists: false,
};

/** What localStorage "last choices" would hold for a returning user. */
export const RETURNING: SetupState = {
    ...FIRST_VISIT,
    type: "sealed",
    sourceId: "inv-block",
    seats: 6,
    boosters: 6,
};

export const sourceOf = (id: string) =>
    SOURCES.find((s) => s.id === id) ?? SOURCES[0];

/** Cube is Draft-only (ADR 0062). */
export const selectable = (s: PackSource, type: EventType) =>
    !(s.cube && type === "sealed");

export const SEAT_RANGE = [2, 3, 4, 5, 6, 7, 8];

export function packMeta(s: PackSource, st: SetupState): string {
    if (st.type === "sealed") return `${st.boosters} boosters per seat`;
    return s.id === "inv-block"
        ? "3 packs · INV, PLS, APC"
        : "15-card packs ×3";
}

export function typeLabel(t: EventType) {
    return t === "draft" ? "Draft" : "Sealed";
}

export function tableSummary(st: SetupState): string {
    const parts = [
        `${st.seats} seats`,
        st.gamesFormat === "bo3" ? "Bo3" : "Bo1",
    ];
    if (st.type === "draft") parts.push(st.timer ? "Timer on" : "No timer");
    if (st.openDecklists) parts.push("Open decklists");
    return parts.join(" · ");
}
