import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { toDashedUuid } from "./scryfallId";

export interface ScryfallEdition {
    printId: string;
    setCode: string;
    label: string;
}

interface ScryfallPrint {
    id: string;
    set: string;
    collector_number: string;
}

/**
 * Fetches all printings for a card from Scryfall.
 * `GET /cards/search?q=!"<exact name>"&unique=prints&order=released`
 */
export async function fetchEditions(
    cardName: string
): Promise<ScryfallEdition[]> {
    const query = encodeURIComponent(`!"${cardName}"`);
    const url = `https://api.scryfall.com/cards/search?q=${query}&unique=prints&order=released`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Scryfall editions fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as {
        data: ScryfallPrint[];
    };
    return body.data.map((p) => ({
        // Canonical dashed form — Scryfall already returns it that way; this
        // used to strip the dashes, which broke every image URL built from an
        // edition-dropdown pick (see `toDashedUuid`).
        printId: toDashedUuid(p.id),
        setCode: p.set,
        label: p.set.toUpperCase(),
    }));
}

/**
 * Searches Scryfall for cards matching the query (name and oracle text).
 * Returns a Set of matching card names. Used by tests — the hook delegates
 * to its own inline fetch for abort-controller management.
 */
export async function fetchTextSearch(query: string): Promise<Set<string>> {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Scryfall text search failed: ${res.status}`);
    }
    const body = (await res.json()) as {
        data: Array<{ name: string }>;
    };
    return new Set(body.data.map((c) => c.name));
}

const editionsCache = new Map<string, ScryfallEdition[]>();

/**
 * React hook that fetches editions for a card name on demand.
 * The fetch is triggered by calling `load()` — no network call until then.
 * Results are cached per card name.
 */
export function useScryfallEditions(cardName: string | null): {
    editions: ScryfallEdition[] | undefined;
    loading: boolean;
    error: string | null;
    load: () => void;
} {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const startedRef = useRef(false);
    const prevCardName = useRef(cardName);

    // Reset startedRef when cardName changes (must be in an effect,
    // not during render, to satisfy react-hooks/refs).
    useEffect(() => {
        if (prevCardName.current !== cardName) {
            prevCardName.current = cardName;
            startedRef.current = false;
        }
    }, [cardName]);

    const editions = useMemo(
        () => (cardName ? editionsCache.get(cardName) : undefined),
        [cardName]
    );

    const load = useCallback(() => {
        if (!cardName || startedRef.current) return;
        const cached = editionsCache.get(cardName);
        if (cached) return;
        startedRef.current = true;
        setLoading(true);
        setError(null);
        fetchEditions(cardName)
            .then((result) => {
                editionsCache.set(cardName, result);
                setLoading(false);
            })
            .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                setLoading(false);
            });
    }, [cardName]);

    return { editions, loading, error, load };
}

/**
 * React hook for debounced oracle-text search via Scryfall.
 * Only runs when `enabled` is true and `query` is non-empty.
 * Returns matching card names as a Set.
 *
 * All state updates happen inside setTimeout callbacks, not in the
 * synchronous effect body — matching the pattern established by
 * `useDebouncedValue` so the react-hooks/set-state-in-effect rule
 * is satisfied.
 */
export function useScryfallTextSearch(
    query: string,
    debounceMs: number,
    enabled: boolean
): { names: Set<string> | undefined; loading: boolean; error: string | null } {
    const [names, setNames] = useState<Set<string> | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const queryRef = useRef(query);
    const enabledRef = useRef(enabled);

    useEffect(() => {
        queryRef.current = query;
        enabledRef.current = enabled;
    });

    useEffect(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        abortRef.current?.abort();

        const scheduleFetch = () => {
            const currentQuery = queryRef.current.trim();
            const currentEnabled = enabledRef.current;

            if (!currentQuery || !currentEnabled) {
                setNames(undefined);
                setLoading(false);
                setError(null);
                return;
            }

            setLoading(true);
            setError(null);
            setNames(undefined);

            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                const controller = new AbortController();
                abortRef.current = controller;

                fetch(
                    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(currentQuery)}&unique=cards`,
                    { signal: controller.signal }
                )
                    .then((res) => {
                        if (!res.ok) {
                            throw new Error(
                                `Scryfall text search failed: ${res.status}`
                            );
                        }
                        return res.json();
                    })
                    .then((body: { data: Array<{ name: string }> }) => {
                        if (!controller.signal.aborted) {
                            setNames(new Set(body.data.map((c) => c.name)));
                            setLoading(false);
                        }
                    })
                    .catch((err: unknown) => {
                        if (
                            err instanceof DOMException &&
                            err.name === "AbortError"
                        )
                            return;
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        if (!controller.signal.aborted) {
                            setError(msg);
                            setNames(undefined);
                            setLoading(false);
                        }
                    });
            }, debounceMs);
        };

        // Defer all state changes through a 0-ms timeout so none of them
        // are synchronous in the effect body (react-hooks/set-state-in-effect).
        timerRef.current = window.setTimeout(scheduleFetch, 0);

        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            abortRef.current?.abort();
        };
    }, [query, debounceMs, enabled]);

    return { names, loading, error };
}
