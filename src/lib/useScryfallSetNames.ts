import { useEffect, useState } from "react";
import { getAllSetCodes } from "@convex/cards/catalogue";
import { setName } from "@convex/cards/setMeta";

/** Lower-case Set code → full name. */
export type SetNames = ReadonlyMap<string, string>;

/** The catalogue's own Sets (`convex/cards/setMeta.ts`) — known offline, the
 *  floor the Scryfall list extends. */
let catalogue: SetNames | null = null;
function catalogueSetNames(): SetNames {
    catalogue ??= new Map(
        getAllSetCodes().map((code) => [code.toLowerCase(), setName(code)])
    );
    return catalogue;
}

// A hung request must not pin `pending` forever — the next open retries.
const FETCH_TIMEOUT_MS = 10_000;

// One fetch per page load, shared by every picker that opens.
let pending: Promise<SetNames> | null = null;
let loaded: SetNames | null = null;

async function fetchScryfallSetNames(): Promise<SetNames> {
    const res = await fetch("https://api.scryfall.com/sets", {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Scryfall sets fetch failed: ${res.status}`);
    const body = (await res.json()) as {
        data: Array<{ code: string; name: string }>;
    };
    const names = new Map(catalogueSetNames());
    for (const s of body.data) names.set(s.code.toLowerCase(), s.name);
    return names;
}

/**
 * Every Set's full name, for the printing picker's text filter (issue #4122:
 * "odyssey" must find ODY even though the `cardPrints` table stores codes
 * only and the catalogue names only its own Sets). Fetched from Scryfall's
 * `/sets` once `enabled` turns true; until then — or if the fetch fails — the
 * catalogue's names, so a code or a catalogue Set's name still matches.
 */
export function useScryfallSetNames(enabled: boolean): SetNames {
    const [names, setNames] = useState<SetNames>(
        () => loaded ?? catalogueSetNames()
    );
    useEffect(() => {
        if (!enabled || loaded) return;
        let live = true;
        pending ??= fetchScryfallSetNames().then((n) => (loaded = n));
        pending.then(
            (n) => {
                if (live) setNames(n);
            },
            () => {
                // Offline or rate-limited: keep the catalogue floor, retry
                // on the next open.
                pending = null;
            }
        );
        return () => {
            live = false;
        };
    }, [enabled]);
    return loaded ?? names;
}
