/**
 * The client compiled assets' INPUTS (issue #5616): where they are committed,
 * and the shard keys read off the server corpus without decoding a row.
 *
 * A LEAF on purpose — no `convex/` import. The Vite plugin
 * (`./vite-compiled-shards`) reads it while serving vitest and the dev server,
 * where importing the encoder (`./compiled-shards`, which reaches
 * `convex/cards/**`) into the server process made every test that loads the
 * hand-written Sets ten times slower (a whole hydration 4 s → 40 s,
 * measured). The encoder is imported only to cut bytes: in a build, and on
 * the dev middleware's first request.
 */

/** The server's packed corpus — what the shards are cut from. */
export const PACKED_CORPUS_PATH = "data/catalogue/packed-corpus.json";

/** The committed shard dictionary: `{ "dictionary": "<base64>" }`. */
export const SHARD_DICTIONARY_PATH = "data/catalogue/shard-dictionary.json";

/** The shard keys of the committed corpus, read off its index — no row
 *  decoded: every distinct first-printing Set code, in code-unit order. */
export const compiledShardKeys = (packedText: string): string[] =>
    [
        ...new Set(
            (JSON.parse(packedText) as { setCodes: readonly string[] }).setCodes
        ),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
