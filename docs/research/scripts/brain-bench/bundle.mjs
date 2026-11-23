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

/**
 * The rollout-policy prototype's seam (issue #10134), patched into
 * `convex/gre/search.ts` AT BUNDLE TIME like the root seam above:
 *
 *   - `rollout` becomes a wrapper that hands the call to
 *     `globalThis.__benchRollout(inner, args)` when one is installed — the
 *     counters (`rollout-policies.mjs`) see where a rollout starts and ends;
 *   - `selectRolloutMove` becomes a wrapper that hands the call to
 *     `globalThis.__benchPolicy(inner, args)` — a candidate policy may play
 *     its own move, or call the greedy pick on fewer candidates;
 *   - the ply loop reads `globalThis.__benchMaxPlies` before
 *     `MAX_ROLLOUT_PLIES` — a shorter rollout, closed by the evaluation;
 *   - every rollout ply reports itself to `globalThis.__benchPly(kind, n)`:
 *     a forced pass, or a played move and the candidates it was chosen from;
 *   - `searchWithTrace` leaves its trace in `globalThis.__benchLastTrace`: the
 *     blade runner does not hand out the iterations a search completed;
 *   - `rolloutEpsilonFor` returns `globalThis.__benchEpsilon` when one is
 *     set: at 1 every rollout ply takes the rollout's OWN random branch, its
 *     exclusion filters included — the faithful random playout.
 *   - the rollout's probe cut (`rolloutProbeCandidates`, ADR 0184, issue
 *     #10473) is skipped while `globalThis.__benchProbeAll` is set: the
 *     greedy pick is handed every candidate, today's policy before the cut,
 *     which is what every policy of `rollout-policies.mjs` but `shipped`
 *     measures against.
 *
 * With no global installed the patched bundle searches byte-identically to
 * an unpatched one. Each replacement must match exactly once.
 */
const ROLLOUT_HOOK_PATCHES = [
    [
        "export function searchWithTrace(",
        "export function searchWithTrace(...__args) {\n" +
            "    const __result = __searchWithTraceInner(...__args);\n" +
            "    globalThis.__benchLastTrace = __result.trace;\n" +
            "    return __result;\n" +
            "}\n" +
            "function __searchWithTraceInner(",
    ],
    [
        "export function rollout(",
        "export function rollout(...__args) {\n" +
            "    return globalThis.__benchRollout\n" +
            "        ? globalThis.__benchRollout(__rolloutInner, __args)\n" +
            "        : __rolloutInner(...__args);\n" +
            "}\n" +
            "function __rolloutInner(",
    ],
    [
        "export function selectRolloutMove(",
        "export function selectRolloutMove(...__args) {\n" +
            "    return globalThis.__benchPolicy\n" +
            "        ? globalThis.__benchPolicy(__selectRolloutMoveInner, __args)\n" +
            "        : __selectRolloutMoveInner(...__args);\n" +
            "}\n" +
            "function __selectRolloutMoveInner(",
    ],
    [
        "for (let ply = 0; ply < MAX_ROLLOUT_PLIES; ply++) {",
        "for (let ply = 0; ply < (globalThis.__benchMaxPlies ?? MAX_ROLLOUT_PLIES); ply++) {",
    ],
    [
        "applyMoveInSearch(state, pid, FORCED_PASS, true);",
        'globalThis.__benchPly?.("forced", 1);\n' +
            "            applyMoveInSearch(state, pid, FORCED_PASS, true);",
    ],
    [
        "applyMoveInSearch(state, pid, chosen, true);",
        'globalThis.__benchPly?.("played", moves.length);\n' +
            "        applyMoveInSearch(state, pid, chosen, true);",
    ],
    [
        "                rolloutProbeCandidates(\n",
        "                (globalThis.__benchProbeAll\n" +
            "                    ? (moves) => moves.slice()\n" +
            "                    : rolloutProbeCandidates)(\n",
    ],
    [
        "    if (!inCombat) return weights.rolloutEpsilon;",
        "    if (globalThis.__benchEpsilon !== undefined) {\n" +
            "        return globalThis.__benchEpsilon;\n" +
            "    }\n" +
            "    if (!inCombat) return weights.rolloutEpsilon;",
    ],
];

