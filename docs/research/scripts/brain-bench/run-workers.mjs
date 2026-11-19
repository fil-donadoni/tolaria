// Root-parallel throughput (issue #10135): how many iterations N Brain
// Workers complete on ONE decision under one time cap, in Chromium, Firefox
// and WebKit through Playwright.
//
//   node docs/research/scripts/brain-bench/run-workers.mjs <bundle.js> <out.json> \
//        [--cap 2000] [--rounds 3] [--positions 4]
//
// <bundle.js> is `run-ensemble.mjs build`'s (any bench bundle works: only
// `__brainBench.run` is used). Per engine, four Workers are spawned once and
// warmed on every position; then, for each position and each N = 1..4 (the
// order rotating by round), the first N Workers search the position at the
// same moment, each from its own seed (`ensemble.mjs`'s `treeSeed`), until the
// wall-clock cap — the shape `expert`'s time cap gives a real decision. The
// first round is a warm-up and is discarded.
//
// Read per position as a ratio to N = 1 within the same round, so load that
// drifts over minutes cancels out: the ensemble's iterations against one
// Worker's, and each Worker's against the lone Worker's (the per-Worker
// slowdown).

import { chromium, firefox, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { parseArgs } from "node:util";

const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        cap: { type: "string", default: "2000" },
        rounds: { type: "string", default: "3" },
        positions: { type: "string", default: "4" },
        engines: { type: "string", default: "chromium,firefox,webkit" },
    },
});
const [bundlePath, out] = positionals;
if (!bundlePath || !out) {
    console.error("usage: run-workers.mjs <bundle.js> <out.json> [options]");
    process.exit(2);
}
const CAP_MS = Number(flags.cap);
const ROUNDS = Number(flags.rounds) + 1; // + the discarded warm-up
const MAX_N = 4;
const ENGINES = { chromium, firefox, webkit };
const load = () => Number(loadavg()[0].toFixed(2));
const bundle = readFileSync(bundlePath, "utf8");

const WORKER_GLUE = `
;self.onmessage = (e) => {
    const { id, index, options } = e.data;
    self.postMessage({ id, row: self.__brainBench.run(index, options) });
};`;

// Same stride as `ensemble.mjs` — kept literal here because this file runs in
// the page, not in the bundle.
const treeSeed = (seed, k) =>
    k === 0 ? seed : (seed + Math.imul(k, 0x9e3779b9)) | 0;

/** Resident set size, in MB, of `pid` and every process below it — the
 *  browser's own memory figure for its Workers, which a page cannot read.
 *  WebKit's content process is not a child of Playwright's launcher (lab note
 *  § Not measured), so WebKit reads null. */
function treeRssMB(pid) {
    if (!pid) return null;
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], {
        encoding: "utf8",
    })
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
    const inTree = new Set([pid]);
    for (let grew = true; grew; ) {
        grew = false;
        for (const [p, parent] of rows) {
            if (!inTree.has(p) && inTree.has(parent)) {
                inTree.add(p);
                grew = true;
            }
        }
    }
    const kb = rows.reduce((n, [p, , rss]) => n + (inTree.has(p) ? rss : 0), 0);
    return Number((kb / 1024).toFixed(1));
}

const settle = () => new Promise((r) => setTimeout(r, 3000));

async function open(name) {
    // A server, not `launch()`: only a server hands out the browser's pid.
    const server = await ENGINES[name].launchServer();
    const browser = await ENGINES[name].connect(server.wsEndpoint());
    const pid = server.process()?.pid ?? null;
    const page = await browser.newPage();
    await page.goto("about:blank");
    await settle();
    const rssBefore = name === "webkit" ? null : treeRssMB(pid);
    await page.evaluate(
        async ({ source, maxN }) => {
            const url = URL.createObjectURL(
                new Blob([source], { type: "text/javascript" })
            );
            window.__workers = Array.from(
                { length: maxN },
                () => new Worker(url)
            );
            window.__ask = (worker, index, options) =>
                new Promise((resolve, reject) => {
                    const id = Math.random();
                    const onMessage = (e) => {
                        if (e.data.id !== id) return;
                        worker.removeEventListener("message", onMessage);
                        resolve(e.data.row);
                    };
                    worker.addEventListener("message", onMessage);
                    worker.addEventListener("error", (e) =>
                        reject(new Error(e.message ?? "worker error"))
                    );
                    worker.postMessage({ id, index, options });
                });
        },
        { source: bundle + WORKER_GLUE, maxN: MAX_N }
    );
    return {
        name,
        server,
        browser,
        page,
        pid,
        rssBefore,
        version: browser.version(),
    };
}

