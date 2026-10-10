// The Constructed setup flow's logic (PRD #5334, ADR 0153, issue #5340).
//
// PURE — no React, no Convex client: the setup state, the steps a state
// walks, change propagation, the effective Match Format, persistence and the
// Start request are all decided here, so the recap rail and the step bodies
// only render what this module says. The server re-checks every seat against
// the Match Format on create and join (`isDeckAdmitted`); this is the client's
// mirror of that rule, never its authority (ADR 0074).
import type { Id } from "@convex/_generated/dataModel";
import {
    FORMAT_IDS,
    FORMAT_LABELS,
    isFormatId,
    type FormatId,
} from "@convex/formats";
import {
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    type Difficulty,
} from "@convex/gre/difficulty";
import {
    deckPayload,
    filterDecksAdmittedBy,
    selectPreset,
    type LobbyDeck,
} from "./deckTypes";
import type { GamesFormat } from "./session";

export type GameMode = "arena" | "cockatrice";
export type Opponent = "bot" | "solo" | "host" | "join";

/** Every choice of the flow; `null` = not chosen yet. Persisted whole, so the
 *  next visit re-opens on the last setup (PRD #5334 story 49). */
export interface MatchSetup {
    mode: GameMode | null;
    opponent: Opponent | null;
    matchFormat: FormatId | null;
    gamesFormat: GamesFormat;
    myDeckId: string | null;
    /** `null` with `opponentDeckChosen` = Mirror (the Bot or second seat
     *  plays the player's own deck — `createSoloGame` without `deck2`). */
    opponentDeckId: string | null;
    opponentDeckChosen: boolean;
    difficulty: Difficulty;
    joinTableId: string | null;
    joinTableFormat: FormatId | null;
}

/** The setup a first visit opens on. Mirror is the default second deck. */
export const EMPTY_SETUP: MatchSetup = {
    mode: null,
    opponent: null,
    matchFormat: null,
    gamesFormat: 1,
    myDeckId: null,
    opponentDeckId: null,
    opponentDeckChosen: true,
    difficulty: DEFAULT_DIFFICULTY,
    joinTableId: null,
    joinTableFormat: null,
};

const GAME_MODES: readonly GameMode[] = ["arena", "cockatrice"];

/** The opponents step 2 offers today. Join a table lands with its own step
 *  (the table list); until then a stored `join` loads as unanswered rather
 *  than opening a step with nothing to pick. */
export const OFFERED_OPPONENTS: readonly Opponent[] = ["bot", "solo", "host"];

/** The Match Formats step 3 offers: every playable Format. Limited has its own
 *  branch (`/limited`); Manual is Cockatrice's implicit Match Format. */
export const ARENA_MATCH_FORMATS: readonly FormatId[] = FORMAT_IDS.filter(
    (f) => f !== "limited" && f !== "manual"
);

/** The Match Format actually in force: Cockatrice is always Manual, a join
 *  inherits the host's, otherwise the one step 3 chose. */
export function effectiveMatchFormat(s: MatchSetup): FormatId | null {
    if (s.mode === "cockatrice") return "manual";
    if (s.opponent === "join") return s.joinTableFormat;
    return s.matchFormat;
}

/** The Bot cannot play a Manual deck (ADR 0080), so Cockatrice has no Bot. */
export function opponentUnavailableReason(
    mode: GameMode | null,
    opponent: Opponent
): string | null {
    return mode === "cockatrice" && opponent === "bot"
        ? "Not in Cockatrice — the Bot cannot play Manual decks"
        : null;
}

export type StepKey =
    | "mode"
    | "opponent"
    | "table"
    | "format"
    | "myDeck"
    | "opponentDeck";

/**
 * The steps this setup walks, in order. Branches drop steps: Cockatrice has
 * no Match Format step (it is Manual), Join swaps it for the table list (the
 * host's Match Format is inherited), only Bot and Solo choose a second deck.
 */
