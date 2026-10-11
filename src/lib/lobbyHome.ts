// The lobby home (PRD #5334 stories 1–14, issue #5344): what Last Match,
// Your Tables and the Decks section show.
//
// PURE — no React, no Convex client. The home renders exactly what these
// functions return; the setup it replays is the flow's own (`matchSetup.ts`),
// so "Play again" can never start something the flow would not.
import { FORMAT_LABELS } from "@convex/formats";
import type { Id } from "@convex/_generated/dataModel";
import type { LobbyDeck } from "./deckTypes";
import type { ActiveGameStatus } from "./activeGameExit";
import {
    limitedEventStatusChip,
    type LimitedEventStatusChip,
} from "./limitedEventStatus";
import { limitedEventName } from "./limitedEventName";
import {
    effectiveMatchFormat,
    modeLabel,
    opponentLabel,
    startRequest,
    type MatchSetup,
} from "./matchSetup";
import { deckSearchHit } from "./matchSetupDeckGrid";
import type { DeckFormatFilter } from "./session";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";

/** The art behind one home tile: a local lobby frame, one deck's featured
 *  art, or two decks' art split by a diagonal (my deck, then theirs). */
export type HomeArt =
    | { image: string }
    | { deck: string | null }
    | { split: readonly [string | null, string | null] };

// --- Last Match -----------------------------------------------------------

export interface LastMatchView {
    /** "Burn vs Mono Blue" — my deck, then the opponent's deck or kind. */
    title: string;
    /** The setup as one line: mode · opponent · Match Format · Games Format. */
    setupLine: string;
    myArt: string | null;
    /** `undefined` when the opponent brings their own deck (Host, Join): the
     *  tile shows one art instead of a split. */
    opponentArt: string | null | undefined;
}

/**
 * The Last Match tile for a (reconciled) remembered setup, or `null` when it
 * cannot be replayed as is — a step unanswered, a deck gone, a table closed.
 * Readiness is `startRequest`'s, so the tile is offered exactly when "Play
 * again" would send a mutation (story 1).
 */
export function lastMatchView(
    setup: MatchSetup,
    decks: readonly LobbyDeck[]
): LastMatchView | null {
    if (startRequest(setup, decks, "") === null) return null;
    const mine = decks.find((d) => d.presetId === setup.myDeckId);
    const mf = effectiveMatchFormat(setup);
    if (!mine || setup.mode === null || setup.opponent === null || !mf) {
        return null;
    }
    const seatsSecondDeck =
        setup.opponent === "bot" || setup.opponent === "solo";
    const second = seatsSecondDeck
        ? (decks.find((d) => d.presetId === setup.opponentDeckId) ?? mine)
        : null;
    const parts = [
        modeLabel(setup.mode),
        opponentLabel(setup.opponent),
        // Cockatrice is always Manual and a join inherits the host's Format,
        // so naming the Match Format there would say nothing a player chose.
        ...(setup.mode === "arena" && setup.opponent !== "join"
            ? [FORMAT_LABELS[mf]]
            : []),
        ...(setup.opponent === "join" ? [] : [`Bo${setup.gamesFormat}`]),
    ];
    return {
        title: `${mine.name} vs ${second ? second.name : "Human"}`,
        setupLine: parts.join(" · "),
        myArt: mine.featuredCardId,
        opponentArt: second ? second.featuredCardId : undefined,
    };
}

// --- Your Tables ----------------------------------------------------------

/** The slice of `myActiveGame` Your Tables reads. */
export interface ActiveMatchSlice {
    gameId: Id<"games">;
    status: ActiveGameStatus;
    solo: boolean;
    vsAi: boolean;
}

export type TableRow =
    | {
          kind: "match";
          key: string;
          title: string;
          /** "vs Bot" / "Solo" / "vs Human" (story 8). */
          line: string;
          phase: string;
          gameId: Id<"games">;
          /** The seat to resume: one user holds both seats in Solo/vs Bot. */
          seat: "own" | "p1";
      }
    | {
          kind: "event";
          key: string;
          /** The pool name: "Vintage Cube Draft" (story 7). */
          title: string;
          line: string;
          phase: string;
          eventId: string;
      };

const EVENT_PHASE: Record<LimitedEventStatusChip, string> = {
    open: "Waiting for players",
    drafting: "Draft",
    building: "Deckbuilding",
    playing: "Games",
    done: "Done",
};

function matchPhase(status: ActiveGameStatus): string {
    if (status === "waiting") return "Waiting for an opponent";
    if (status === "finished") return "Between games";
    return "In progress";
}

function matchOpponent(m: ActiveMatchSlice): string {
    if (m.vsAi) return "vs Bot";
    return m.solo ? "Solo" : "vs Human";
}

/** Every Match and Limited Event the player is seated at, the Match first. */
export function yourTables(
    activeMatch: ActiveMatchSlice | null,
    events: readonly LimitedEventSummaryView[]
): TableRow[] {
    const rows: TableRow[] = [];
    if (activeMatch) {
        rows.push({
            kind: "match",
            key: activeMatch.gameId,
            title: "Constructed",
            line: matchOpponent(activeMatch),
            phase: matchPhase(activeMatch.status),
            gameId: activeMatch.gameId,
            seat: activeMatch.solo ? "p1" : "own",
        });
    }
    for (const e of events) {
        rows.push({
            kind: "event",
            key: e._id,
            title: limitedEventName(e),
            line: "Limited",
            phase: EVENT_PHASE[limitedEventStatusChip(e)],
            eventId: e._id,
        });
    }
    return rows;
}

// --- Decks ----------------------------------------------------------------

export interface HomeDeckEntry {
    deck: LobbyDeck;
    /** The card a search matched when the deck name did not (story 13). */
    matchedCard: string | null;
}

export interface HomeDecks {
    mine: HomeDeckEntry[];
    presets: HomeDeckEntry[];
}

/** The Decks section: every deck of the Format (or all), matching the
 *  deck-or-card search, split into the player's own and the presets. */
export function homeDecks(
    decks: readonly LobbyDeck[],
    format: DeckFormatFilter,
    query: string
): HomeDecks {
    const out: HomeDecks = { mine: [], presets: [] };
    for (const deck of decks) {
        if (format !== "all" && deck.format !== format) continue;
        const hit = deckSearchHit(deck, query);
        if (!hit) continue;
        (deck.kind === "user" ? out.mine : out.presets).push({
            deck,
            matchedCard: hit.matchedCard,
        });
    }
    return out;
}
