// PROTOTYPE (issue #4433) — throwaway. Fake coin-flip sequences fed to the
// Random Reveal variants. Never merged; lives on prototype/issue-4433-coin-flip.

export type Seat = "you" | "opp";

export type ProtoFlip = {
    flipper: Seat;
    face: "heads" | "tails";
    /** CR 705.2 — null for a face-only flip (Mana Clash): nobody wins/loses. */
    outcome: "win" | "lose" | null;
};

/** One round = the flips that happen together (1 coin, or 2 for Mana Clash). */
export type ProtoRound = ProtoFlip[];

export type ProtoScenario = {
    key: string;
    label: string;
    sourceName: string;
    /** Card definition id = Scryfall print id (art crop + mana cost). */
    sourceId: string;
    /** Stack-row kind label: "Triggered ability", "Sorcery", … */
    sourceKind: string;
    sourceController: Seat;
    oracleExcerpt: string;
    /** Who acknowledges (the flipper of a one-player flip; the controller otherwise). */
    acker: Seat;
    rounds: ProtoRound[];
    /** Squee's Revenge: the chosen number — slots past the stop render as unflipped. */
    plannedRounds?: number;
    stopNote?: string;
    consequence: string;
};

const W = (flipper: Seat = "you"): ProtoFlip => ({
    flipper,
    face: "heads",
    outcome: "win",
});
const L = (flipper: Seat = "you"): ProtoFlip => ({
    flipper,
    face: "tails",
    outcome: "lose",
});
const clashRound = (you: "H" | "T", opp: "H" | "T"): ProtoRound => [
    { flipper: "you", face: you === "H" ? "heads" : "tails", outcome: null },
    { flipper: "opp", face: opp === "H" ? "heads" : "tails", outcome: null },
];

const LONG_CLASH: Array<["H" | "T", "H" | "T"]> = [
    ["T", "H"],
    ["H", "T"],
    ["T", "T"],
    ["H", "T"],
    ["T", "T"],
    ["T", "H"],
    ["H", "T"],
    ["T", "T"],
    ["T", "H"],
    ["H", "T"],
    ["H", "H"],
];

export const SCENARIOS: ProtoScenario[] = [
    {
        key: "crypt",
        label: "Mana Crypt — you win",
        sourceName: "Mana Crypt",
        sourceId: "160cf235-6463-4e16-a426-8b5be76b10d2",
        sourceKind: "Triggered ability",
        sourceController: "you",
        oracleExcerpt:
            "At the beginning of your upkeep, flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.",
        acker: "you",
        rounds: [[W()]],
        consequence: "No damage.",
    },
    {
        key: "crypt-bot",
        label: "Mana Crypt (Bot's) — Bot loses",
        sourceName: "Mana Crypt",
        sourceId: "160cf235-6463-4e16-a426-8b5be76b10d2",
        sourceKind: "Triggered ability",
        sourceController: "opp",
        oracleExcerpt:
            "At the beginning of your upkeep, flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.",
        acker: "opp",
        rounds: [[L("opp")]],
        consequence: "Mana Crypt deals 3 damage to Bot.",
    },
    {
        key: "squee",
        label: "Squee's Revenge — chose 6, W W W L",
        sourceName: "Squee's Revenge",
        sourceId: "2b391ee3-c1cd-47bc-9540-977cbc32913e",
        sourceKind: "Sorcery",
        sourceController: "you",
        oracleExcerpt:
            "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
        acker: "you",
        rounds: [[W()], [W()], [W()], [L()]],
        plannedRounds: 6,
        stopNote: "Lost a flip — series stops",
        consequence: "You didn't win all the flips — no cards drawn.",
    },
    {
        key: "squee-all",
        label: "Squee's Revenge — chose 6, all won",
        sourceName: "Squee's Revenge",
        sourceId: "2b391ee3-c1cd-47bc-9540-977cbc32913e",
        sourceKind: "Sorcery",
        sourceController: "you",
        oracleExcerpt:
            "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.",
        acker: "you",
        rounds: [[W()], [W()], [W()], [W()], [W()], [W()]],
        plannedRounds: 6,
        consequence: "You won all 6 flips — draw 12 cards.",
    },
    {
        key: "clash",
        label: "Mana Clash — 4 rounds",
        sourceName: "Mana Clash",
        sourceId: "72955141-d990-459f-adbe-7d3d0f5f6c95",
        sourceKind: "Sorcery",
        sourceController: "you",
        oracleExcerpt:
            "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.",
        acker: "you",
        rounds: [
            clashRound("T", "H"),
            clashRound("H", "T"),
            clashRound("T", "T"),
            clashRound("H", "H"),
        ],
        stopNote: "Both heads — stop",
        consequence: "4 rounds — you take 2 damage, Bot takes 2.",
    },
    {
        key: "clash-long",
        label: "Mana Clash — 11 rounds",
        sourceName: "Mana Clash",
        sourceId: "72955141-d990-459f-adbe-7d3d0f5f6c95",
        sourceKind: "Sorcery",
        sourceController: "you",
        oracleExcerpt:
            "You and target opponent each flip a coin. Mana Clash deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.",
        acker: "you",
        rounds: LONG_CLASH.map(([a, b]) => clashRound(a, b)),
        stopNote: "Both heads — stop",
        consequence: "11 rounds — you take 6 damage, Bot takes 6.",
    },
];

export function seatName(seat: Seat): string {
    return seat === "you" ? "You" : "Bot";
}

/** Face label on a landed coin: WIN/LOSE for a called flip, HEADS/TAILS otherwise. */
export function faceLabel(flip: ProtoFlip): string {
    if (flip.outcome === "win") return "WIN";
    if (flip.outcome === "lose") return "LOSE";
    return flip.face === "heads" ? "HEADS" : "TAILS";
}

export function isGood(flip: ProtoFlip): boolean {
    return flip.outcome ? flip.outcome === "win" : flip.face === "heads";
}

/** Viewer-relative flipper line for the overlay header. */
export function flipperLine(s: ProtoScenario, done = true): string {
    const seats = new Set(s.rounds.flat().map((f) => f.flipper));
    if (seats.size > 1) return "You and Bot each flip a coin";
    const only = [...seats][0];
    const n = s.rounds.length;
    const verb = only === "you" ? "You flip" : "Bot flips";
    return n > 1
        ? done
            ? `${verb} a coin ×${n}`
            : `${verb} coins…`
        : `${verb} a coin`;
}
