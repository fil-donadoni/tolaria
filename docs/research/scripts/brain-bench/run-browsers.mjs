// The Brain lab bench in real browsers (issue #9527): Chromium, Firefox and
// WebKit through Playwright, running the SAME bundle as `run-engines.mjs`.
//
//   node docs/research/scripts/brain-bench/run-browsers.mjs <bundle.js> <out.json>
//
// A browser has only a wall clock, and this bench runs on a machine that is
// rarely idle, so it reports RATIOS measured in interleaved rounds rather than
// absolute times: within one round every engine searches the same position
// back to back, so load that drifts over minutes cancels out of the ratio.
//
//   engines     each position searched at a fixed iteration count, no time
//               cap, in every engine: time relative to Chromium.
//   contention  in each engine, a Brain Worker searching alone against the
//               same search while a SECOND Brain Worker runs an uncapped
//               search beside it: the slowdown a second Worker costs.

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";

const [bundlePath, out] = process.argv.slice(2);
if (!bundlePath || !out) {
    console.error("usage: run-browsers.mjs <bundle.js> <out.json>");
    process.exit(2);
}

const ENGINES = { chromium, firefox, webkit };
const ITERATIONS = 400;
const ROUNDS = 4; // the first is a warm-up and is discarded
const CONTENTION_PAIRS = 6;
const load = () => Number(loadavg()[0].toFixed(2));
const bundle = readFileSync(bundlePath, "utf8");

const WORKER_GLUE = `
;self.onmessage = (e) => {
    const { id, index, options, spin } = e.data;
    if (spin) {
        // The second Worker: an uncapped search, over and over, until it is
        // terminated. It never yields, like a judge search that outlasts
        // everything.
        for (;;) self.__brainBench.run(index, { iterations: 100000 });
    }
    self.postMessage({ id, row: self.__brainBench.run(index, options) });
};`;

async function open(name) {
    const type = ENGINES[name];
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    // The Worker's source is the same bundle plus a message pump.
    await page.evaluate(
        ({ source }) => {
            window.__workerUrl = URL.createObjectURL(
                new Blob([source], { type: "text/javascript" })
            );
            window.__searchInWorker = (worker, index, options) =>
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
        { source: bundle + WORKER_GLUE }
    );
    return { name, browser, page, version: browser.version() };
}

/** Positions with a real search behind them, spread from cheap to expensive. */
async function pickPositions(page) {
    const rows = await page.evaluate((iterations) => {
        const bench = window.__brainBench;
        const out = [];
        for (let index = 0; index < bench.count; index++) {
            const row = bench.run(index, { iterations: 60 });
            if (row.completed) out.push({ index, wallMs: row.wallMs });
        }
        return out;
    }, ITERATIONS);
    rows.sort((a, b) => a.wallMs - b.wallMs);
    const picked = [];
    const wanted = 12;
    for (let i = 0; i < wanted; i++) {
        picked.push(
            rows[Math.round((i * (rows.length - 1)) / (wanted - 1))].index
        );
    }
    return [...new Set(picked)];
}

const engines = [];
for (const name of Object.keys(ENGINES)) {
    try {
        engines.push(await open(name));
    } catch (cause) {
        console.error(`${name}: could not start — ${cause.message}`);
        engines.push({ name, failed: String(cause.message) });
    }
}
const live = engines.filter((e) => !e.failed);
const positions = await pickPositions(live[0].page);

// ── engines ────────────────────────────────────────────────────────────────
const engineRows = [];
for (let round = 0; round < ROUNDS; round++) {
    for (const index of positions) {
        // Rotate who goes first so no engine always runs on the freshest core.
        const order = live.map(
            (_, i) => live[(i + round + index) % live.length]
        );
        for (const engine of order) {
            const row = await engine.page.evaluate(
                ({ index, iterations }) =>
                    window.__brainBench.run(index, { iterations }),
                { index, iterations: ITERATIONS }
            );
            engineRows.push({
                round,
                engine: engine.name,
                ...row,
                load: load(),
            });
        }
    }
    process.stderr.write(`engines round ${round + 1}/${ROUNDS}\r`);
}

// ── contention ─────────────────────────────────────────────────────────────
// The three most expensive picked positions: long enough that Worker start-up
// is noise.
const heavy = positions.slice(-3);
const contentionRows = [];
for (const engine of live) {
    for (let pair = 0; pair < CONTENTION_PAIRS; pair++) {
        for (const index of heavy) {
            for (const contended of pair % 2 === 0
                ? [false, true]
                : [true, false]) {
                const row = await engine.page.evaluate(
                    async ({ index, iterations, contended, spinIndex }) => {
                        const bot = new Worker(window.__workerUrl);
                        // Warm the Bot's Worker: script evaluation and JIT are
                        // not what this measures.
                        await window.__searchInWorker(bot, index, {
                            iterations: 40,
                        });
                        let second = null;
                        if (contended) {
                            second = new Worker(window.__workerUrl);
                            second.postMessage({
                                id: 0,
                                index: spinIndex,
                                spin: true,
                            });
                            // Let the second Worker load and start searching.
                            await new Promise((r) => setTimeout(r, 1500));
                        }
                        const row = await window.__searchInWorker(bot, index, {
                            iterations,
                        });
                        bot.terminate();
                        second?.terminate();
                        return row;
                    },
                    {
                        index,
                        iterations: ITERATIONS,
                        contended,
                        spinIndex: heavy[heavy.length - 1],
                    }
                );
                contentionRows.push({
                    engine: engine.name,
                    pair,
                    contended,
                    ...row,
                    load: load(),
                });
            }
        }
        process.stderr.write(
            `contention ${engine.name} ${pair + 1}/${CONTENTION_PAIRS}   \r`
        );
    }
}

writeFileSync(
    out,
    JSON.stringify(
        {
            cpu: cpus()[0]?.model ?? "unknown",
            cores: cpus().length,
            iterations: ITERATIONS,
            rounds: ROUNDS,
            engines: engines.map((e) => ({
                name: e.name,
                version: e.version ?? null,
                failed: e.failed ?? null,
            })),
            positions,
            engineRows,
            contentionRows,
        },
        null,
        1
    )
);
for (const engine of live) await engine.browser.close();
console.log(`\nwrote ${out}`);
