// What one more Brain Worker holds (issue #10135), in V8 under Node:
//
//   node --expose-gc docs/research/scripts/brain-bench/memory.mjs <bundle.js> <out.json>
//
// <bundle.js> is `run-ensemble.mjs build`'s. Two figures, both the live JS
// heap after a full collection:
//
//   resident  the bundle evaluated — engine, card catalogue, blade registry —
//             against an empty heap: what every Worker carries before its
//             first search (the app's Worker chunk loads the Manifest rather
//             than the blade registry, so this is an upper bound for it);
//   tree      the grown root of one search held alive, minus the heap with
//             the search over and its root dropped: what each tree adds, at
//             `medium`'s and `expert`'s iteration counts.
//
// The peak during a search (the clones a rollout allocates and drops) is not
// measured: a collection reclaims it, and a phone's budget is set by what
// stays live.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [bundle, out] = process.argv.slice(2);
if (!bundle || !out || typeof globalThis.gc !== "function") {
    console.error("usage: node --expose-gc memory.mjs <bundle.js> <out.json>");
    process.exit(2);
}

const live = () => {
    globalThis.gc();
    globalThis.gc();
    return process.memoryUsage().heapUsed;
};
const MB = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));

const empty = live();
await import(pathToFileURL(path.resolve(bundle)).href);
const bench = globalThis.__brainBench;
const resident = live() - empty;

const ITERATIONS = [400, 1320];
const POSITIONS = [5, 12, 18, 35, 45];
const trees = [];
for (const index of POSITIONS) {
    for (const iterations of ITERATIONS) {
        let held = null;
        bench.ensemble.captureNextRoot((root) => {
            held = root;
        });
        const before = live();
        const row = bench.run(index, { iterations });
        const withTree = live();
        const nodes = held ? countNodes(held) : 0;
        held = null;
        const without = live();
        trees.push({
            index,
            label: row.label,
            iterations,
            completed: row.completed,
            nodes,
            treeMB: MB(withTree - without),
            heapBeforeMB: MB(before),
        });
    }
}

/** Nodes reachable from `root`: children's nodes, option-set views and the
 *  child nodes they share — each counted once. */
function countNodes(root) {
    const seen = new Set();
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        for (const edge of node.children.values()) stack.push(edge.node);
        for (const view of node.optionViews?.values() ?? []) stack.push(view);
        for (const child of node.childNodes?.values() ?? []) stack.push(child);
    }
    return seen.size;
}

const result = {
    runtime: `node ${process.version} (V8 ${process.versions.v8})`,
    residentMB: MB(resident),
    trees,
};
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
