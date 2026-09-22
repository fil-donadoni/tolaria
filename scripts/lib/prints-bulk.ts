// Streams the Scryfall `default_cards` bulk for `scripts/prints-sync.ts`
// (ADR 0140, issue #4116) — one row per PRINTING, which is what a Card Print
// table needs (paper-ness, `digital`/`promo`, `all_parts` token links) and
// `oracle_cards` (one row per card, `scripts/oracle-corpus.ts`'s source)
// cannot give. No pin, no lockfile (unlike `oracle-corpus.ts`): ADR 0140 §3
// deliberately keeps no committed artifact for Card Prints, since the table
// itself is the source of truth and nothing else builds from this data.
//
// I/O only — every row this yields is reduced by the pure
// `scripts/lib/prints-transform.ts`, which is what the fixture tests cover.

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import type { ScryfallDefaultCardRow } from "./prints-transform";

const BULK_INDEX = "https://api.scryfall.com/bulk-data/default-cards";
const HEADERS = {
    // Scryfall 400s on a default HTTP-library User-Agent (see
    // fetch-full-catalogue.mjs).
    "User-Agent": "tolaria-prints-sync/1.0",
    Accept: "*/*",
};

async function resolveDownloadUri(): Promise<string> {
    const res = await fetch(BULK_INDEX, { headers: HEADERS });
    if (!res.ok) throw new Error(`Scryfall bulk index ${res.status}`);
    const meta = (await res.json()) as Record<string, unknown>;
    const uri = (meta.download_uri ?? meta.jsonl_download_uri ?? "") as string;
    if (!uri) throw new Error("Scryfall bulk index returned no download uri");
    return uri;
}

/** Streams every row of the `default_cards` bulk to `onRow`, without holding
 *  the whole ~80 MB payload in memory at once. */
export async function streamDefaultCards(
    onRow: (row: ScryfallDefaultCardRow) => void
): Promise<number> {
    const uri = await resolveDownloadUri();
    process.stderr.write(`prints-sync: downloading ${uri}\n`);
    const res = await fetch(uri, { headers: HEADERS });
    if (!res.ok || !res.body)
        throw new Error(`Scryfall bulk download ${res.status}`);

    let count = 0;
    if (uri.endsWith(".jsonl") || uri.endsWith(".jsonl.gz")) {
        const stream = uri.endsWith(".gz")
            ? Readable.fromWeb(res.body as never).pipe(createGunzip())
            : Readable.fromWeb(res.body as never);
        for await (const line of createInterface({
            input: stream,
            crlfDelay: Infinity,
        })) {
            if (!line.trim()) continue;
            onRow(JSON.parse(line) as ScryfallDefaultCardRow);
            count++;
        }
    } else {
        const raw = JSON.parse(await res.text()) as ScryfallDefaultCardRow[];
        for (const row of raw) {
            onRow(row);
            count++;
        }
    }
    return count;
}
