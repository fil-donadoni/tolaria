import type { Id } from "@convex/_generated/dataModel";
import { DEFAULT_DIFFICULTY, type Difficulty } from "@convex/gre";

const GAME_KEY = "tolaria:gameId";
const PLAYER_KEY = "tolaria:playerId";
const DECK_KEY = "tolaria:selectedDeckId";
const AI_DECK_KEY = "tolaria:aiDeckId";
const DIFFICULTY_KEY = "tolaria:aiDifficulty";
const MATCH_FORMAT_KEY = "tolaria:matchFormat";

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
