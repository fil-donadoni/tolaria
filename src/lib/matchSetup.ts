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
import { DIFFICULTY_LABEL } from "~/lib/difficultyLabels";
import {
    deckPayload,
    filterDecksAdmittedBy,
    selectPreset,
    type LobbyDeck,
} from "./deckTypes";
import type { RecapStep } from "./recapRail";
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
    /** A join code typed instead of a listed table (Arena only). The code is
     *  never resolved client-side — resolving it would make the code space an
     *  enumerable oracle (issue #2649) — so the table's Match Format stays
     *  unknown and the server re-checks the deck at Start. Never persisted. */
    joinCode: string | null;
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
    joinCode: null,
};

const GAME_MODES: readonly GameMode[] = ["arena", "cockatrice"];

/** The opponents step 2 offers. */
export const OFFERED_OPPONENTS: readonly Opponent[] = [
    "bot",
    "solo",
    "host",
    "join",
];

/** The Match Formats step 3 offers: every playable Format. Limited has its own
 *  branch (`/limited`); Manual is Cockatrice's implicit Match Format. */
export const ARENA_MATCH_FORMATS: readonly FormatId[] = FORMAT_IDS.filter(
    (f) => f !== "limited" && f !== "manual"
);

/** The Match Format actually in force: Cockatrice is always Manual, a join
 *  inherits the host's, otherwise the one step 3 chose. A join by code cannot
 *  know the host's, so its deck grid admits every Arena deck (Freeform) and
 *  the server's admission check is the verdict. */
export function effectiveMatchFormat(s: MatchSetup): FormatId | null {
    if (s.mode === "cockatrice") return "manual";
    if (s.opponent === "join") {
        return s.joinCode === null ? s.joinTableFormat : "freeform";
    }
    return s.matchFormat;
}

/** One open table as step 2's Join list shows it — the slice of
 *  `listOpenGames` this flow reads. */
export interface OpenTable {
    _id: string;
    name: string;
    /** `"manual"` for a Cockatrice table; absent for an Arena one. */
    mode?: "manual";
    matchFormat: FormatId;
    /** The Games Format as the Match-flow field: 1 = Bo1, 3 = Bo3. */
    bestOf: GamesFormat;
    players: readonly { name: string }[];
}

/** The open tables of one game mode: Cockatrice sees Manual tables only,
 *  Arena everything else (story 27). */
export function tablesForMode<T extends Pick<OpenTable, "mode">>(
    tables: readonly T[],
    mode: GameMode | null
): T[] {
    if (mode === null) return [];
    return tables.filter(
        (t) => (t.mode === "manual") === (mode === "cockatrice")
    );
}

/** Whether the mode offers join by code: codes only ever name Arena tables
 *  (`isCodeJoinableGame`). */
export const joinByCodeAvailable = (mode: GameMode | null): boolean =>
    mode === "arena";

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

/**
 * Steps with more than one control (or a control that is not a pick): a
 * choice there never advances the flow, the Next button does. The rest are
 * single-control — one click saves the answer and opens the following step.
 */
export const MULTI_CONTROL_STEPS: readonly StepKey[] = [
    "format",
    "table",
    "opponentDeck",
];

/** Whether answering `step` with `patch` advances to the next step. The
 *  Table step advances on picking a table only; entering a code is confirmed
 *  with Next. */
export function advancesOnChoice(
    step: StepKey,
    patch: Partial<MatchSetup>
): boolean {
    if (step === "table") return "joinTableId" in patch;
    return !MULTI_CONTROL_STEPS.includes(step);
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

export type StepInfo = RecapStep<StepKey>;

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
                answer:
                    s.joinCode !== null
                        ? `Code ${s.joinCode}`
                        : s.joinTableId === null
                          ? null
                          : "Table picked",
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
 * The Bot's default deck for `myDeckId` (issue #5394, ADR 0153): under
 * Limited, another admitted deck of the player's own Limited Origin — the
 * origin guides the default, admission is unchanged, a cross-origin choice
 * stays open. `null` = today's default (Mirror): no origin, no match, or the
 * player's deck is the only one of its origin.
 */
export function defaultBotDeckId(
    s: MatchSetup,
    decks: readonly LobbyDeck[]
): string | null {
    if (s.opponent !== "bot" || effectiveMatchFormat(s) !== "limited") {
        return null;
    }
    const mine = admittedDeck(s, s.myDeckId, decks);
    if (!mine?.limitedOrigin) return null;
    const sameOrigin = decks.find(
        (d) =>
            d.kind === "user" &&
            d.presetId !== mine.presetId &&
            d.limitedOrigin === mine.limitedOrigin &&
            admittedDeck(s, d.presetId, decks) !== null
    );
    return sameOrigin?.presetId ?? null;
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
    if (next.opponent !== "join" || next.mode !== "arena") next.joinCode = null;
    if (next.opponent !== "join") {
        next.joinTableId = null;
        next.joinTableFormat = null;
    }
    // A table and a code are two ways to name the same seat: the later pick
    // wins, and the stale one never rides along into Start.
    if (patch.joinCode != null) {
        next.joinTableId = null;
        next.joinTableFormat = null;
    } else if (patch.joinTableId != null) {
        next.joinCode = null;
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
    // A new deck of the player's re-defaults the Bot's deck, but only when
    // the Bot's deck is still a default (Mirror, unanswered, or the previous
    // default) — a deck the player picked by hand is never overridden.
    if (patch.myDeckId !== undefined && patch.myDeckId !== s.myDeckId) {
        const previousDefault = defaultBotDeckId(s, decks);
        const isDefault =
            !next.opponentDeckChosen ||
            next.opponentDeckId === null ||
            next.opponentDeckId === previousDefault;
        const fresh = defaultBotDeckId(next, decks);
        if (isDefault && fresh !== null) {
            next.opponentDeckId = fresh;
            next.opponentDeckChosen = true;
        } else if (
            previousDefault !== null &&
            next.opponentDeckId === previousDefault
        ) {
            next.opponentDeckId = null;
            next.opponentDeckChosen = true;
        }
    }
    return next;
}

/**
 * A remembered setup made true of today: a deck that was deleted or is no
 * longer admitted is dropped (story 50), and so is a table that closed,
 * filled or was cancelled since — the recap and the home's Last Match never
 * offer a seat that is gone.
 */
export function reconcileSetup(
    stored: MatchSetup,
    decks: readonly LobbyDeck[],
    openTables: readonly Pick<OpenTable, "_id">[]
): MatchSetup {
    const reconciled = applyChange(stored, {}, decks);
    if (
        reconciled.joinTableId === null ||
        openTables.some((t) => t._id === reconciled.joinTableId)
    ) {
        return reconciled;
    }
    return applyChange(
        reconciled,
        { joinTableId: null, joinTableFormat: null },
        decks
    );
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
        joinCode: null,
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
    | {
          mutation: "joinGameByCode";
          args: { code: string; deck: DeckArg };
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
            if (s.joinCode !== null) {
                return {
                    seat: "own",
                    mutation: "joinGameByCode",
                    args: { code: s.joinCode, deck },
                };
            }
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
