// The client's compiled-shard URLs (issue #5616), a virtual module the
// bundler writes (`scripts/lib/vite-compiled-shards.ts`): content-addressed
// asset URLs under `vite build`, the plugin's middleware under the dev server
// and vitest. Read only by `src/lib/catalogue/compiled-shards.ts`.
declare module "virtual:compiled-shards" {
    /** The shard dictionary every shard's blocks inflate against. */
    export const dictionaryUrl: string;
    /** The compiled Definition Index alone, no row. */
    export const indexUrl: string;
    /** Shard key (a first-printing Set code) → the shard's URL. */
    export const shardUrls: Readonly<Record<string, string>>;
}
