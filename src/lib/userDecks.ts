import type { DeckCard, DeckPreset } from "@convex/deckPresets";

const KEY = "tolaria:userDecks";

export interface UserDeck extends DeckPreset {
    presetId: string;
    isUserDeck: true;
    createdAt: number;
    updatedAt: number;
}

function isUserDeck(value: unknown): value is UserDeck {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.presetId === "string" &&
        typeof v.name === "string" &&
        Array.isArray(v.cards) &&
        v.isUserDeck === true
    );
}

function readAll(): UserDeck[] {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isUserDeck);
    } catch {
        return [];
    }
}

function writeAll(decks: UserDeck[]) {
    localStorage.setItem(KEY, JSON.stringify(decks));
}

export function listUserDecks(): UserDeck[] {
    return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getUserDeck(presetId: string): UserDeck | null {
    return readAll().find((d) => d.presetId === presetId) ?? null;
}

export function saveUserDeck(deck: UserDeck): void {
    const all = readAll();
    const idx = all.findIndex((d) => d.presetId === deck.presetId);
    if (idx >= 0) all[idx] = deck;
    else all.push(deck);
    writeAll(all);
}

export function deleteUserDeck(presetId: string): void {
    const all = readAll().filter((d) => d.presetId !== presetId);
    writeAll(all);
}

/** Builds an empty deck shell with a fresh `user-<uuid>` id. Caller fills
 *  `cards`/`colors` and persists via `saveUserDeck`. */
export function createEmptyUserDeck(name: string): UserDeck {
    const now = Date.now();
    return {
        presetId: `user-${crypto.randomUUID()}`,
        name,
        format: "Freeform",
        description: "",
        colors: [],
        cards: [],
        isUserDeck: true,
        createdAt: now,
        updatedAt: now,
    };
}

/** Increments the "updatedAt" stamp and returns a fresh deck object. */
export function touchDeck(
    deck: UserDeck,
    patch: Partial<UserDeck> = {}
): UserDeck {
    return {
        ...deck,
        ...patch,
        updatedAt: Date.now(),
    };
}

export function isUserDeckId(presetId: string): boolean {
    return presetId.startsWith("user-");
}

/** Next sequential auto-name for a brand new deck — "Deck 1", "Deck 2", …
 *  Picks max(N) + 1 across decks already named with the "Deck N" pattern,
 *  ignoring renamed decks. */
export function nextDeckName(decks: UserDeck[]): string {
    let max = 0;
    for (const d of decks) {
        const m = d.name.match(/^Deck (\d+)$/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return `Deck ${max + 1}`;
}

export type { DeckCard };