export function stepsFor(s: MatchSetup): StepKey[] {
    const steps: StepKey[] = ["mode", "opponent"];
    if (s.opponent === "join") steps.push("table");
    else if (s.mode !== "cockatrice") steps.push("format");
    steps.push("myDeck");
    if (s.opponent === "bot" || s.opponent === "solo") {
        steps.push("opponentDeck");
    }
    return steps;
}

const MODE_LABEL: Record<GameMode, string> = {
    arena: "Arena",
    cockatrice: "Cockatrice",
};

const OPPONENT_LABEL: Record<Opponent, string> = {
    bot: "Bot",
    solo: "Solo (both seats)",
    host: "Host a table",
    join: "Join a table",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    expert: "Expert",
};

export const modeLabel = (m: GameMode): string => MODE_LABEL[m];
export const opponentLabel = (o: Opponent): string => OPPONENT_LABEL[o];

/** A deck the setup may still use: it exists, the Match Format admits it and
 *  it is legal for its own Format — an illegal deck is shown in the grid but
 *  never selectable (story 34), so a remembered one reads as unanswered
 *  rather than enabling a Start the server would refuse. */
function admittedDeck(
    s: MatchSetup,
    id: string | null,
    decks: readonly LobbyDeck[]
): LobbyDeck | null {
    const mf = effectiveMatchFormat(s);
    if (mf === null) return null;
    const deck = selectPreset(decks, id);
    if (!deck?.isLegal) return null;
    return filterDecksAdmittedBy([deck], mf).length > 0 ? deck : null;
}

export interface StepInfo {
    key: StepKey;
    title: string;
    /** The answer as the recap rail shows it; `null` while unanswered. */
    answer: string | null;
}

/** One step's title and current answer, as the recap rail renders it. */
export function stepInfo(
    s: MatchSetup,
    key: StepKey,
    decks: readonly LobbyDeck[]
): StepInfo {
    switch (key) {
        case "mode":
            return {
                key,
                title: "Game mode",
                answer: s.mode && MODE_LABEL[s.mode],
            };
        case "opponent":
            return {
                key,
                title: "Opponent",
                answer: s.opponent && OPPONENT_LABEL[s.opponent],
            };
        case "table":
            return {
                key,
                title: "Table",
                answer: s.joinTableId === null ? null : "Table picked",
            };
        case "format":
            return {
                key,
                title: "Match Format",
                answer:
                    s.matchFormat &&
                    `${FORMAT_LABELS[s.matchFormat]} · Bo${s.gamesFormat}`,
            };
        case "myDeck":
            return {
                key,
                title: "Your deck",
                answer: admittedDeck(s, s.myDeckId, decks)?.name ?? null,
            };
        case "opponentDeck": {
            const deckName = !s.opponentDeckChosen
                ? null
                : s.opponentDeckId === null
                  ? "Mirror"
                  : (admittedDeck(s, s.opponentDeckId, decks)?.name ?? null);
            const bot = s.opponent === "bot";
            return {
                key,
                title: bot ? "Bot deck & difficulty" : "Second seat deck",
                answer:
                    deckName &&
                    (bot
                        ? `${deckName} · ${DIFFICULTY_LABEL[s.difficulty]}`
                        : deckName),
            };
        }
    }
}

/** Every step of this setup with its answer, in walk order. */
export function setupSteps(
    s: MatchSetup,
    decks: readonly LobbyDeck[]
): StepInfo[] {
    return stepsFor(s).map((key) => stepInfo(s, key, decks));
}

/** Index of the first unanswered step; `steps.length` when all are answered
 *  (the setup is ready to Start). */
export function firstOpenStep(steps: readonly StepInfo[]): number {
    const i = steps.findIndex((step) => step.answer === null);
    return i === -1 ? steps.length : i;
}

/**
 * Apply one choice and clear what it invalidates (story 51): a mode with no
 * Bot drops the Bot, leaving Join drops its table, and any deck the effective
 * Match Format no longer admits — or that no longer exists — is dropped
 * (story 50). An empty `patch` reconciles a loaded setup with today's decks.
 */