/** Positions with a real search, spread from cheap to expensive by a short
 *  search in Chromium's first Worker. */
async function pickPositions(page, wanted) {
    const rows = await page.evaluate(async () => {
        const out = [];
        for (let index = 0; index < 60; index++) {
            const row = await window.__ask(window.__workers[0], index, {
                iterations: 40,
            });
            if (row.completed) out.push({ index, wallMs: row.wallMs });
        }
        return out;
    });
    rows.sort((a, b) => a.wallMs - b.wallMs);
    const picked = [];
    for (let i = 0; i < wanted; i++) {
        picked.push(
            rows[Math.round(((i + 1) * (rows.length - 1)) / wanted)].index
        );
    }
    return [...new Set(picked)];
}

const engines = [];
for (const name of flags.engines.split(",")) {
    try {
        engines.push(await open(name));
    } catch (cause) {
        console.error(`${name}: could not start — ${cause.message}`);
        engines.push({ name, failed: String(cause.message) });
    }
}
const live = engines.filter((e) => !e.failed);
const positions = await pickPositions(live[0].page, Number(flags.positions));

const rows = [];
for (const engine of live) {
    // Warm every Worker on every position: script evaluation and JIT are not
    // what this measures.
    await engine.page.evaluate(
        async ({ positions }) => {
            for (const index of positions) {
                await Promise.all(
                    window.__workers.map((w) =>
                        window.__ask(w, index, { iterations: 30 })
                    )
                );
            }
        },
        { positions }
    );
    await settle();
    const rssAfter = engine.rssBefore === null ? null : treeRssMB(engine.pid);
    engine.rssPerWorkerMB =
        rssAfter === null
            ? null
            : Number(((rssAfter - engine.rssBefore) / MAX_N).toFixed(1));
    for (let round = 0; round < ROUNDS; round++) {
        for (const index of positions) {
            const ns = [1, 2, 3, 4];
            const shift = (round + index) % ns.length;
            for (const n of [...ns.slice(shift), ...ns.slice(0, shift)]) {
                const seeds = Array.from({ length: n }, (_, k) =>
                    treeSeed(0xb1ade, k)
                );
                const workers = await engine.page.evaluate(
                    ({ index, seeds, cap }) =>
                        Promise.all(
                            seeds.map((seed, k) =>
                                window.__ask(window.__workers[k], index, {
                                    iterations: 1e6,
                                    timeMs: cap,
                                    seed,
                                })
                            )
                        ),
                    { index, seeds, cap: CAP_MS }
                );
                rows.push({
                    engine: engine.name,
                    round,
                    index,
                    n,
                    completed: workers.map((w) => w.completed),
                    deviceMs: workers.map((w) => w.deviceMs),
                    load: load(),
                });
            }
        }
        process.stderr.write(`${engine.name} round ${round + 1}/${ROUNDS}\n`);
    }
}

writeFileSync(
    out,
    JSON.stringify(
        {
            cpu: cpus()[0]?.model ?? "unknown",
            cores: cpus().length,
            capMs: CAP_MS,
            engines: engines.map((e) => ({
                name: e.name,
                version: e.version ?? null,
                rssPerWorkerMB: e.rssPerWorkerMB ?? null,
                failed: e.failed ?? null,
            })),
            positions,
            rows,
        },
        null,
        1
    )
);
for (const engine of live) await engine.server.close();
console.log(`wrote ${out}`);
