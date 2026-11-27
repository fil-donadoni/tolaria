// Read an engine change against its base (issue #10023): the number every
// engine-speed PR quotes. A research script, never a gate.
//
//   node docs/research/scripts/brain-bench/compare.mjs <base-ref> [<head-ref>]
//        [--rounds 3] [--iterations 400] [--out <result.json>]
//        [--position <fixture.json>]...
//
// `--position` (issue #10755) searches the named fixtures INSTEAD of the
// blade positions: a field fixture (`field-position.mjs`) or a spec one
// (`positions/`), each through `entry.mjs`'s `runField`. Repeatable.
//
// With no <head-ref> the head is the working tree as it stands. Both sides
// are bundled from their own `convex/` and `data/catalogue/` (a ref through
// `git archive`, cached under `node_modules/.cache/brain-bench/`) with the
// working tree's `entry.mjs` and the same esbuild options (`bundle.mjs`), so
// the harness is identical and only the engine differs.
//
// The method is the lab note's (`brain-search-off-the-dev-machine.md`
// § Method): both bundles run in ONE Node process on the process CPU clock,
// every position searched at a fixed iteration count with no time cap, base
// and head back to back within a round, the order alternating by position
// and round, one warm-up round discarded. Load that drifts over minutes
// cancels out of a per-position ratio.
//
// It prints the head/base ratio of CPU time per iteration (p10 / median / p90
// over the searched positions, each position's ratio the median of its
// rounds) and the share of searches whose chosen move differs. A position
// with one forced move (no search) is skipped. Base against itself reads the
// noise floor: `compare.mjs origin/<base> origin/<base>`.

import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { bundleBench } from "./bundle.mjs";
import { median, percentile } from "./stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, "entry.mjs");
const BENCH_DIR = "docs/research/scripts/brain-bench";
// What the bundle reads from a tree: the engine and the card catalogue
// (esbuild's metafile, 2026-11-16: `convex/**` plus two `data/catalogue/`
// files; the rest comes from `node_modules`).
const TREE_PATHS = ["convex", "data/catalogue"];

const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        rounds: { type: "string", default: "3" },
        iterations: { type: "string" },
        out: { type: "string" },
        position: { type: "string", multiple: true },
    },
});
const [baseRef, headRef] = positionals;
const rounds = Number(flags.rounds);
if (!baseRef || positionals.length > 2 || !(rounds >= 1)) {
    console.error(
        "usage: compare.mjs <base-ref> [<head-ref>] [--rounds N] [--iterations N] [--out file.json] [--position fixture.json]..."
    );
    process.exit(2);
}

const git = (...args) =>
    execFileSync("git", args, { cwd: here, encoding: "utf8" }).trim();
const root = git("rev-parse", "--show-toplevel");
const cache = path.join(root, "node_modules", ".cache", "brain-bench");

/** A ref's tree, extracted once per commit under the cache. Inside the
 *  repository, so its bare imports resolve to the root's `node_modules`. */
