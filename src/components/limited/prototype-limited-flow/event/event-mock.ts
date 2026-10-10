// PROTOTYPE — throwaway. Mock event for the /limited/{id} surface: one
// 8-seat Vintage Cube draft (you + 2 humans + 5 bots) seen at every phase.
import { PROTO_CARDS, protoCard, type ProtoCard } from "../proto-cards";

export type EventPhase =
    | "waiting"
    | "drafting"
    | "building"
    | "playing"
    | "finished";

export const PHASES: { key: EventPhase; label: string; step: string }[] = [
    { key: "waiting", label: "Waiting", step: "Waiting" },
    { key: "drafting", label: "Drafting", step: "Draft" },
    { key: "building", label: "Deckbuilding", step: "Deckbuilding" },
    { key: "playing", label: "Games", step: "Games" },
    { key: "finished", label: "Finished", step: "Done" },
];

export const phaseIndex = (p: EventPhase) =>
    PHASES.findIndex((x) => x.key === p);

export type SeatKind = "human" | "bot" | "empty";

export interface Record3 {
    w: number;
    l: number;
    d: number;
}

export interface StandingRow {
    rank: number;
    seatIndex: number;
    points: number;
    record: Record3;
    games: [number, number];
    gwPct: number;
    omwPct: number;
}

export interface MockSeat {
    seatIndex: number;
    name: string;
    kind: SeatKind;
    isViewer: boolean;
    isCreator: boolean;
    /** Deck colours — known from Deckbuilding on. */
    colors: string[];
    /** Drafting only: picks made / packs waiting (Arena's queued badge). */
    picked: number;
    queued: number;
    /** Deckbuilding: deck submitted. */
    hasDeck: boolean;
    record: Record3 | null;
    placement: number | null;
    deck: ProtoCard[];
    picks: ProtoCard[];
}

export interface Pairing {
    a: number;
    b: number;
    status: "pending" | "live" | "done";
    score?: string;
    source?: "Played" | "Simulated";
}

export const EVENT_META = {
    name: "Vintage Cube Draft",
    source: "Vintage Cube",
    type: "Draft",
    featureCard: protoCard("Black Lotus"),
    gamesFormat: "Best of 3",
    gamesFormatShort: "Bo3",
    seatCount: 8,
    packs: "3 packs × 15",
    pickTimer: "60s pick timer",
    roundDeadline: "50 min rounds",
    rounds: 3,
    currentRound: 2,
    draftPack: 2,
    draftPick: 5,
    pickSecondsLeft: 38,
    poolSize: 45,
    inviteUrl: "tolaria.gg/limited/k7x2q9",
};

/** Pack 1 & 3 pass left, pack 2 passes right (CR-free Arena convention,
 *  mirrors the server's `passDirection`). */
export const passDirectionFor = (pack: number): "left" | "right" =>
    pack === 2 ? "right" : "left";

interface SeatSeed {
    name: string;
    kind: "human" | "bot";
    colors: string[];
    queued: number;
    picked: number;
    hasDeck: boolean;
    gamesRecord: Record3;
    finalRecord: Record3;
    placement: number;
}