/**
 * The leaf-parallel prototype's seam (issue #10450), patched into
 * `convex/gre/search.ts` AT BUNDLE TIME like the two seams above: one tree,
 * its rollouts handed to `globalThis.__benchLeaf` (`leaf-parallel.mjs`).
 *
 *   - the two rollout sites (`puctDescend`'s and `iterate`'s expansion) call
 *     `__benchLeaf(path, world, botId, rng, weights, since)` when one is
 *     installed: it may roll out at once, or put a virtual loss on `path`,
 *     dispatch the rollout and backpropagate it later;
 *   - `iterate` reports its start to `__benchIterStart(rootState, botId,
 *     deckKnowledge, opponentModel)` and determinizes from
 *     `__benchWorldRng(rng)` when one is set: a world drawn from its own
 *     seed, so a helper can draw the same world again;
 *   - the three moves the descent applies are reported to
 *     `__benchTrail(pid, move)`: the path a helper replays on that world;
 *   - after the iteration loop, `__benchDrain(stoppedBy)` backpropagates or
 *     drops what is still in flight and returns the number dropped, which
 *     leaves the completed count;
 *   - the module's own `rollout`, `backpropagate`, `applyMoveInSearch`,
 *     `advanceToDecision`, `determinize` and `makeRng` are left on
 *     `globalThis.__benchSearchApi` for the driver and the helpers.
 *
 * With no global installed the patched bundle searches byte-identically to an
 * unpatched one. Each replacement must match its stated count (once when
 * none is stated).
 */
const LEAF_HOOK_PATCHES = [
    [
        "    backpropagate(path, rollout(world, botId, rng, weights, since), botId);\n    return true;\n",
        "    if (globalThis.__benchLeaf) {\n" +
            "        globalThis.__benchLeaf(path, world, botId, rng, weights, since);\n" +
            "        return true;\n" +
            "    }\n" +
            "    backpropagate(path, rollout(world, botId, rng, weights, since), botId);\n" +
            "    return true;\n",
    ],
    [
        "            backpropagate(\n                path,\n                rollout(world, botId, rng, weights, since),\n                botId\n            );\n            return;\n",
        "            if (globalThis.__benchLeaf) {\n" +
            "                globalThis.__benchLeaf(path, world, botId, rng, weights, since);\n" +
            "                return;\n" +
            "            }\n" +
            "            backpropagate(\n                path,\n                rollout(world, botId, rng, weights, since),\n                botId\n            );\n            return;\n",
    ],
    [
        "    const world = determinize(\n        rootState,\n        botId,\n        rng,\n",
        "    globalThis.__benchIterStart?.(rootState, botId, deckKnowledge, opponentModel);\n" +
            "    const world = determinize(\n        rootState,\n        botId,\n" +
            "        globalThis.__benchWorldRng ? globalThis.__benchWorldRng(rng) : rng,\n",
    ],
    [
        "applyMoveInSearch(world, pid, bestKeyed!.move);",
        "globalThis.__benchTrail?.(pid, bestKeyed!.move);\n" +
            "    applyMoveInSearch(world, pid, bestKeyed!.move);",
        2,
    ],
    [
        "applyMoveInSearch(world, pid, pick.move);",
        "globalThis.__benchTrail?.(pid, pick.move);\n" +
            "            applyMoveInSearch(world, pid, pick.move);",
    ],
    [
        "    // Read here, before the root pick below probes candidates of its own.\n",
        "    i -= globalThis.__benchDrain?.(stoppedBy) ?? 0;\n" +
            "    // Read here, before the root pick below probes candidates of its own.\n",
    ],
];

/** Appended to `search.ts` under the leaf seam: the module's own functions,
 *  for the driver and the helper Workers. */
const LEAF_API =
    "\nglobalThis.__benchSearchApi = { rollout, backpropagate, applyMoveInSearch, advanceToDecision, determinize, makeRng };\n";

/** A plugin applying `patches` to `search.ts`, each exactly as many times as
 *  its third element says (once when it has none); `append` goes at the end. */
function searchPatchPlugin(name, patches, append = "") {
    return {
        name,
        setup(b) {
            b.onLoad(
                { filter: /convex[\\/]gre[\\/]search\.ts$/ },
                async (args) => {
                    let source = await readFile(args.path, "utf8");
                    for (const [from, to, expected = 1] of patches) {
                        const count = source.split(from).length - 1;
                        if (count !== expected) {
                            throw new Error(
                                `${name}: expected ${expected} ${JSON.stringify(from)} in search.ts, found ${count}`
                            );
                        }
                        source = source.split(from).join(to);
                    }
                    return { contents: source + append, loader: "ts" };
                }
            );
        },
    };
}

/** Bundle `entry` (an `entry.mjs`) into the single script `outfile`.
 *  `rootHook` adds the root-parallel seam above (issue #10135),
 *  `rolloutHook` the rollout-policy seam (issue #10134), `leafHook` the
 *  leaf-parallel seam (issue #10450); one of them at most. */
export async function bundleBench(
    entry,
    outfile,
    { rootHook = false, rolloutHook = false, leafHook = false } = {}
) {
    if ([rootHook, rolloutHook, leafHook].filter(Boolean).length > 1) {
        throw new Error("bundleBench: one search.ts seam per bundle");
    }
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
        plugins: rootHook
            ? [searchPatchPlugin("root hook", ROOT_HOOK_PATCHES)]
            : rolloutHook
              ? [searchPatchPlugin("rollout hook", ROLLOUT_HOOK_PATCHES)]
              : leafHook
                ? [searchPatchPlugin("leaf hook", LEAF_HOOK_PATCHES, LEAF_API)]
                : [],
    });
}
