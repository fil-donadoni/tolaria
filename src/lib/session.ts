import type { Id } from "@convex/_generated/dataModel";
import { DEFAULT_DIFFICULTY, type Difficulty } from "@convex/gre";
import { isFormatId, type FormatId } from "@convex/formats";

const GAME_KEY = "tolaria:gameId";
const PLAYER_KEY = "tolaria:playerId";
const DECK_KEY = "tolaria:selectedDeckId";
const AI_DECK_KEY = "tolaria:aiDeckId";
const DIFFICULTY_KEY = "tolaria:aiDifficulty";
const MATCH_FORMAT_KEY = "tolaria:matchFormat";
const DECK_FORMAT_FILTER_KEY = "tolaria:deckFormatFilter";
const PLAY_MODE_KEY = "tolaria:playMode";

/** Best-of-N match format (PRD #387). Bo1 (single Game) or Bo3 (first to two).
 *  Maps to the `bestOf` numeric the Match is created with. */
export type MatchFormat = 1 | 3;
export const DEFAULT_MATCH_FORMAT: MatchFormat = 1;

export function getStoredSession() {
    const gameId = localStorage.getItem(GAME_KEY) as Id<"games"> | null;
    const playerId = localStorage.getItem(PLAYER_KEY);
    return { gameId, playerId };
}

export function storeSession(gameId: Id<"games">, playerId: string) {
    localStorage.setItem(GAME_KEY, gameId);
    localStorage.setItem(PLAYER_KEY, playerId);
}

export function clearSession() {
    localStorage.removeItem(GAME_KEY);
    localStorage.removeItem(PLAYER_KEY);
}

export function getStoredDeckPresetId(): string | null {
    return localStorage.getItem(DECK_KEY);
}

export function storeDeckPresetId(presetId: string) {
    localStorage.setItem(DECK_KEY, presetId);
}

export function clearDeckPresetId() {
    localStorage.removeItem(DECK_KEY);
}

/** Deck the AI opponent plays in a vs-AI game. When unset the bot mirrors the
 *  human's deck (the engine default — `createSoloGame` falls back to `deck`).
 *  Persisted so the next game keeps the last opponent choice. */
export function getStoredAiDeckId(): string | null {
    return localStorage.getItem(AI_DECK_KEY);
}

export function storeAiDeckId(presetId: string) {
    localStorage.setItem(AI_DECK_KEY, presetId);
}

export function clearAiDeckId() {
    localStorage.removeItem(AI_DECK_KEY);
}

/** vs-AI difficulty (issue #114). Persisted so the next game defaults to the
 *  last choice; falls back to the default preset when unset or stale. */
export function getStoredDifficulty(): Difficulty {
    const stored = localStorage.getItem(DIFFICULTY_KEY);
    if (stored === "easy" || stored === "medium" || stored === "hard") {
        return stored;
    }
    return DEFAULT_DIFFICULTY;
}

export function storeDifficulty(difficulty: Difficulty) {
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
}

/** Bo1/Bo3 lobby selection (PRD #387). Persisted so the next session defaults
 *  to the last-picked format; falls back to Bo1 when unset or stale. */
export function getStoredMatchFormat(): MatchFormat {
    const stored = localStorage.getItem(MATCH_FORMAT_KEY);
    if (stored === "3") return 3;
    if (stored === "1") return 1;
    return DEFAULT_MATCH_FORMAT;
}

export function storeMatchFormat(format: MatchFormat) {
    localStorage.setItem(MATCH_FORMAT_KEY, String(format));
}

/** The deck-list Format filter (PRD #509, ADR 0036, issue #513). `"all"` shows
 *  every deck regardless of Format; a `FormatId` narrows the list to that
 *  Format. Navigation only — it never gates play. Distinct from the creation
 *  select (#510): this one has an `"all"` option and never sets a deck's
 *  Format. */
export type DeckFormatFilter = "all" | FormatId;
export const DEFAULT_DECK_FORMAT_FILTER: DeckFormatFilter = "all";

/** The last-chosen deck-list Format filter, persisted client-side so it
 *  survives a reload (#513 acceptance). Falls back to `"all"` when unset or
 *  when the stored value is no longer a valid Format (e.g. a renamed id). */
export function getStoredDeckFormatFilter(): DeckFormatFilter {
    const stored = localStorage.getItem(DECK_FORMAT_FILTER_KEY);
    if (stored === "all" || (stored !== null && isFormatId(stored))) {
        return stored;
    }
    return DEFAULT_DECK_FORMAT_FILTER;
}

export function storeDeckFormatFilter(filter: DeckFormatFilter) {
    localStorage.setItem(DECK_FORMAT_FILTER_KEY, filter);
}

/** The lobby's Play-panel game-mode selector (ADR 0101 §10, issue #2591):
 *  **Arena mode** (the GRE enforces the rules — vs Bot, Solo Mode,
 *  multiplayer) or **Cockatrice mode** (a Manual Game — free table, any
 *  printed card). This DRIVES deck filtering and the action set — the
 *  inverse of the pre-#2591 flow, which derived the mode from
 *  `selectedDeck.format === "manual"`. Persisted client-side like the three
 *  sibling lobby toggles above (match format, difficulty, deck-format
 *  filter) rather than in the Convex-backed `userSettings` table: it is a
 *  per-device "what am I about to do" toggle, not a cross-device profile
 *  preference (contrast the density/motion/phase-stop settings in
 *  `useUserPreferences`, which ARE meant to follow the user across
 *  devices) — see the PR for #2591. */
export type PlayMode = "arena" | "cockatrice";
export const DEFAULT_PLAY_MODE: PlayMode = "arena";

export function getStoredPlayMode(): PlayMode {
    const stored = localStorage.getItem(PLAY_MODE_KEY);
    if (stored === "arena" || stored === "cockatrice") return stored;
    return DEFAULT_PLAY_MODE;
}

export function storePlayMode(mode: PlayMode) {
    localStorage.setItem(PLAY_MODE_KEY, mode);
}
