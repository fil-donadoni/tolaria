// Card Rulings, fetched on demand from Scryfall (issue #4816, ADR 0142). A
// Ruling is never stored at rest: the only copies are this page session's
// in-memory map and a 24 h `localStorage` entry in the viewer's own browser.
import { toDashedUuid } from "./scryfallId";

export type ScryfallRulingSource = "wotc" | "scryfall";

export interface ScryfallRuling {
    source: ScryfallRulingSource;
    /** `YYYY-MM-DD`, as Scryfall publishes it. */
    publishedAt: string;
    comment: string;
}

export const RULINGS_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "tolaria.rulings.";

const memoryCache = new Map<string, ScryfallRuling[]>();

export function rulingsUrl(printId: string): string {
    return `https://api.scryfall.com/cards/${toDashedUuid(printId)}/rulings`;
}

export function scryfallCardPageUrl(printId: string): string {
    return `https://scryfall.com/card/${toDashedUuid(printId)}`;
}

/** Schema check: keeps well-formed rows, throws when the body is not a list. */
export function parseRulings(body: unknown): ScryfallRuling[] {
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
        throw new Error("Scryfall rulings: malformed response");
    }
    const rulings: ScryfallRuling[] = [];
    for (const row of data) {
        const r = row as Record<string, unknown> | null;
        if (
            r &&
            (r.source === "wotc" || r.source === "scryfall") &&
            typeof r.published_at === "string" &&
            typeof r.comment === "string"
        ) {
            rulings.push({
                source: r.source,
                publishedAt: r.published_at,
                comment: r.comment,
            });
        }
    }
    // Chronological ascending; the sort is stable, so same-day order is kept.
    return rulings.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

function readStored(key: string, now: number): ScryfallRuling[] | null {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at?: unknown; rulings?: unknown };
        if (typeof parsed.at !== "number" || now - parsed.at >= RULINGS_TTL_MS)
            return null;
        return parseRulings({ data: parsed.rulings });
    } catch {
        return null;
    }
}

function writeStored(key: string, rulings: ScryfallRuling[], now: number) {
    try {
        localStorage.setItem(
            STORAGE_PREFIX + key,
            JSON.stringify({ at: now, rulings })
        );
    } catch {
        // Private mode / quota / disabled storage: the memory cache still works.
    }
}

/** Cached rulings for a print, or undefined. Memory first, then storage. */
export function getCachedRulings(
    printId: string
): ScryfallRuling[] | undefined {
    const key = toDashedUuid(printId);
    const hit = memoryCache.get(key);
    if (hit) return hit;
    const stored = readStored(key, Date.now());
    if (stored) memoryCache.set(key, stored);
    return stored ?? undefined;
}

/**
 * Rulings for a print. Only a successful response is cached (an empty list
 * included); an error or a 429 throws and caches nothing.
 */
export async function fetchRulings(
    printId: string,
    signal?: AbortSignal
): Promise<ScryfallRuling[]> {
    const cached = getCachedRulings(printId);
    if (cached) return cached;
    const res = await fetch(rulingsUrl(printId), { signal });
    if (!res.ok) {
        throw new Error(`Scryfall rulings fetch failed: ${res.status}`);
    }
    const rulings = parseRulings(await res.json());
    const key = toDashedUuid(printId);
    memoryCache.set(key, rulings);
    writeStored(key, rulings, Date.now());
    return rulings;
}

/** Test-only: drop the in-memory layer. */
export function resetRulingsCacheForTests(): void {
    memoryCache.clear();
}
