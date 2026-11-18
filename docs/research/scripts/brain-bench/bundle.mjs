// The bench bundle's esbuild options, in ONE place (issue #9527, issue
// #10023): `build.mjs` bundles the working tree with them and `compare.mjs`
// bundles a base and a head with them, so every bundle the bench reads was
// built the same way.

import { build } from "esbuild";
import { readFile } from "node:fs/promises";

/**
 * The root-parallel prototype's seam (issue #10135), patched into
 * `convex/gre/search.ts` AT BUNDLE TIME, never in the source tree: the search
 * does not hand its root out, and the prototype needs N roots to merge.
 *
 *   - `searchWithTrace` becomes a wrapper that hands the call to
 *     `globalThis.__benchSearch(inner, args)` when one is installed — the
 *     ensemble driver (`ensemble.mjs`) runs N searches through `inner`;
 *   - before the iteration loop, `globalThis.__benchRootDeny(denied, keys)`
 *     may add root candidates (by tree key, in enumeration order) to the
 *     root's deny-set — a ROOT SPLIT, each tree searching its own share;
 *   - after the iteration loop, `globalThis.__benchRootHook(root, stats)`
 *     may capture the grown root or REPLACE it (and its stats) with a merged
 *     one, so root selection and the trace read the merge exactly as they
 *     read a single tree today.
 *
 * With no global installed the patched bundle searches byte-identically
 * to an unpatched one. Each replacement must match exactly once, or the build
 * throws: a silently unapplied patch would measure one tree as an ensemble.
 */
const ROOT_HOOK_PATCHES = [
    [
        "export function searchWithTrace(",
        "export function searchWithTrace(...__args) {\n" +
            "    return globalThis.__benchSearch\n" +
            "        ? globalThis.__benchSearch(__searchWithTraceInner, __args)\n" +
            "        : __searchWithTraceInner(...__args);\n" +
            "}\n" +
            "function __searchWithTraceInner(",
    ],
    ["    const root = newNode();\n", "    let root = newNode();\n"],
    [
        "    // The root moves whose subtree prunes misdirected variants\n",
        "    globalThis.__benchRootDeny?.(\n" +
            "        deniedRootKeys,\n" +
            "        moves.map((m) => priorityMoveKey(state, playerId, playerId, m))\n" +
            "    );\n" +
            "    // The root moves whose subtree prunes misdirected variants\n",
    ],
    ["    const stats: SearchStats = {\n", "    let stats: SearchStats = {\n"],
    [
        "    const picked: { mechanism: RootDecisionMechanism } = {\n",
        "    if (globalThis.__benchRootHook) {\n" +
            "        ({ root, stats } = globalThis.__benchRootHook(root, stats));\n" +
            "    }\n" +
            "    const picked: { mechanism: RootDecisionMechanism } = {\n",
    ],
];

const rootHookPlugin = {
    name: "brain-bench-root-hook",
    setup(b) {
        b.onLoad({ filter: /convex[\\/]gre[\\/]search\.ts$/ }, async (args) => {
            let source = await readFile(args.path, "utf8");
            for (const [from, to] of ROOT_HOOK_PATCHES) {
                const count = source.split(from).length - 1;
                if (count !== 1) {
                    throw new Error(
                        `root hook: expected one ${JSON.stringify(from)} in search.ts, found ${count}`
                    );
                }
                source = source.replace(from, to);
            }
            return { contents: source, loader: "ts" };
        });
    },
};

/** Bundle `entry` (an `entry.mjs`) into the single script `outfile`.
 *  `rootHook` adds the root-parallel seam above (issue #10135). */
export async function bundleBench(entry, outfile, { rootHook = false } = {}) {
    await build({
        entryPoints: [entry],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        // No `keepNames`: its `__name` helper runs at every closure creation
        // and took 5–7% of a search in the profile. Nothing is minified, so
        // function names survive without it — and the app's own Worker chunk
        // has no such helper either.
        outfile,
        logLevel: "warning",
        plugins: rootHook ? [rootHookPlugin] : [],
    });
}
