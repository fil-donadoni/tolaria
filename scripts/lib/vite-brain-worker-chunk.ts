// The Brain worker as a CHUNK OF THE PAGE'S BUILD (issue #5617, PRD #5602,
// ADR 0113 Amendment VII).
//
// `new Worker(new URL("./brain.worker.ts", import.meta.url))` makes Vite run a
// SECOND build for the worker, with its own module graph and its own chunks:
// the engine, the catalogue glue and — an `iife` bundle cannot code-split —
// every hand-written Set inlined, 733 KB gzip downloaded beside a page that
// already holds the engine for its board. Measured (the spike this issue
// settled; numbers in ADR 0113 Amendment VII): an `es` worker build with the
// page's chunking still owes 369 KB of its own static closure plus a second
// copy of each Set chunk under a different hash; the worker as an entry chunk
// of the page's build owes 0.5 KB — its static closure is otherwise chunks
// the game route already loaded, and a Set chunk or a compiled shard is one
// URL for both graphs, so the HTTP cache serves the worker what the page
// fetched. The worker still gets its own module INSTANCES (a Worker always
// does); one download is the goal, not one instance.
//
// So this plugin emits `src/lib/ai/brain.worker.ts` as an extra entry chunk
// of the page's build and hands its URL to `src/lib/ai/brain-client.ts`
// through `virtual:brain-worker-url`. Under the dev server and vitest it
// names the source module with Vite's worker query instead (`?worker_file`),
// which is what Vite's own worker transform would have produced.
//
// A LEAF like `./vite-compiled-shard-urls`: no `convex/` import, so vitest's
// config can load it too.
import path from "node:path";
import type { Plugin } from "vite";

export const BRAIN_WORKER_MODULE = "virtual:brain-worker-url";
const RESOLVED = `\0${BRAIN_WORKER_MODULE}`;

/** The worker's entry module. */
export const BRAIN_WORKER_ENTRY = path.resolve(
    __dirname,
    "../../src/lib/ai/brain.worker.ts"
);

/** The entry chunk's name; Vite appends `-<hash>.js`. The asset-graph check
 *  keys on it (`scripts/lib/asset-graph.ts` → `BRAIN_WORKER_CHUNK_PREFIX`). */
export const BRAIN_WORKER_CHUNK_NAME = "brain.worker";

/** What the dev server serves the worker as: the source module, with the
 *  query Vite's worker plugin gives a module worker's own URL. */
export const BRAIN_WORKER_DEV_URL =
    "/src/lib/ai/brain.worker.ts?worker_file&type=module";

/** Stands in for the entry chunk's file name until the bundle has one. */
const PLACEHOLDER = "__BRAIN_WORKER_CHUNK_FILE__";

/** `virtual:brain-worker-url`'s source: the dev URL, or the emitted chunk's
 *  URL resolved against the importing chunk (both live in `assets/`). The
 *  name is a variable on purpose — a literal `new URL("./…",
 *  import.meta.url)` is what Vite's asset plugin rewrites. */
export function brainWorkerModuleSource(build: boolean): string {
    if (!build)
        return `export default ${JSON.stringify(BRAIN_WORKER_DEV_URL)};\n`;
    return [
        `const file = ${JSON.stringify(`./${PLACEHOLDER}`)};`,
        `export default new URL(file, import.meta.url).href;`,
        "",
    ].join("\n");
}

export function brainWorkerChunk(): Plugin {
    let build = false;
    let ref: string | undefined;
    return {
        name: "brain-worker-chunk",
        configResolved(config) {
            build = config.command === "build";
        },
        buildStart() {
            if (!build) return;
            ref = this.emitFile({
                type: "chunk",
                id: BRAIN_WORKER_ENTRY,
                name: BRAIN_WORKER_CHUNK_NAME,
            });
        },
        // Hook FILTERS, so only the virtual id and the one chunk holding the
        // placeholder reach this plugin's JS — not every module and chunk.
        resolveId: {
            filter: { id: new RegExp(`^${BRAIN_WORKER_MODULE}$`) },
            handler: (id) => (id === BRAIN_WORKER_MODULE ? RESOLVED : null),
        },
        load: {
            filter: { id: new RegExp(`^\\0${BRAIN_WORKER_MODULE}$`) },
            handler: (id) =>
                id === RESOLVED ? brainWorkerModuleSource(build) : null,
        },
        renderChunk: {
            filter: { code: PLACEHOLDER },
            handler(code) {
                if (ref === undefined || !code.includes(PLACEHOLDER))
                    return null;
                return code.replaceAll(
                    PLACEHOLDER,
                    path.basename(this.getFileName(ref))
                );
            },
        },
    };
}

/** The chunk-name prefix of a hand-written Set (`./vite-card-set-chunks`). */
const SET_CHUNK = /(?:^|\/)card-set-[^/]*\.js$/;

/**
 * `build.modulePreload.resolveDependencies`: no preload list for a Set
 * chunk's dynamic import. Vite wraps every `import()` in a helper that, given
 * a non-empty list, adds `<link rel="modulepreload">` tags through `document`
 * — which a Worker has not, so the worker's first Set install would throw.
 * The Set loader (`src/lib/catalogue/set-chunk-loader.ts`) runs in both
 * graphs from the same chunk, so its `import()` gets no list at all; the
 * page then discovers a Set's shared helper chunks when it parses the Set
 * chunk, one round trip later, instead of preloading them beside it. Every
 * other dynamic import keeps Vite's list.
 */
export function workerSafePreloadDependencies(
    filename: string,
    deps: string[]
): string[] {
    return SET_CHUNK.test(filename) ? [] : deps;
}
