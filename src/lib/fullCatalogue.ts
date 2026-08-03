import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { foldAccents } from "@convex/cards/textNormalize";

/** A single rehydrated row from the Full Catalogue columnar arrays. */
export interface FullCatalogueRow {
    name: string;
    /** Dashless Scryfall UUID. */
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
            printId: wire.printIds[i],
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

/** Fetch + decompress + parse the Full Catalogue (lazy, browser-cached).
 *  Returns the rehydrated rows with `available === false` everywhere —
 *  availability is patched by `useFullCatalogue`. */
export function loadFullCatalogue(): Promise<FullCatalogueRow[]> {
    if (cataloguePromise) return cataloguePromise;

    cataloguePromise = (async () => {
        const startMs = performance.now();
        const response = await fetch("/data/full-catalogue.json.gz");
        if (!response.ok) {
            throw new Error(
                `Full Catalogue fetch failed: ${response.status} ${response.statusText}`
            );
        }
        const decompressedStream = response.body!.pipeThrough(
            new DecompressionStream("gzip")
        );
        const text = await new Response(decompressedStream).text();
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
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        let cancelled = false;
        loadFullCatalogue().then((rows) => {
            if (!cancelled) setCatalogue(rows);
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

    return { rows };
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