function extractTree(ref) {
    const sha = git("rev-parse", "--verify", `${ref}^{commit}`);
    const dir = path.join(cache, "trees", sha);
    if (!existsSync(dir)) {
        // Per process: a concurrent run on the same commit never shares it.
        const partial = `${dir}.partial-${process.pid}`;
        rmSync(partial, { recursive: true, force: true });
        mkdirSync(partial, { recursive: true });
        execFileSync(
            "bash",
            [
                "-c",
                'set -o pipefail; s=$1 d=$2; shift 2; git archive --format=tar "$s" -- "$@" | tar -x -C "$d"',
                "bash",
                sha,
                partial,
                ...TREE_PATHS,
            ],
            { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
        );
        try {
            renameSync(partial, dir);
        } catch (error) {
            // A concurrent run extracted the same commit first: keep its tree.
            if (!existsSync(dir)) throw error;
            rmSync(partial, { recursive: true, force: true });
        }
    }
    return { sha, dir };
}

/** Bundle one side. `ref` undefined = the working tree. The output file is
 *  per SIDE, so base against itself still loads two separate bundles. */
async function buildSide(side, ref) {
    let entry = ENTRY;
    let sha = null;
    if (ref !== undefined) {
        const tree = extractTree(ref);
        sha = tree.sha;
        entry = path.join(tree.dir, BENCH_DIR, "entry.mjs");
        mkdirSync(path.dirname(entry), { recursive: true });
        copyFileSync(ENTRY, entry);
    }
    // Per side AND per process: two concurrent runs never share a file.
    const outfile = path.join(cache, `${side}-${process.pid}.js`);
    await bundleBench(entry, outfile);
    // Each IIFE assigns `globalThis.__brainBench`: take it before the next.
    await import(pathToFileURL(outfile).href);
    rmSync(outfile);
    const bench = globalThis.__brainBench;
    delete globalThis.__brainBench;
    return {
        ref: ref ?? "working tree",
        sha: sha ?? `${git("rev-parse", "HEAD")}${dirty() ? "+dirty" : ""}`,
        bench,
    };
}

function dirty() {
    return (
        git(
            "-C",
            root,
            "status",
            "--porcelain",
            "--",
            ...TREE_PATHS,
            BENCH_DIR
        ) !== ""
    );
}

const load = () => Number(loadavg()[0].toFixed(2));

const base = await buildSide("base", baseRef);
const head = await buildSide("head", headRef);
// `--position`: the fixtures stand in for the blade positions on both sides.
const fixtures = (flags.position ?? []).map((file) =>
    JSON.parse(readFileSync(file, "utf8"))
);
if (fixtures.length > 0) {
    for (const side of [base, head]) {
        side.bench = {
            ...side.bench,
            count: fixtures.length,
            labels: fixtures.map((f) => f.label),
            run: (index, options) =>
                side.bench.runField(fixtures[index], options),
        };
    }
}
// Positions pair by index: both sides must hold the same set, in order.
if (base.bench.labels.join("\n") !== head.bench.labels.join("\n")) {
    console.error(
        `position sets differ: base ${base.bench.count}, head ${head.bench.count} (or a different order)`
    );
    process.exit(1);
}
const iterations = Number(
    flags.iterations ?? base.bench.budgets.medium.iterations
);
const options = { iterations, clock: "cpu" };
const count = base.bench.count;

const loadStart = load();
const started = Date.now();
// rows[index][round] = { base, head }; round 0 is the warm-up.
const rows = Array.from({ length: count }, () => []);
for (let round = 0; round <= rounds; round++) {
    for (let index = 0; index < count; index++) {
        const pair = {};
        const order =
            (index + round) % 2 === 0
                ? [
                      ["base", base],
                      ["head", head],
                  ]
                : [
                      ["head", head],
                      ["base", base],
                  ];
        for (const [name, side] of order) {
            pair[name] = side.bench.run(index, options);
        }
        rows[index].push(pair);
    }
    process.stderr.write(
        `${round === 0 ? "warm-up" : `round ${round}/${rounds}`} done\r`
    );
}
const loadEnd = load();
process.stderr.write("\n");

const perIteration = (r) => r.cpuMs / r.completed;
// A forced move returns before any iteration (`summarize.mjs` counts the same).
const searched = (r) => r.completed > 0;

const positions = [];
for (let index = 0; index < count; index++) {
    const measured = rows[index].slice(1);
    if (!measured.every((p) => searched(p.base) && searched(p.head))) continue;
    const ratios = measured.map(
        (p) => perIteration(p.head) / perIteration(p.base)
    );
    const choice = (name) => new Set(measured.map((p) => p[name].move));
    positions.push({
        index,
        label: base.bench.labels[index],
        ratio: median(ratios),
        baseMsPerIteration: median(measured.map((p) => perIteration(p.base))),
        headMsPerIteration: median(measured.map((p) => perIteration(p.head))),
        moved: measured[0].base.move !== measured[0].head.move,
        // A fixed iteration count and seed make a search deterministic: a
        // side whose choice changes between rounds is a finding in itself.
        unstable: choice("base").size > 1 || choice("head").size > 1,
    });
}

const ratios = positions.map((p) => p.ratio);
const moved = positions.filter((p) => p.moved).length;
const unstable = positions.filter((p) => p.unstable).length;
const fmt = (n, digits) => (Number.isFinite(n) ? n.toFixed(digits) : "–");
const quantiles = (values, digits) =>
    [10, 50, 90].map((p) => fmt(percentile(values, p), digits));
const row = (...cells) => `| ${cells.join(" | ")} |`;

console.log(`base  ${base.ref} (${base.sha.slice(0, 9)})`);
console.log(
    `head  ${head.ref} (${head.sha.slice(0, 9)}${head.sha.endsWith("+dirty") ? "+dirty" : ""})`
);
console.log(
    `${positions.length} searched positions of ${count}, ${iterations} iterations, ` +
        `${rounds} rounds + 1 warm-up, CPU clock, ${process.version}`
);
console.log(
    `load average ${loadStart} → ${loadEnd}, ${Math.round((Date.now() - started) / 1000)} s`
);
console.log("");
console.log(row("", "p10", "median", "p90"));
console.log(row("---", "---", "---", "---"));
console.log(row("head/base, CPU ms per iteration", ...quantiles(ratios, 3)));
console.log(
    row(
        "base CPU ms per iteration",
        ...quantiles(
            positions.map((p) => p.baseMsPerIteration),
            2
        )
    )
);
console.log(
    row(
        "head CPU ms per iteration",
        ...quantiles(
            positions.map((p) => p.headMsPerIteration),
            2
        )
    )
);
console.log("");
console.log(
    `moved choice: ${moved}/${positions.length} (${fmt((100 * moved) / positions.length, 1)}%)`
);
if (unstable > 0) {
    console.log(
        `UNSTABLE: ${unstable} position(s) chose differently across rounds on one side`
    );
}

if (flags.out) {
    writeFileSync(
        flags.out,
        JSON.stringify(
            {
                base: { ref: base.ref, sha: base.sha },
                head: { ref: head.ref, sha: head.sha },
                iterations,
                rounds,
                runtime: `node ${process.version} (V8 ${process.versions.v8})`,
                cpu: cpus()[0]?.model ?? "unknown",
                load: { start: loadStart, end: loadEnd },
                positions,
                rows,
            },
            null,
            1
        )
    );
    console.log(`wrote ${flags.out}`);
}
