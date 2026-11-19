// Tree reuse (issue #10136): what a search's grown tree still holds at the
// Bot's next decision, over blade `must` entries (`entry-reuse.mjs`).
//
//   node docs/research/scripts/brain-bench/run-reuse.mjs build <bundle.js>
//   node docs/research/scripts/brain-bench/run-reuse.mjs run <bundle.js> <out.jsonl> \
//        [--iterations 400] [--every 3] [--slice 1/4]
//   node docs/research/scripts/brain-bench/run-reuse.mjs summarize <out.jsonl>...
//
// Iterations-only searches (no clock), so a row is reproducible from the
// entry, its first declared seed and the budget. `--slice i/n` runs every
// n-th sampled entry from the i-th, so n processes share the sample.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleBench } from "./bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);

function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}

if (command === "build" && rest[0]) {
    mkdirSync(path.dirname(path.resolve(rest[0])), { recursive: true });
    await bundleBench(path.join(here, "entry-reuse.mjs"), rest[0], {
        rootHook: true,
    });
    console.log(`built ${rest[0]}`);
} else if (command === "run" && rest[0] && rest[1]) {
    const [bundle, out] = rest;
    const iterations = Number(option("iterations", "400"));
    const every = Number(option("every", "3"));
    const [si, sn] = option("slice", "1/1").split("/").map(Number);
    await import(pathToFileURL(path.resolve(bundle)).href);
    const { count, reuse } = globalThis.__brainReuse;
    const jobs = [...Array(count).keys()]
        .filter((i) => i % every === 0)
        .filter((_, j) => j % sn === si - 1);
    writeFileSync(out, "");
    const started = Date.now();
    for (const [j, index] of jobs.entries()) {
        let row;
        try {
            row = reuse(index, { iterations });
        } catch (error) {
            row = { index, error: String(error).slice(0, 200) };
        }
        row.load = Number(loadavg()[0].toFixed(1));
        appendFileSync(out, JSON.stringify(row) + "\n");
        process.stderr.write(
            `[${si}/${sn}] ${j + 1}/${jobs.length} ${Math.round((Date.now() - started) / 1000)}s\n`
        );
    }
    console.log(`wrote ${out}: ${jobs.length} entries`);
} else if (command === "summarize" && rest.length > 0) {
    summarize(
        rest.flatMap((f) =>
            readFileSync(f, "utf8")
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l))
        )
    );
} else {
    console.error(
        "usage: run-reuse.mjs build <bundle.js> | run <bundle.js> <out.jsonl> [options] | summarize <out.jsonl>..."
    );
    process.exit(2);
}

function quantiles(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
    const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return { n: s.length, mean, p25: q(0.25), p50: q(0.5), p75: q(0.75) };
}

function pct(x) {
    return `${(100 * x).toFixed(0)}%`;
}

function line(name, xs) {
    const q = quantiles(xs);
    return `${name.padEnd(34)} n=${String(q.n).padStart(3)}  mean ${pct(q.mean).padStart(4)}  p25 ${pct(q.p25).padStart(4)}  p50 ${pct(q.p50).padStart(4)}  p75 ${pct(q.p75).padStart(4)}`;
}

function summarize(rows) {
    const searched = rows.filter((r) => r.searched);
    console.log(
        `rows ${rows.length}, searched ${searched.length}, errors ${rows.filter((r) => r.error).length}, load max ${Math.max(...rows.map((r) => r.load ?? 0))}`
    );
    // Case A: the Bot decides again right after its own move.
    const a = searched.filter(
        (r) => r.search.reached === "bot" && r.search.steps.length === 1
    );
    console.log(`\ncase A — Bot decides again right after its move (${a.length})`);
    console.log(line("kept share of root visits", a.map((r) => r.search.keptVisits / r.total)));
    // Case B: the opponent decides in between.
    for (const reply of ["search", "tree", "pass"]) {
        const b = searched.filter(
            (r) => r[reply].steps.length > 1 && r[reply].reached === "bot"
        );
        console.log(`\ncase B — opponent replies (${reply}), Bot decides again (${b.length})`);
        console.log(line("under Bot move (1st step)", b.map((r) => r[reply].steps[0].visits / r.total)));
        console.log(line("kept at Bot's next decision", b.map((r) => r[reply].keptVisits / r.total)));
        const crossed = b.filter((r) => r[reply].crossedTurn);
        console.log(line("  of which crossed a turn", crossed.map((r) => r[reply].keptVisits / r.total)));
        const off = b.filter((r) => r[reply].keptVisits === 0).length;
        console.log(`  off the tree (0 kept): ${off}/${b.length}; Bot drew on the way: ${b.filter((r) => r[reply].botDrew).length}`);
    }
    const reached = {};
    for (const r of searched) reached[r.search.reached] = (reached[r.search.reached] ?? 0) + 1;
    console.log(`\nwalk ends (search reply): ${JSON.stringify(reached)}`);
}