export function applyChange(
    s: MatchSetup,
    patch: Partial<MatchSetup>,
    decks: readonly LobbyDeck[]
): MatchSetup {
    const next: MatchSetup = { ...s, ...patch };
    if (next.opponent && opponentUnavailableReason(next.mode, next.opponent)) {
        next.opponent = null;
    }
    // A table belongs to one game mode: switching mode leaves it behind.
    if (next.opponent === "join" && next.mode !== s.mode) next.opponent = null;
    if (next.opponent !== "join") {
        next.joinTableId = null;
        next.joinTableFormat = null;
    }
    if (next.myDeckId !== null && !admittedDeck(next, next.myDeckId, decks)) {
        next.myDeckId = null;
    }
    if (
        next.opponentDeckId !== null &&
        !admittedDeck(next, next.opponentDeckId, decks)
    ) {
        next.opponentDeckId = null;
        next.opponentDeckChosen = false;
    }
    return next;
}

export interface MatchFormatOption {
    format: FormatId;
    label: string;
    /** How many of the player's decks and presets this Match Format admits. */
    admitted: number;
    /** The option's supporting line. */
    hint: string;
}

/** Step 3's options, each with its admitted-deck count (stories 22–24). */
export function matchFormatOptions(
    decks: readonly LobbyDeck[]
): MatchFormatOption[] {
    return ARENA_MATCH_FORMATS.map((format) => {
        const admitted = filterDecksAdmittedBy(decks, format).length;
        const count = `${admitted} ${admitted === 1 ? "deck" : "decks"}`;
        return {
            format,
            label: FORMAT_LABELS[format],
            admitted,
            hint:
                format === "freeform"
                    ? `Admits every Arena deck · ${count}`
                    : count,
        };
    });
}

// --- Persistence ----------------------------------------------------------

export const MATCH_SETUP_STORAGE_KEY = "tolaria:matchSetup";

function oneOf<T extends string | number>(
    value: unknown,
    allowed: readonly T[]
): T | null {
    return allowed.includes(value as T) ? (value as T) : null;
}

const stringOrNull = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;

const formatOrNull = (value: unknown): FormatId | null =>
    typeof value === "string" && isFormatId(value) ? value : null;

/**
 * A stored setup, read field by field: anything missing, mistyped or no
 * longer offered falls back to its empty value, never throws. A shape from
 * an older build, a hand-edited key or plain garbage all load as a usable
 * setup.
 */
export function parseSetup(raw: string | null): MatchSetup {
    if (raw === null) return EMPTY_SETUP;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return EMPTY_SETUP;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        return EMPTY_SETUP;
    }
    const o = data as Record<string, unknown>;
    return {
        mode: oneOf(o.mode, GAME_MODES),
        opponent: oneOf(o.opponent, OFFERED_OPPONENTS),
        matchFormat: oneOf(o.matchFormat, ARENA_MATCH_FORMATS),
        gamesFormat: oneOf(o.gamesFormat, [1, 3] as const) ?? 1,
        myDeckId: stringOrNull(o.myDeckId),
        opponentDeckId: stringOrNull(o.opponentDeckId),
        opponentDeckChosen:
            typeof o.opponentDeckChosen === "boolean"
                ? o.opponentDeckChosen
                : EMPTY_SETUP.opponentDeckChosen,
        difficulty: oneOf(o.difficulty, DIFFICULTIES) ?? DEFAULT_DIFFICULTY,
        joinTableId: stringOrNull(o.joinTableId),
        joinTableFormat: formatOrNull(o.joinTableFormat),
    };
}

/** The last setup, or the empty one when storage is unavailable. */
export function loadSetup(): MatchSetup {
    try {
        return parseSetup(localStorage.getItem(MATCH_SETUP_STORAGE_KEY));
    } catch {
        return EMPTY_SETUP;
    }
}

