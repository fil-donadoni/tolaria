// The probe-kernel bench (issue #10471): one reduced probe kernel in three
// arms — objects, flat memory in JavaScript, the flat layout in WebAssembly —
// timed in a dedicated Worker of Chromium, Firefox and WebKit, and anchored
// against the engine's own probe.
//
//   node run-wasm-probe.mjs build  <dir>
//   node run-wasm-probe.mjs run    <dir> <out.json> [--rounds 6] [--sample-ms 200]
//   node run-wasm-probe.mjs anchor <dir> <out.json> [--rounds 4] [--sample-ms 300]
//        [--engines chromium,firefox-release,webkit]
//
// Engines: `chromium` and `webkit` are Playwright's builds; `firefox-release`
// is the Firefox installed on the machine, in a real window on a throwaway
// profile (see `RELEASES` for why it is not Playwright's).
//
// `build` compiles `kernel.c` to a WebAssembly object with clang (`--clang
// <path>`, or `$CLANG`; default Homebrew's `llvm@22`), makes it a module
// (`link-wasm-object.mjs`) and bundles the two payloads. Nothing it uses is
// in `package.json` beyond what the other benches already use (esbuild,
// Playwright).
//
// A browser has only a wall clock, and a coarse one (1 ms in Firefox and
// WebKit), so a SAMPLE is as many sweeps of a board's candidates as take
// `--sample-ms`: the count is calibrated per engine, arm and board, then
// held. Rounds are interleaved the way `run-browsers.mjs` does it, one level
// further: the three browsers stay open together and every round visits each
// of them, each board, each arm, the orders rotating — so load that drifts
// over minutes falls on every arm and engine alike. The first round is a
// warm-up and is discarded. Every reading is a median over the measured
// rounds; a ratio is the median of the per-round ratios.

import { chromium, firefox, webkit } from "playwright";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { cpus, loadavg, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundleBench } from "../bundle.mjs";
import { median } from "../stats.mjs";
import { linkObject } from "./link-wasm-object.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        clang: {
            type: "string",
            default: process.env.CLANG ?? "/opt/homebrew/opt/llvm@22/bin/clang",
        },
        engines: {
            type: "string",
            default: "chromium,firefox-release,webkit",
        },
        rounds: { type: "string" },
        "sample-ms": { type: "string" },
    },
});
const [command, dir, out] = positionals;
/** Playwright's own builds. */
const ENGINES = { chromium, "firefox-playwright": firefox, webkit };
/** A release browser installed on the machine, opened as a real window (in
 *  the background, on a throwaway profile) and driven over HTTP. Firefox is
 *  read HERE, not in Playwright's build: that build drives the page
 *  through the debugger, and a debugged page gets no optimizing WebAssembly
 *  compiler — with the baseline compiler switched off
 *  (`javascript.options.wasm_baselinejit`) it reports "no WebAssembly
 *  compiler available". Its arm C would be the baseline compiler's.
 *  Launched through `open`: the release binary started headless on a fresh
 *  profile never loads the page. */
