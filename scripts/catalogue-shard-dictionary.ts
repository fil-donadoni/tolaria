/**
 * `bun run catalogue:shard-dictionary` — (re)write the client SHARD
 * DICTIONARY (issue #5616, `scripts/lib/compiled-shards.ts`) from today's
 * compiled rows.
 *
 * Run it ON PURPOSE, never from a generator: every client shard's blocks are
 * deflated against this file, so a new one re-points EVERY shard's URL and
 * every returning player downloads every shard again. Its quality barely
 * depends on which rows it samples (measured in `compiled-shards.ts`), so the
 * reason to refresh it is a change in the row FORMAT (a new field every
 * compiled row carries), not new cards.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACKED_CORPUS_PATH, unpackCorpus } from "./lib/packed-corpus";
import {
    SHARD_DICTIONARY_PATH,
    serializeShardDictionary,
} from "./lib/compiled-shards";

const root = join(import.meta.dir, "..");
const rows = unpackCorpus(
    JSON.parse(readFileSync(join(root, PACKED_CORPUS_PATH), "utf8"))
);
writeFileSync(
    join(root, SHARD_DICTIONARY_PATH),
    serializeShardDictionary(rows)
);
console.log(
    `catalogue:shard-dictionary: wrote ${SHARD_DICTIONARY_PATH} from ${rows.length} compiled rows`
);
