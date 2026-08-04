import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { foldAccents } from "@convex/cards/textNormalize";
import { toDashedUuid } from "./scryfallId";

/** A single rehydrated row from the Full Catalogue columnar arrays. */
export interface FullCatalogueRow {
    name: string;
    /** Canonical (dashed) Scryfall print UUID. The ASSET stores it dashless
     *  for size; `rehydrate` restores the dashes so a row's id is the same
     *  shape as every `CardDefinition.id` — see {@link toDashedUuid}. */
    printId: string;
    typeLine: string;
    manaCost: string;
    cmc: number;
    colourIdentity: string;
    set: string;
    rarity: string;
    /** `foldAccents(name.toLowerCase())` — drives accent-insensitive match. */
    nameFold: string;
    /** True when this row has a matching `nameFold` in `api.cardIndex.list`. */
    available: boolean;
}

/** Columnar wire format read from `data/full-catalogue.json.gz`. */
interface FullCatalogueWire {
    names: string[];
    printIds: string[];
    typeLines: string[];
    manaCosts: string[];
    cmcs: number[];
    colourIdentities: string[];
    sets: string[];
    rarities: string[];
}

let cataloguePromise: Promise<FullCatalogueRow[]> | null = null;

export function rehydrate(wire: FullCatalogueWire): FullCatalogueRow[] {
    const len = wire.names.length;
    const rows: FullCatalogueRow[] = [];
    for (let i = 0; i < len; i++) {
        const nameFold = foldAccents(wire.names[i].toLowerCase());
        rows.push({
            name: wire.names[i],
            printId: toDashedUuid(wire.printIds[i]),
            typeLine: wire.typeLines[i],
            manaCost: wire.manaCosts[i],
            cmc: wire.cmcs[i],
            colourIdentity: wire.colourIdentities[i],
            set: wire.sets[i],
            rarity: wire.rarities[i],
            nameFold,
            available: false,
        });
    }
    return rows;
}

/** Public URL of the generated catalogue asset (`scripts/fetch-full-catalogue.mjs`). */
export const CATALOGUE_URL = "/data/full-catalogue.json.gz";

/**
 * Decode a fetched catalogue payload into its JSON text.
 *
 * The asset is gzip on disk, but whether the BYTES that reach us are still
 * gzip is the server's decision, not ours: Vite's dev server (and most static
 * hosts) infer `Content-Encoding: gzip` from the `.gz` extension, in which
 * case the fetch layer has already inflated the body and handing it to
 * `DecompressionStream("gzip")` throws `TypeError` — the whole catalogue then
 * fails to load, silently degrading manual mode to an empty pool and real
 * mode to no Unavailable Cards.
 *
 * So sniff instead of assume: gzip always starts with the magic bytes
 * `1f 8b` (RFC 1952 § 2.3.1). Present → inflate; absent → the transport
 * already did it. Correct under both server behaviours.
 */
export async function decodeCatalogue(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!isGzip) return new TextDecoder().decode(bytes);

    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    return await new Response(stream.readable).text();
}

/** Fetch + decompress + parse the Full Catalogue (lazy, browser-cached).
 *  Returns the rehydrated rows with `available === false` everywhere —
 *  availability is patched by `useFullCatalogue`. */
export function loadFullCatalogue(): Promise<FullCatalogueRow[]> {
    if (cataloguePromise) return cataloguePromise;

    cataloguePromise = (async () => {
        const startMs = performance.now();
        const response = await fetch(CATALOGUE_URL);
        if (!response.ok) {
            throw new Error(
                `Full Catalogue fetch failed: ${response.status} ${response.statusText} — ` +
                    `the asset is generated and gitignored; run \`bun run catalogue:ensure\``
            );
        }
        const text = await decodeCatalogue(await response.arrayBuffer());
        const wire = JSON.parse(text) as FullCatalogueWire;
        const rows = rehydrate(wire);
        const elapsed = (performance.now() - startMs).toFixed(0);
        console.log(
            `Full Catalogue: fetched + decompressed + parsed ${wire.names.length} rows in ${elapsed} ms`
        );
        return rows;
    })();

    cataloguePromise.catch(() => {
        cataloguePromise = null;
    });

    return cataloguePromise;
}

export interface FullCatalogueResult {
    /** All catalogue rows with `.available` patched from `cardIndex.list`.
     *  `undefined` while the catalogue + index are loading. */
    rows: FullCatalogueRow[] | undefined;
    /** Non-null when `loadFullCatalogue` failed (network error, HTTP 4xx/5xx).
     *  Callers should show a degraded state — branded grey, no catalogue
     *  filtering — and NOT retry. */
    error: string | null;
}

/**
 * Lazy-loads the Full Catalogue and derives per-row availability by folded-name
 * match against `api.cardIndex.list`. Nothing is fetched until this hook mounts.
 */
export function useFullCatalogue(): FullCatalogueResult {
    const index = useQuery(api.cardIndex.list, {});
    const [catalogue, setCatalogue] = useState<FullCatalogueRow[] | undefined>(
        undefined
    );
    const [error, setError] = useState<string | null>(null);

    // No "already started" ref here — deduplication is the module-level
    // `cataloguePromise`'s job, and a ref would BREAK this effect under
    // StrictMode: mount #1 starts the load, the simulated unmount flips its
    // `cancelled`, and mount #2 early-returns on the ref, so the resolving
    // promise finds every live closure cancelled and `setCatalogue` is never
    // called. `rows` then stays `undefined` forever with no error logged —
    // manual mode silently shows an empty pool. Re-subscribing on every mount
    // is free: `loadFullCatalogue` returns the same cached promise.
    useEffect(() => {
        let cancelled = false;
        loadFullCatalogue()
            .then((rows) => {
                if (!cancelled) setCatalogue(rows);
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    console.warn(
                        "Full Catalogue load failed — deck builder will show available cards only:",
                        message
                    );
                    setError(message);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const availableFolds = useMemo<Set<string> | null>(() => {
        if (!index) return null;
        const set = new Set<string>();
        for (const row of index) set.add(row.nameFold);
        return set;
    }, [index]);

    const rows = useMemo(() => {
        if (!catalogue || !availableFolds) return undefined;
        return patchAvailability(catalogue, availableFolds);
    }, [catalogue, availableFolds]);

    return { rows, error };
}

/** Patches `.available` on every row by checking `nameFold` membership in
 *  `availableFolds`. Pure — exported for testing. */
export function patchAvailability(
    catalogue: FullCatalogueRow[],
    availableFolds: ReadonlySet<string>
): FullCatalogueRow[] {
    return catalogue.map((r) => ({
        ...r,
        available: availableFolds.has(r.nameFold),
    }));
}
