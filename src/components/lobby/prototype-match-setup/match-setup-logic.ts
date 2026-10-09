// PROTOTYPE — throwaway (prototype/match-setup-wizard). Question: what should
// the Constructed match-setup flow look like? Three variants on /lobby via
// ?variant=A|B|C. Never merge this directory into base.

import { FORMAT_IDS, FORMAT_RULES, type FormatId } from "@convex/formats";
import type { Difficulty } from "@convex/gre";
import type { LobbyDeck } from "~/lib/deckTypes";

export type GameMode = "arena" | "cockatrice";
export type Opponent = "bot" | "solo" | "host" | "join";
export type GamesFormat = 1 | 3;

/** Every choice of the flow. `null` = not chosen yet. Persisted whole to
 *  localStorage so the next visit re-opens on the last setup. */
export interface MatchSetup {
    mode: GameMode | null;
    opponent: Opponent | null;
    matchFormat: FormatId | null;
    gamesFormat: GamesFormat;
    myDeckId: string | null;
    /** null + opponentDeckChosen = mirror. */
    opponentDeckId: string | null;
    opponentDeckChosen: boolean;
    difficulty: Difficulty;
    joinTableId: string | null;
    joinTableFormat: FormatId | null;
}

export const EMPTY_SETUP: MatchSetup = {
    mode: null,
    opponent: null,
    matchFormat: null,
    gamesFormat: 1,
    myDeckId: null,
    opponentDeckId: null,
    opponentDeckChosen: false,
    difficulty: "medium",
    joinTableId: null,
    joinTableFormat: null,
};

const STORAGE_KEY = "prototype:matchSetup";

export function loadSetup(): MatchSetup {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...EMPTY_SETUP, ...JSON.parse(raw) } : EMPTY_SETUP;
    } catch {
        return EMPTY_SETUP;
    }
}

export function saveSetup(setup: MatchSetup): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
    } catch {
        /* prototype: ignore */
    }
}

/** Formats offered at step 3 (Arena). Limited lives in its own branch,
 *  Manual is Cockatrice's implicit Match Format. */
export const ARENA_MATCH_FORMATS: FormatId[] = FORMAT_IDS.filter(
    (f) => f !== "limited" && f !== "manual"
);

export const formatLabel = (f: FormatId): string => FORMAT_RULES[f].label;

/** The Match Format actually in force: Cockatrice forces Manual, a join
 *  inherits the host's. */
export function effectiveMatchFormat(s: MatchSetup): FormatId | null {
    if (s.mode === "cockatrice") return "manual";
    if (s.opponent === "join") return s.joinTableFormat;
    return s.matchFormat;
}

/** Match Format admission (grilled 2026-10-09): same Format, or Freeform
 *  admits every playable deck. */
export function deckAdmitted(deck: LobbyDeck, matchFormat: FormatId): boolean {
    if (matchFormat === "freeform") return deck.format !== "manual";
    return deck.format === matchFormat;
}

/** Case-insensitive substring over the deck name and every card name. */
export function deckMatchesQuery(deck: LobbyDeck, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (deck.name.toLowerCase().includes(q)) return true;
    return [...deck.cards, ...(deck.sideboard ?? [])].some((c) =>
        c.cardName.toLowerCase().includes(q)
    );
}

/** The first card name that matched (not the deck name) — shown under the
 *  tile so the player sees WHY a deck surfaced. */
export function matchedCardName(deck: LobbyDeck, query: string): string | null {
    const q = query.trim().toLowerCase();
    if (!q || deck.name.toLowerCase().includes(q)) return null;
    return (
        [...deck.cards, ...(deck.sideboard ?? [])].find((c) =>
            c.cardName.toLowerCase().includes(q)
        )?.cardName ?? null
    );
}

export type StepKey =
    | "mode"
    | "opponent"
    | "table"
    | "format"
    | "myDeck"
    | "opponentDeck";

export interface StepInfo {
    key: StepKey;
    title: string;
    /** One-line summary of the choice, null while unanswered. */
    summary: string | null;
}

