import type { Id } from "@convex/_generated/dataModel";

export const PLAYER_COLORS = ["#4B5A6C", "#63768D"];

const GAME_KEY = "tolaria:gameId";
const PLAYER_KEY = "tolaria:playerId";
const NAME_KEY = "tolaria:playerName";
const DECK_KEY = "tolaria:selectedDeckId";

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

export function getStoredPlayerName(): string {
    return localStorage.getItem(NAME_KEY) ?? "";
}

export function storePlayerName(name: string) {
    localStorage.setItem(NAME_KEY, name);
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