/** Remember the setup; a storage failure only costs the next preselection. */
export function saveSetup(s: MatchSetup): void {
    try {
        localStorage.setItem(MATCH_SETUP_STORAGE_KEY, JSON.stringify(s));
    } catch {
        // Private mode / quota: the flow still works, it just forgets.
    }
}

// --- Start ----------------------------------------------------------------

type DeckArg = ReturnType<typeof deckPayload>;

/**
 * The one mutation a Start sends, with its arguments. `seat` names the
 * player id the session stores: the user's own id at a two-player table,
 * seat one (`${userId}-p1`) when one user holds both seats.
 */
export type StartRequest = { seat: "own" | "p1" } & (
    | {
          mutation: "createGame";
          args: {
              name: string;
              deck: DeckArg;
              bestOf: GamesFormat;
              matchFormat: FormatId;
          };
      }
    | {
          mutation: "createSoloGame";
          args: {
              name: string;
              deck: DeckArg;
              deck2?: DeckArg;
              vsAi?: true;
              bestOf: GamesFormat;
              matchFormat: FormatId;
          };
      }
    | {
          mutation: "createManualGame";
          args: { name: string; deck: DeckArg; bestOf: GamesFormat };
      }
    | {
          mutation: "createManualSoloGame";
          args: {
              name: string;
              deck: DeckArg;
              deck2?: DeckArg;
              bestOf: GamesFormat;
          };
      }
    | {
          mutation: "joinGame" | "joinManualGame";
          args: { gameId: Id<"games">; deck: DeckArg };
      }
);

/**
 * What Start sends for this setup, or `null` while any step is unanswered —
 * the same readiness the rail shows, so Start can never send half a setup
 * (story 52). Mirror sends no `deck2`: the server seats the player's deck
 * twice.
 */
export function startRequest(
    s: MatchSetup,
    decks: readonly LobbyDeck[],
    nickname: string
): StartRequest | null {
    const steps = setupSteps(s, decks);
    if (firstOpenStep(steps) < steps.length) return null;
    const mf = effectiveMatchFormat(s);
    const mine = admittedDeck(s, s.myDeckId, decks);
    if (mf === null || mine === null || s.opponent === null) return null;
    const deck = deckPayload(mine);
    const second = admittedDeck(s, s.opponentDeckId, decks);
    const deck2 = second ? deckPayload(second) : undefined;
    const bestOf = s.gamesFormat;
    const manual = s.mode === "cockatrice";

    switch (s.opponent) {
        case "join":
            return {
                seat: "own",
                mutation: manual ? "joinManualGame" : "joinGame",
                args: { gameId: s.joinTableId as Id<"games">, deck },
            };
        case "host":
            return manual
                ? {
                      seat: "own",
                      mutation: "createManualGame",
                      args: {
                          name: `${nickname}'s Manual Game`,
                          deck,
                          bestOf,
                      },
                  }
                : {
                      seat: "own",
                      mutation: "createGame",
                      args: {
                          name: `${nickname}'s game`,
                          deck,
                          bestOf,
                          matchFormat: mf,
                      },
                  };
        case "solo":
            return manual
                ? {
                      seat: "p1",
                      mutation: "createManualSoloGame",
                      args: {
                          name: `${nickname}'s Manual Game`,
                          deck,
                          ...(deck2 && { deck2 }),
                          bestOf,
                      },
                  }
                : {
                      seat: "p1",
                      mutation: "createSoloGame",
                      args: {
                          name: `${nickname}'s solo game`,
                          deck,
                          ...(deck2 && { deck2 }),
                          bestOf,
                          matchFormat: mf,
                      },
                  };
        case "bot":
            return {
                seat: "p1",
                mutation: "createSoloGame",
                args: {
                    name: `${nickname} vs Bot`,
                    deck,
                    ...(deck2 && { deck2 }),
                    vsAi: true,
                    bestOf,
                    matchFormat: mf,
                },
            };
    }
}