const OPPONENT_LABEL: Record<Opponent, string> = {
    bot: "vs Bot",
    solo: "Solo (both seats)",
    host: "Host a table",
    join: "Join a table",
};

export const opponentLabel = (o: Opponent) => OPPONENT_LABEL[o];

/** The steps this setup walks, in order — the branches drop steps:
 *  Cockatrice skips the Match Format, Join swaps it for the table list,
 *  only Bot / Solo choose a second deck. */
export function stepsFor(s: MatchSetup, decks: LobbyDeck[]): StepInfo[] {
    const deckName = (id: string | null) =>
        decks.find((d) => d.presetId === id)?.name ?? null;
    const steps: StepInfo[] = [
        {
            key: "mode",
            title: "Game mode",
            summary: s.mode === null ? null : s.mode === "arena" ? "Arena" : "Cockatrice",
        },
        {
            key: "opponent",
            title: "Opponent",
            summary: s.opponent === null ? null : OPPONENT_LABEL[s.opponent],
        },
    ];
    if (s.opponent === "join") {
        steps.push({
            key: "table",
            title: "Table",
            summary: s.joinTableId ? "Table picked" : null,
        });
    } else if (s.mode === "arena") {
        steps.push({
            key: "format",
            title: "Match Format",
            summary:
                s.matchFormat === null
                    ? null
                    : `${formatLabel(s.matchFormat)} · Bo${s.gamesFormat}`,
        });
    }
    steps.push({
        key: "myDeck",
        title: "Your deck",
        summary: deckName(s.myDeckId),
    });
    if (s.opponent === "bot" || s.opponent === "solo") {
        steps.push({
            key: "opponentDeck",
            title: s.opponent === "bot" ? "Bot deck & difficulty" : "Second seat deck",
            summary: !s.opponentDeckChosen
                ? null
                : `${deckName(s.opponentDeckId) ?? "Mirror"}${
                      s.opponent === "bot" ? ` · ${s.difficulty}` : ""
                  }`,
        });
    }
    return steps;
}

/** Index of the first unanswered step; steps.length when all are done. */
export function firstOpenStep(steps: StepInfo[]): number {
    const i = steps.findIndex((s) => s.summary === null);
    return i === -1 ? steps.length : i;
}

/** Clearing everything downstream of a change keeps a stale deck from
 *  surviving a Match Format switch. */
export function withChange(
    s: MatchSetup,
    patch: Partial<MatchSetup>,
    decks: LobbyDeck[]
): MatchSetup {
    const next = { ...s, ...patch };
    if (patch.mode !== undefined && patch.mode !== s.mode) {
        next.opponent = null;
        next.joinTableId = null;
    }
    if (next.mode === "cockatrice" && next.opponent === "bot")
        next.opponent = null;
    const mf = effectiveMatchFormat(next);
    const stillAdmitted = (id: string | null) => {
        const d = decks.find((x) => x.presetId === id);
        return !!d && mf !== null && deckAdmitted(d, mf);
    };
    if (next.myDeckId && !stillAdmitted(next.myDeckId)) next.myDeckId = null;
    if (next.opponentDeckId && !stillAdmitted(next.opponentDeckId)) {
        next.opponentDeckId = null;
        next.opponentDeckChosen = false;
    }
    return next;
}

/** What the real flow would send to the server — rendered, not sent. */
export function payloadPreview(s: MatchSetup): Record<string, unknown> {
    return {
        mutation:
            s.opponent === "join"
                ? "joinGame"
                : s.opponent === "host"
                  ? s.mode === "cockatrice"
                      ? "createManualGame"
                      : "createGame"
                  : s.mode === "cockatrice"
                    ? "createManualSoloGame"
                    : "createSoloGame",
        matchFormat: effectiveMatchFormat(s),
        gamesFormat: s.gamesFormat,
        deck: s.myDeckId,
        ...(s.opponent === "bot" || s.opponent === "solo"
            ? { deck2: s.opponentDeckId ?? "(mirror)" }
            : {}),
        ...(s.opponent === "bot" ? { vsAi: true, difficulty: s.difficulty } : {}),
        ...(s.opponent === "join" ? { gameId: s.joinTableId } : {}),
    };
}