const SEEDS: SeatSeed[] = [
    {
        name: "Filippo",
        kind: "human",
        colors: ["U", "B"],
        queued: 2,
        picked: 19,
        hasDeck: false,
        gamesRecord: { w: 1, l: 0, d: 0 },
        finalRecord: { w: 2, l: 1, d: 0 },
        placement: 2,
    },
    {
        name: "Serra",
        kind: "bot",
        colors: ["W", "U"],
        queued: 0,
        picked: 20,
        hasDeck: true,
        gamesRecord: { w: 1, l: 0, d: 0 },
        finalRecord: { w: 2, l: 1, d: 0 },
        placement: 3,
    },
    {
        name: "Hazezon",
        kind: "bot",
        colors: ["R", "W"],
        queued: 1,
        picked: 19,
        hasDeck: true,
        gamesRecord: { w: 0, l: 1, d: 0 },
        finalRecord: { w: 1, l: 2, d: 0 },
        placement: 5,
    },
    {
        name: "Morgana",
        kind: "human",
        colors: ["B", "R"],
        queued: 3,
        picked: 17,
        hasDeck: true,
        gamesRecord: { w: 1, l: 0, d: 0 },
        finalRecord: { w: 3, l: 0, d: 0 },
        placement: 1,
    },
    {
        name: "Jodah",
        kind: "bot",
        colors: ["R"],
        queued: 0,
        picked: 20,
        hasDeck: true,
        gamesRecord: { w: 0, l: 1, d: 0 },
        finalRecord: { w: 1, l: 2, d: 0 },
        placement: 7,
    },
    {
        name: "Teferi_fan",
        kind: "human",
        colors: ["W", "B"],
        queued: 1,
        picked: 18,
        hasDeck: false,
        gamesRecord: { w: 1, l: 0, d: 0 },
        finalRecord: { w: 2, l: 1, d: 0 },
        placement: 4,
    },
    {
        name: "Tetsuo",
        kind: "bot",
        colors: ["U", "R"],
        queued: 0,
        picked: 20,
        hasDeck: true,
        gamesRecord: { w: 0, l: 1, d: 0 },
        finalRecord: { w: 1, l: 2, d: 0 },
        placement: 6,
    },
    {
        name: "Kaysa",
        kind: "bot",
        colors: ["B"],
        queued: 1,
        picked: 19,
        hasDeck: false,
        gamesRecord: { w: 0, l: 1, d: 0 },
        finalRecord: { w: 0, l: 3, d: 0 },
        placement: 8,
    },
];

const BASIC: Record<string, string> = {
    W: "Plains",
    U: "Island",
    B: "Swamp",
    R: "Mountain",
    G: "Forest",
};

const isLand = (c: ProtoCard) => c.types.includes("Land");

function buildDeck(colors: string[], offset: number): ProtoCard[] {
    const fits = PROTO_CARDS.filter(
        (c) =>
            !isLand(c) &&
            c.colors.length > 0 &&
            c.colors.every((x) => colors.includes(x))
    );
    const colorless = PROTO_CARDS.filter(
        (c) => !isLand(c) && c.colors.length === 0
    );
    const spells: ProtoCard[] = [];
    for (let i = 0; spells.length < 21 && i < fits.length; i++)
        spells.push(fits[(i * 3 + offset) % fits.length]);
    spells.push(colorless[offset % colorless.length]);
    spells.push(colorless[(offset + 5) % colorless.length]);
    const uniq = [...new Map(spells.map((c) => [c.name, c])).values()];
    const lands: ProtoCard[] = [];
    for (let i = 0; i < 17; i++)
        lands.push(protoCard(BASIC[colors[i % colors.length]]));
    return [...uniq.sort((a, b) => a.cmc - b.cmc), ...lands];
}

function buildPicks(deck: ProtoCard[], offset: number): ProtoCard[] {
    const nonBasic = deck.filter((c) => !isLand(c));
    const extras = PROTO_CARDS.filter((c) => !isLand(c));
    const out: ProtoCard[] = [];
    for (let i = 0; out.length < 45; i++) {
        out.push(
            i % 2 === 0 && nonBasic[i / 2]
                ? nonBasic[i / 2]
                : extras[(i * 7 + offset) % extras.length]
        );
    }
    return out;
}

/** Waiting phase: you + Morgana + Teferi_fan seated, five open seats. */
const WAITING_TAKEN = new Set([0, 3, 5]);

export function seatsFor(phase: EventPhase, viewerSeated = true): MockSeat[] {
    const pi = phaseIndex(phase);
    return SEEDS.map((s, i) => {
        const deck = buildDeck(s.colors, i * 5);
        const empty =
            phase === "waiting" &&
            (!WAITING_TAKEN.has(i) || (i === 0 && !viewerSeated));
        return {
            seatIndex: i,
            name: empty ? "Open seat" : s.name,
            kind: empty ? "empty" : phase === "waiting" ? "human" : s.kind,
            isViewer: i === 0 && !empty,
            isCreator: i === 0,
            colors: pi >= 2 ? s.colors : [],
            picked: phase === "drafting" ? s.picked : pi > 1 ? 45 : 0,
            queued: phase === "drafting" ? s.queued : 0,
            hasDeck: pi >= 3 || (phase === "building" && s.hasDeck),
            record:
                phase === "playing"
                    ? s.gamesRecord
                    : phase === "finished"
                      ? s.finalRecord
                      : null,
            placement: phase === "finished" ? s.placement : null,
            deck,
            picks: buildPicks(deck, i * 11),
        };
    });
}