const RELEASES = {
    "firefox-release": {
        app: "Firefox",
        binary: "/Applications/Firefox.app/Contents/MacOS/firefox",
        args: (profile, url) => ["--no-remote", "--profile", profile, url],
        // No first-run tab in front of the page.
        prefs: [
            'user_pref("browser.aboutwelcome.enabled", false);',
            'user_pref("browser.shell.checkDefaultBrowser", false);',
            'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        ],
    },
};
const CLANG_FLAGS = [
    "--target=wasm32-unknown-unknown",
    "-O3",
    "-ffreestanding",
    "-nostdlib",
    "-mbulk-memory",
];
const load = () => Number(loadavg()[0].toFixed(1));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function build() {
    mkdirSync(dir, { recursive: true });
    const object = path.join(dir, "kernel.o");
    execFileSync(
        flags.clang,
        [...CLANG_FLAGS, "-c", path.join(here, "kernel.c"), "-o", object],
        { stdio: "inherit" }
    );
    const { bytes, exports } = linkObject(readFileSync(object));
    // The module must load, and import nothing but its memory.
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
    if (imports.length !== 1 || imports[0].name !== "__linear_memory") {
        throw new Error(`unexpected imports: ${JSON.stringify(imports)}`);
    }
    writeFileSync(path.join(dir, "kernel.wasm"), bytes);
    await bundleBench(
        path.join(here, "entry-wasm-probe.mjs"),
        path.join(dir, "probe.js")
    );
    await bundleBench(
        path.join(here, "entry-wasm-anchor.mjs"),
        path.join(dir, "anchor.js")
    );
    const info = {
        sha: execFileSync("git", ["rev-parse", "--short=10", "HEAD"], {
            cwd: here,
            encoding: "utf8",
        }).trim(),
        clang: execFileSync(flags.clang, ["--version"], { encoding: "utf8" })
            .split("\n")[0]
            .trim(),
        clangFlags: CLANG_FLAGS.join(" "),
        wasm: { bytes: bytes.length, sha256: sha256(bytes), exports },
        probeBundleBytes: readFileSync(path.join(dir, "probe.js")).length,
        anchorBundleBytes: readFileSync(path.join(dir, "anchor.js")).length,
    };
    writeFileSync(path.join(dir, "build.json"), JSON.stringify(info, null, 1));
    console.log(JSON.stringify(info, null, 1));
}

// ---------------------------------------------------------------------------
// A payload in a dedicated Worker of one browser
// ---------------------------------------------------------------------------

const glue = (api) => `
;self.onmessage = (e) => {
    const { id, method, args } = e.data;
    try {
        self.postMessage({ id, result: self.${api}[method](...args) });
    } catch (cause) {
        self.postMessage({ id, error: String(cause?.stack ?? cause) });
    }
};`;

async function openPlaywright(name, bundle, api) {
    const browser = await ENGINES[name].launch();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.evaluate(
        (source) => {
            const worker = new Worker(
                URL.createObjectURL(
                    new Blob([source], { type: "text/javascript" })
                )
            );
            let next = 0;
            window.__ask = (method, args) =>
                new Promise((resolve, reject) => {
                    const id = next++;
                    const onMessage = (e) => {
                        if (e.data.id !== id) return;
                        worker.removeEventListener("message", onMessage);
                        if (e.data.error) reject(new Error(e.data.error));
                        else resolve(e.data.result);
                    };
                    worker.addEventListener("message", onMessage);
                    worker.addEventListener("error", (e) =>
                        reject(new Error(e.message ?? "worker error"))
                    );
                    worker.postMessage({ id, method, args });
                });
        },
        bundle + glue(api)
    );
    const ask = (method, ...args) =>
        page.evaluate(([m, a]) => window.__ask(m, a), [method, args]);
    return {
        name,
        ask,
        close: () => browser.close(),
        version: browser.version(),
    };
}

/** The page a release browser loads: the same Worker, driven over HTTP — it
 *  asks the runner for its next call, hands it to the Worker and posts the
 *  answer back. */
const RELEASE_PAGE = `<!doctype html><meta charset="utf-8"><script>
const worker = new Worker("/worker.js");
(async () => {
    for (;;) {
        const call = await (await fetch("/next")).json();
        const answer = await new Promise((resolve) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = (e) => resolve({ error: e.message });
            worker.postMessage({ id: 0, ...call });
        });
        await fetch("/answer", { method: "POST", body: JSON.stringify(answer) });
    }
})();
</script>`;

async function openRelease(name, bundle, api) {
    const release = RELEASES[name];
    /** The call waiting for the page, and the page waiting for a call. */
    let pending = null;
    let waiting = null;
    let answered = null;
    const hand = () => {
        if (!pending || !waiting) return;
        waiting.end(JSON.stringify(pending));
        pending = waiting = null;
    };
    const server = createServer((req, res) => {
        if (req.url === "/") {
            res.setHeader("content-type", "text/html");
            res.end(RELEASE_PAGE);
        } else if (req.url === "/worker.js") {
            res.setHeader("content-type", "text/javascript");
            res.end(bundle + glue(api));
        } else if (req.url === "/next") {
            waiting = res;
            hand();
        } else if (req.url === "/answer") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                res.end();
                answered(JSON.parse(body));
            });
        } else {
            res.statusCode = 404;
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const profile = mkdtempSync(path.join(tmpdir(), "wasm-probe-"));
    if (release.prefs) {
        writeFileSync(path.join(profile, "user.js"), release.prefs.join("\n"));
    }
    // `-n` a new instance beside the owner's own browser, `-g` without
    // taking the focus.
    execFileSync("/usr/bin/open", [
        "-n",
        "-g",
        "-a",
        release.app,
        "--args",
        ...release.args(profile, `http://127.0.0.1:${server.address().port}/`),
    ]);
    /** Every process of the instance: it is the only one on this profile. */
    const quit = () => {
        let pids = "";
        try {
            pids = execFileSync("pgrep", ["-f", profile], {
                encoding: "utf8",
            });
        } catch {
            // No process left.
        }
        for (const pid of pids.trim().split("\n").filter(Boolean)) {
            try {
                process.kill(Number(pid));
            } catch {
                // Already gone.
            }
        }
    };
    const ask = (method, ...args) =>
        new Promise((resolve, reject) => {
            // A browser that never loads the page must fail the run, not
            // hang it.
            const late = setTimeout(() => {
                quit();
                reject(new Error(`${name}: no answer to ${method} in 180 s`));
            }, 180000);
            answered = (answer) => {
                clearTimeout(late);
                if (answer.error) reject(new Error(answer.error));
                else resolve(answer.result);
            };
            pending = { method, args };
            hand();
        });
    return {
        name,
        ask,
        close: async () => {
            quit();
            server.closeAllConnections();
            server.close();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            rmSync(profile, { recursive: true, force: true });
        },
        version: execFileSync(release.binary, ["--version"], {
            encoding: "utf8",
        }).trim(),
    };
}

async function open(name, bundle, api) {
    const engine = await (RELEASES[name]
        ? openRelease(name, bundle, api)
        : openPlaywright(name, bundle, api));
    opened.push(engine);
    return engine;
}

/** The sweeps of `ask`'s sample that take about `sampleMs`. A count is kept
 *  only once a sample TAKEN with it lands within a factor of two of the
 *  target: a count scaled from one cold or interrupted sample would be held
 *  for the whole run (a first sweep read at 60 ms froze an arm at two sweeps
 *  per sample, under the clock's resolution). */
async function calibrate(sampleOf, sampleMs) {
    let reps = 1;
    for (let attempt = 0; attempt < 24; attempt++) {
        const { ms } = await sampleOf(reps);
        if (ms >= sampleMs / 2 && ms <= sampleMs * 2) return reps;
        reps =
            ms < 1
                ? reps * 16
                : Math.max(1, Math.round((reps * sampleMs) / ms));
    }
    throw new Error("calibration did not settle: the machine is too noisy");
}

const rotate = (list, by) => list.map((_, i) => list[(i + by) % list.length]);

/** The fewest rounds, warm-up included, a run may be read from. */
const MIN_ROUNDS = 5;

/** Run `rounds` rounds of `visit(round)`; the count of rounds completed.
 *  A browser that stops answering late in a run (a background window the
 *  system put to sleep, or one somebody closed) ends the run there: the
 *  rounds already complete are kept when there are `MIN_ROUNDS` of them. */
async function interleaved(rounds, visit) {
    for (let round = 0; round < rounds; round++) {
        try {
            await visit(round);
        } catch (cause) {
            if (round < MIN_ROUNDS) throw cause;
            process.stderr.write(
                `stopped after ${round} rounds: ${cause.message}\n`
            );
            return round;
        }
        process.stderr.write(`round ${round + 1}/${rounds}\n`);
    }
    return rounds;
}

const spread = (values) => ({
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
});

function environment(engines, rounds, sampleMs, rows) {
    const loads = rows.map((r) => r.load);
    return {
        date: new Date().toISOString(),
        build: JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")),
        machine: `${cpus()[0].model}, ${cpus().length} cores`,
        node: process.version,
        versions: Object.fromEntries(engines.map((e) => [e.name, e.version])),
        measuredRounds: rounds - 1,
        sampleMs,
        load: { min: Math.min(...loads), max: Math.max(...loads) },
    };
}

// ---------------------------------------------------------------------------
// run: the three arms
// ---------------------------------------------------------------------------

/** What a round samples per board: the whole probe in every arm, then the
 *  first one, two and three steps of it for the split. */
const SAMPLES = [
    ...["A", "B", "C", "Ccall"].map((arm) => ({ arm, phases: 4 })),
    ...["A", "B", "C"].flatMap((arm) =>
        [1, 2, 3].map((phases) => ({ arm, phases }))
    ),
];
const key = (s) => `${s.arm}/${s.phases}`;

async function run() {
    const rounds = Number(flags.rounds ?? "6") + 1;
    const sampleMs = Number(flags["sample-ms"] ?? "200");
    const bundle = readFileSync(path.join(dir, "probe.js"), "utf8");
    const wasm = [...readFileSync(path.join(dir, "kernel.wasm"))];
    const engines = [];
    let boards = null;
    for (const name of flags.engines.split(",")) {
        const engine = await open(name, bundle, "__wasmProbe");
        // `init` refuses a module or an arm that disagrees with the others.
        boards = await engine.ask("init", wasm);
        engine.reps = {};
        for (let b = 0; b < boards.length; b++) {
            for (const s of SAMPLES) {
                engine.reps[`${b}/${key(s)}`] = await calibrate(
                    (reps) => engine.ask("sample", s.arm, b, reps, s.phases),
                    sampleMs
                );
            }
        }
        process.stderr.write(`${name} ${engine.version}: calibrated\n`);
        engines.push(engine);
    }

    const all = [];
    const done = await interleaved(rounds, async (round) => {
        for (const engine of rotate(engines, round)) {
            for (let b = 0; b < boards.length; b++) {
                for (const s of rotate(SAMPLES, round + b)) {
                    const reps = engine.reps[`${b}/${key(s)}`];
                    const r = await engine.ask(
                        "sample",
                        s.arm,
                        b,
                        reps,
                        s.phases
                    );
                    all.push({
                        engine: engine.name,
                        round,
                        board: b,
                        arm: s.arm,
                        phases: s.phases,
                        reps,
                        ms: r.ms,
                        ns: (r.ms * 1e6) / r.probes,
                        load: load(),
                    });
                }
            }
        }
    });
    const rows = all.filter((r) => r.round < done);

    // -- reading ------------------------------------------------------------
    const measured = Array.from({ length: done - 1 }, (_, i) => i + 1);
    const names = engines.map((e) => e.name);
    const ns = (engine, round, board, arm, phases = 4) =>
        rows.find(
            (r) =>
                r.engine === engine &&
                r.round === round &&
                r.board === board &&
                r.arm === arm &&
                r.phases === phases
        ).ns;
    const overRounds = (f) => median(measured.map(f));
    const summary = {
        nsPerProbe: {},
        ratios: {},
        engines: {},
        split: {},
        stepRatios: {},
    };
    for (const engine of names) {
        summary.nsPerProbe[engine] = boards.map((board, b) => ({
            board: board.label,
            ...Object.fromEntries(
                ["A", "B", "C", "Ccall"].map((arm) => [
                    arm,
                    Math.round(overRounds((r) => ns(engine, r, b, arm))),
                ])
            ),
        }));
        const ratio = (top, bottom) => {
            const perBoard = boards.map((_, b) =>
                overRounds(
                    (r) => ns(engine, r, b, top) / ns(engine, r, b, bottom)
                )
            );
            return { perBoard, ...spread(perBoard) };
        };
        summary.ratios[engine] = {
            "A/B": ratio("A", "B"),
            "B/C": ratio("B", "C"),
            "A/C": ratio("A", "C"),
            "Ccall/C": ratio("Ccall", "C"),
        };
        // The split: each step's time is a difference of two samples taken
        // in the same round.
        summary.split[engine] = Object.fromEntries(
            ["A", "B", "C"].map((arm) => {
                const share = (from, to) => {
                    const perBoard = boards.map((_, b) =>
                        overRounds(
                            (r) =>
                                (ns(engine, r, b, arm, to) -
                                    (from ? ns(engine, r, b, arm, from) : 0)) /
                                ns(engine, r, b, arm, 4)
                        )
                    );
                    return spread(perBoard);
                };
                return [
                    arm,
                    {
                        clone: share(0, 1),
                        apply: share(1, 2),
                        settle: share(2, 3),
                        evaluate: share(3, 4),
                    },
                ];
            })
        );
    }
    // What each step of a probe gains from one arm to the next: the
    // step's time in the slower arm over its time in the faster one, both
    // differences of samples taken in the same round. Clone and apply are
    // read together — in arm A the apply alone is inside the clone's noise.
    const STEPS = { "clone+apply": [0, 2], settle: [2, 3], evaluate: [3, 4] };
    for (const engine of names) {
        const step = (r, b, arm, [from, to]) =>
            ns(engine, r, b, arm, to) -
            (from ? ns(engine, r, b, arm, from) : 0);
        summary.stepRatios[engine] = Object.fromEntries(
            [
                ["A", "B"],
                ["B", "C"],
            ].map(([top, bottom]) => [
                `${top}/${bottom}`,
                Object.fromEntries(
                    Object.entries(STEPS).map(([name, range]) => [
                        name,
                        spread(
                            boards.map((_, b) =>
                                overRounds(
                                    (r) =>
                                        step(r, b, top, range) /
                                        step(r, b, bottom, range)
                                )
                            )
                        ),
                    ])
                ),
            ])
        );
    }
    // An engine against the first one (Chromium), arm by arm.
    for (const engine of names.slice(1)) {
        summary.engines[`${engine}/${names[0]}`] = Object.fromEntries(
            ["A", "B", "C"].map((arm) => {
                const perBoard = boards.map((_, b) =>
                    overRounds(
                        (r) => ns(engine, r, b, arm) / ns(names[0], r, b, arm)
                    )
                );
                return [arm, { perBoard, ...spread(perBoard) }];
            })
        );
    }
    writeFileSync(
        out,
        JSON.stringify(
            {
                ...environment(engines, done, sampleMs, rows),
                boards,
                summary,
                rows,
            },
            null,
            1
        )
    );
    console.log(JSON.stringify(summary, null, 1));
}

// ---------------------------------------------------------------------------
// anchor: arm A beside the engine's own probe
// ---------------------------------------------------------------------------

const KINDS = ["real", "clone", "sba", "evaluate", "A"];

async function anchor() {
    const rounds = Number(flags.rounds ?? "4") + 1;
    const sampleMs = Number(flags["sample-ms"] ?? "300");
    const bundle = readFileSync(path.join(dir, "anchor.js"), "utf8");
    const engines = [];
    let boards = null;
    for (const name of flags.engines.split(",")) {
        const engine = await open(name, bundle, "__wasmAnchor");
        boards = await engine.ask("init");
        engine.reps = {};
        for (let b = 0; b < boards.length; b++) {
            for (const kind of KINDS) {
                engine.reps[`${b}/${kind}`] = await calibrate(
                    (reps) => engine.ask("sample", kind, b, reps),
                    sampleMs
                );
            }
        }
        process.stderr.write(`${name} ${engine.version}: calibrated\n`);
        engines.push(engine);
    }
    const all = [];
    const done = await interleaved(rounds, async (round) => {
        for (const engine of rotate(engines, round)) {
            for (let b = 0; b < boards.length; b++) {
                for (const kind of rotate(KINDS, round + b)) {
                    const reps = engine.reps[`${b}/${kind}`];
                    const r = await engine.ask("sample", kind, b, reps);
                    all.push({
                        engine: engine.name,
                        round,
                        board: b,
                        kind,
                        reps,
                        ms: r.ms,
                        ns: (r.ms * 1e6) / r.probes,
                        load: load(),
                    });
                }
            }
        }
    });
    const rows = all.filter((r) => r.round < done);

    const measured = Array.from({ length: done - 1 }, (_, i) => i + 1);
    const ns = (engine, round, board, kind) =>
        rows.find(
            (r) =>
                r.engine === engine &&
                r.round === round &&
                r.board === board &&
                r.kind === kind
        ).ns;
    const summary = {};
    for (const { name } of engines) {
        summary[name] = boards.map((board, b) => {
            const over = (f) => median(measured.map(f));
            const real = over((r) => ns(name, r, b, "real"));
            return {
                board: board.label,
                realUsPerProbe: Number((real / 1000).toFixed(1)),
                armAUsPerProbe: Number(
                    (over((r) => ns(name, r, b, "A")) / 1000).toFixed(1)
                ),
                realOverA: Number(
                    over(
                        (r) => ns(name, r, b, "real") / ns(name, r, b, "A")
                    ).toFixed(1)
                ),
                cloneShare: over(
                    (r) => ns(name, r, b, "clone") / ns(name, r, b, "real")
                ),
                sbaShare: over(
                    (r) =>
                        (ns(name, r, b, "sba") - ns(name, r, b, "clone")) /
                        ns(name, r, b, "real")
                ),
                evaluateShare: over(
                    (r) => ns(name, r, b, "evaluate") / ns(name, r, b, "real")
                ),
            };
        });
    }
    writeFileSync(
        out,
        JSON.stringify(
            {
                ...environment(engines, done, sampleMs, rows),
                boards,
                summary,
                rows,
            },
            null,
            1
        )
    );
    console.log(JSON.stringify({ boards, summary }, null, 1));
}

/** Every engine a command opened, so a failed run leaves no browser behind. */
const opened = [];
const COMMANDS = { build, run, anchor };
if (!COMMANDS[command] || !dir || (command !== "build" && !out)) {
    console.error(
        "usage: run-wasm-probe.mjs build <dir> | run <dir> <out.json> | anchor <dir> <out.json>"
    );
    process.exit(2);
}
try {
    await COMMANDS[command]();
} finally {
    await Promise.all(opened.map((engine) => engine.close()));
}
