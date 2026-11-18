// Firefox against Chromium, axis by axis (issue #10122): the lab measured
// Firefox at 2.0x Chromium on blade positions on the page's main thread; the
// field read 4.4x. This bench varies, one at a time, what separates the two:
//
//   position  blade boards against field ones (`field-position.mjs`)
//   thread    the page's main thread against a DOM Worker — where the app's
//             Brain searches
//   build     Playwright's patched Firefox against a release Firefox
//             (`--firefox <binary>`, driven through WebDriver BiDi)
//
// `--browsers` names the Playwright engines read against Chromium (default
// `firefox`; `webkit` for WebKit's gap, issue #10123, or `firefox,webkit`).
//
//   node docs/research/scripts/brain-bench/run-gecko-gap.mjs <bundle.js> <out.json> \
//       [--browsers firefox|webkit|firefox,webkit] [--firefox <binary>] \
//       [--blade-iterations N] [--field-iterations N] [--rounds N] <position>...
//
// A position is a blade index or a field fixture's path. Wall clock, as every
// browser run (`run-browsers.mjs`): each round searches every position in
// every browser and thread back to back, the browser order rotating, after a
// warm-up round that is discarded; the summary reads ratios per round.

import { chromium, firefox, webkit } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { isBladeIndex } from "./buckets.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const at = argv.indexOf(name);
    if (at === -1) return fallback;
    const [, value] = argv.splice(at, 2);
    return value;
};
const release = option("--firefox", null);
const ENGINES = { firefox, webkit };
const compared = [...new Set(option("--browsers", "firefox").split(","))];
if (!compared.every((name) => name in ENGINES)) {
    console.error(`--browsers: one of ${Object.keys(ENGINES).join(", ")}`);
    process.exit(2);
}
const bladeIterations = Number(option("--blade-iterations", 400));
const fieldIterations = Number(option("--field-iterations", 40));
const rounds = Number(option("--rounds", 2));
const [bundlePath, out, ...positions] = argv;
if (!bundlePath || !out || positions.length === 0) {
    console.error(
        "usage: run-gecko-gap.mjs <bundle.js> <out.json> [--browsers firefox|webkit|firefox,webkit] [--firefox <binary>] [--blade-iterations N] [--field-iterations N] [--rounds N] <position>..."
    );
    process.exit(2);
}
const bundle = readFileSync(bundlePath, "utf8");
const load = () => Number(loadavg()[0].toFixed(2));

const WORKER_GLUE = `
;self.onmessage = (e) => {
    const { id, position, fixture, options } = e.data;
    self.postMessage({ id, row: fixture
        ? self.__brainBench.runField(fixture, options)
        : self.__brainBench.run(position, options) });
};`;

async function open(name, launch) {
    const browser = await launch();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    await page.evaluate((code) => {
        // One long-lived Worker, as the app keeps its Brain's.
        window.__worker = new Worker(
            URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
        );
        window.__inWorker = (request) =>
            new Promise((resolve) => {
                const id = Math.random();
                const onMessage = (e) => {
                    if (e.data.id !== id) return;
                    window.__worker.removeEventListener("message", onMessage);
                    resolve(e.data.row);
                };
                window.__worker.addEventListener("message", onMessage);
                window.__worker.postMessage({ id, ...request });
            });
    }, bundle + WORKER_GLUE);
    return { name, browser, page, version: browser.version() };
}

const browsers = [
    await open("chromium", () => chromium.launch()),
    ...(await Promise.all(
        compared.map((name) => open(name, () => ENGINES[name].launch()))
    )),
];
if (release) {
    browsers.push(
        await open("firefox-release", () =>
            firefox.launch({ channel: "moz-firefox", executablePath: release })
        )
    );
}

const fixtures = new Map(
    positions
        .filter((p) => !isBladeIndex(p))
        .map((p) => [p, JSON.parse(readFileSync(p, "utf8"))])
);

async function search(engine, position, thread, iterations) {
    const request = {
        position: Number(position),
        fixture: fixtures.get(position) ?? null,
        options: { iterations },
    };
    return engine.page.evaluate(
        ({ thread, request }) =>
            thread === "worker"
                ? window.__inWorker(request)
                : request.fixture
                  ? window.__brainBench.runField(
                        request.fixture,
                        request.options
                    )
                  : window.__brainBench.run(request.position, request.options),
        { thread, request }
    );
}

const rows = [];
for (let round = 0; round <= rounds; round++) {
    for (const position of positions) {
        const field = fixtures.has(position);
        const iterations =
            round === 0
                ? Math.max(
                      4,
                      Math.round(
                          (field ? fieldIterations : bladeIterations) / 4
                      )
                  )
                : field
                  ? fieldIterations
                  : bladeIterations;
        for (const thread of ["main", "worker"]) {
            const order = browsers.map(
                (_, i) => browsers[(i + round) % browsers.length]
            );
            for (const engine of order) {
                const row = await search(engine, position, thread, iterations);
                if (round === 0) continue; // warm-up
                rows.push({
                    round,
                    browser: engine.name,
                    thread,
                    position,
                    kind: field ? "field" : "blade",
                    label: row.label,
                    completed: row.completed,
                    move: row.move,
                    msPerIteration: row.wallMs / row.completed,
                    load: load(),
                });
            }
        }
        process.stderr.write(`round ${round}/${rounds} ${position}\n`);
    }
}

// ── summary: per kind and thread, the median per-round ratio to Chromium ──
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? null : s[Math.floor((s.length - 1) / 2)];
};
const cell = (b, t, p, r) =>
    rows.find(
        (x) =>
            x.browser === b &&
            x.thread === t &&
            x.position === p &&
            x.round === r
    );
const summary = [];
for (const kind of ["blade", "field"]) {
    for (const thread of ["main", "worker"]) {
        for (const engine of browsers) {
            const ratios = [];
            const ms = [];
            for (const position of positions) {
                for (let round = 1; round <= rounds; round++) {
                    const row = cell(engine.name, thread, position, round);
                    if (!row || row.kind !== kind) continue;
                    const base = cell("chromium", "main", position, round);
                    ratios.push(row.msPerIteration / base.msPerIteration);
                    ms.push(row.msPerIteration);
                }
            }
            if (ms.length === 0) continue;
            summary.push({
                kind,
                thread,
                browser: engine.name,
                msPerIteration: Number(median(ms).toFixed(2)),
                ratioToChromiumMain: Number(median(ratios).toFixed(2)),
                ratioMin: Number(Math.min(...ratios).toFixed(2)),
                ratioMax: Number(Math.max(...ratios).toFixed(2)),
            });
        }
    }
}
console.table(summary);

writeFileSync(
    out,
    JSON.stringify(
        {
            cpu: cpus()[0]?.model ?? "unknown",
            cores: cpus().length,
            browsers: browsers.map((b) => ({
                name: b.name,
                version: b.version,
            })),
            bladeIterations,
            fieldIterations,
            rounds,
            summary,
            rows,
        },
        null,
        1
    )
);
for (const engine of browsers) await engine.browser.close();
console.log(`wrote ${out}`);