export const PAIRINGS_ROUND_2: Pairing[] = [
    { a: 0, b: 3, status: "pending" },
    { a: 1, b: 5, status: "live", score: "1-0" },
    { a: 2, b: 4, status: "done", score: "2-1", source: "Played" },
    { a: 6, b: 7, status: "done", score: "2-0", source: "Simulated" },
];

const STANDINGS_PLAYING: StandingRow[] = [
    {
        rank: 1,
        seatIndex: 3,
        points: 3,
        record: { w: 1, l: 0, d: 0 },
        games: [2, 0],
        gwPct: 1,
        omwPct: 0.33,
    },
    {
        rank: 2,
        seatIndex: 0,
        points: 3,
        record: { w: 1, l: 0, d: 0 },
        games: [2, 1],
        gwPct: 0.67,
        omwPct: 0.33,
    },
    {
        rank: 3,
        seatIndex: 1,
        points: 3,
        record: { w: 1, l: 0, d: 0 },
        games: [2, 1],
        gwPct: 0.67,
        omwPct: 0.33,
    },
    {
        rank: 4,
        seatIndex: 5,
        points: 3,
        record: { w: 1, l: 0, d: 0 },
        games: [2, 1],
        gwPct: 0.67,
        omwPct: 0.33,
    },
    {
        rank: 5,
        seatIndex: 2,
        points: 0,
        record: { w: 0, l: 1, d: 0 },
        games: [1, 2],
        gwPct: 0.33,
        omwPct: 0.67,
    },
    {
        rank: 6,
        seatIndex: 6,
        points: 0,
        record: { w: 0, l: 1, d: 0 },
        games: [1, 2],
        gwPct: 0.33,
        omwPct: 0.67,
    },
    {
        rank: 7,
        seatIndex: 4,
        points: 0,
        record: { w: 0, l: 1, d: 0 },
        games: [1, 2],
        gwPct: 0.33,
        omwPct: 0.67,
    },
    {
        rank: 8,
        seatIndex: 7,
        points: 0,
        record: { w: 0, l: 1, d: 0 },
        games: [0, 2],
        gwPct: 0,
        omwPct: 1,
    },
];

const STANDINGS_FINAL: StandingRow[] = [
    {
        rank: 1,
        seatIndex: 3,
        points: 9,
        record: { w: 3, l: 0, d: 0 },
        games: [6, 1],
        gwPct: 0.86,
        omwPct: 0.56,
    },
    {
        rank: 2,
        seatIndex: 0,
        points: 6,
        record: { w: 2, l: 1, d: 0 },
        games: [5, 3],
        gwPct: 0.63,
        omwPct: 0.67,
    },
    {
        rank: 3,
        seatIndex: 1,
        points: 6,
        record: { w: 2, l: 1, d: 0 },
        games: [4, 3],
        gwPct: 0.57,
        omwPct: 0.56,
    },
    {
        rank: 4,
        seatIndex: 5,
        points: 6,
        record: { w: 2, l: 1, d: 0 },
        games: [4, 3],
        gwPct: 0.57,
        omwPct: 0.44,
    },
    {
        rank: 5,
        seatIndex: 2,
        points: 3,
        record: { w: 1, l: 2, d: 0 },
        games: [3, 4],
        gwPct: 0.43,
        omwPct: 0.56,
    },
    {
        rank: 6,
        seatIndex: 6,
        points: 3,
        record: { w: 1, l: 2, d: 0 },
        games: [3, 5],
        gwPct: 0.38,
        omwPct: 0.44,
    },
    {
        rank: 7,
        seatIndex: 4,
        points: 3,
        record: { w: 1, l: 2, d: 0 },
        games: [2, 4],
        gwPct: 0.33,
        omwPct: 0.44,
    },
    {
        rank: 8,
        seatIndex: 7,
        points: 0,
        record: { w: 0, l: 3, d: 0 },
        games: [1, 6],
        gwPct: 0.14,
        omwPct: 0.67,
    },
];

export const standingsFor = (phase: EventPhase): StandingRow[] =>
    phase === "finished" ? STANDINGS_FINAL : STANDINGS_PLAYING;

export const recordText = (r: Record3 | null) =>
    r ? `${r.w}-${r.l}${r.d ? `-${r.d}` : ""}` : "";

export const seatLabel = (s: MockSeat) =>
    s.kind === "empty" ? "Open seat" : s.name;
