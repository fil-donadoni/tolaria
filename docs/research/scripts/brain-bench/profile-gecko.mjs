// Where one search's time goes in Firefox (issue #10122): the Gecko profiler
// (`MOZ_PROFILER_STARTUP`) over the bundle searching one position, folded into
// `profile.mjs`'s buckets (`buckets.mjs`), so its shares sit beside V8's.
//
//   node docs/research/scripts/brain-bench/profile-gecko.mjs <bundle.js> <out.json> [--iterations N] [--firefox <binary>] [--worker] <position>...
//
// A position is a blade index or a field fixture's path (`field-position.mjs`).
// `--firefox` profiles a release Firefox through WebDriver BiDi instead of
// Playwright's patched build; `--worker` searches in a DOM Worker, where the
// app's Brain searches, instead of on the page's main thread.
//
// Each position gets its own browser, cold like `profile.mjs`'s child. A
// sample weighs the thread CPU time since the previous one, so a preempted
// thread costs nothing. Beyond the buckets the fold reports the JIT TIER the
// innermost script frame of each search sample ran in — interpreter, baseline
// interpreter, baseline, Ion — which V8's profile has no counterpart for.

import { firefox } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    BUCKETS,
    INCLUSIVE,
    SEARCH,
    isBladeIndex,
    parseProfileArgs,
} from "./buckets.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
    const at = argv.indexOf(name);
    if (at === -1) return null;
    argv.splice(at, 1);
    return true;
};
const option = (name) => {
    const at = argv.indexOf(name);
    if (at === -1) return null;
    const [, value] = argv.splice(at, 2);
    return value;
};
const release = option("--firefox");
const inWorker = flag("--worker") === true;
const { bundle, out, iterations, positions } = parseProfileArgs(
    argv,
    "profile-gecko.mjs"
);
const source = readFileSync(bundle, "utf8");

const WORKER_GLUE = `
;self.onmessage = (e) => {
    const { position, fixture, options } = e.data;
    self.postMessage(fixture
        ? self.__brainBench.runField(fixture, options)
        : self.__brainBench.run(position, options));
};`;

/** Search one position in a fresh, profiled browser; the profile's path. */
async function profileOne(position, dir) {
    const file = path.join(dir, "profile.json");
    const env = {
        ...process.env,
        MOZ_PROFILER_STARTUP: "1",
        MOZ_PROFILER_SHUTDOWN: file,
        MOZ_PROFILER_STARTUP_INTERVAL: "0.5",
        MOZ_PROFILER_STARTUP_ENTRIES: String(1 << 27),
        MOZ_PROFILER_STARTUP_FEATURES: "js,cpu",
        MOZ_PROFILER_STARTUP_FILTERS: "GeckoMain,DOM Worker",
    };
    const browser = release
        ? await firefox.launch({
              channel: "moz-firefox",
              executablePath: release,
              env,
          })
        : await firefox.launch({ env });
    const page = await browser.newPage();
    await page.goto("about:blank");
    const fixture = isBladeIndex(position)
        ? null
        : JSON.parse(readFileSync(position, "utf8"));
    const request = {
        position: Number(position),
        fixture,
        options: { iterations },
    };
    let row;
    if (inWorker) {
        row = await page.evaluate(
            ({ code, request }) =>
                new Promise((resolve, reject) => {
                    const worker = new Worker(
                        URL.createObjectURL(
                            new Blob([code], { type: "text/javascript" })
                        )
                    );
                    worker.onmessage = (e) => resolve(e.data);
                    worker.onerror = (e) => reject(new Error(e.message));
                    worker.postMessage(request);
                }),
            { code: source + WORKER_GLUE, request }
        );
    } else {
        await page.addScriptTag({ content: source });
        row = await page.evaluate(
            ({ position, fixture, options }) =>
                fixture
                    ? window.__brainBench.runField(fixture, options)
                    : window.__brainBench.run(position, options),
            request
        );
    }
    const version = browser.version();
    // A clean quit is what writes the profile.
    await browser.close();
    return { row, version, file };
}

/** `name (url:line:col)[n]` → `name`. */
const functionName = (location) =>
    location.replace(/ \(.*$/, "").replace(/\[\d+\]$/, "");

function fold(profile) {
    const gcCategory = profile.meta.categories.findIndex(
        (c) => c.name === "GC / CC"
    );
    const threads = [
        ...profile.threads,
        ...(profile.processes ?? []).flatMap((p) => p.threads),
    ];
    const buckets = Object.fromEntries(
        [...BUCKETS.map(([name]) => name), "gc", "other"].map((n) => [n, 0])
    );
    const tiers = new Map();
    const functions = new Map();
    const inclusive = new Map();
    let total = 0;
    for (const thread of threads) {
        const strings = thread.stringTable;
        const sampleSchema = thread.samples.schema;
        const { prefix: PREFIX, frame: FRAME } = thread.stackTable.schema;
        const fs = thread.frameTable.schema;
        const stacks = thread.stackTable.data;
        const frames = thread.frameTable.data;
        // Innermost-first frame indexes of a stack, memoised per stack.
        const chain = new Map();
        const framesOf = (stack) => {
            let hit = chain.get(stack);
            if (hit) return hit;
            hit = [];
            for (let at = stack; at !== null; at = stacks[at][PREFIX]) {
                hit.push(stacks[at][FRAME]);
            }
            chain.set(stack, hit);
            return hit;
        };
        for (const sample of thread.samples.data) {
            const stack = sample[sampleSchema.stack];
            if (stack === null) continue;
            const cpu = sample[sampleSchema.threadCPUDelta] ?? 0;
            if (!(cpu > 0)) continue;
            const whole = framesOf(stack);
            const allNames = whole.map((f) =>
                functionName(strings[frames[f][fs.location]])
            );
            const search = allNames.findIndex((name) => SEARCH.test(name));
            if (search === -1) continue;
            // Only the frames from the search inwards: what calls the search
            // (Playwright's own `evaluate` wrapper among them) is not in it.
            const stackFrames = whole.slice(0, search + 1);
            const names = allNames.slice(0, search + 1);
            total += cpu;
            const gc = stackFrames.some(
                (f) => frames[f][fs.category] === gcCategory
            );
            const hit = names
                .map((name) => BUCKETS.find(([, re]) => re.test(name)))
                .find(Boolean);
            buckets[gc ? "gc" : (hit?.[0] ?? "other")] += cpu;
            // The innermost SCRIPT frame: its name for self time, its tier.
            const script = stackFrames.find((f) =>
                strings[frames[f][fs.location]].includes(" (")
            );
            const leaf = gc
                ? "(garbage collector)"
                : functionName(
                      strings[frames[script ?? stackFrames[0]][fs.location]]
                  );
            functions.set(leaf, (functions.get(leaf) ?? 0) + cpu);
            const impl =
                script === undefined ? null : frames[script][fs.implementation];
            const tier = gc
                ? "gc"
                : impl === null || impl === undefined
                  ? "interpreter"
                  : strings[impl];
            tiers.set(tier, (tiers.get(tier) ?? 0) + cpu);
            const onStack = new Set(names.map((n) => n.replace(/\d+$/, "")));
            for (const fn of INCLUSIVE) {
                if (onStack.has(fn)) {
                    inclusive.set(fn, (inclusive.get(fn) ?? 0) + cpu);
                }
            }
        }
    }
    const share = (cpu) => Number(((100 * cpu) / total).toFixed(1));
    // threadCPUDelta is in `meta.sampleUnits.threadCPUDelta` (µs on Linux).
    const unit = profile.meta.sampleUnits?.threadCPUDelta ?? "µs";
    const toMs = unit === "ns" ? 1e-6 : unit === "µs" ? 1e-3 : 1;
    return {
        searchMs: Math.round(total * toMs),
        shares: Object.fromEntries(
            Object.entries(buckets).map(([name, cpu]) => [name, share(cpu)])
        ),
        tiers: Object.fromEntries(
            [...tiers.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([tier, cpu]) => [tier, share(cpu)])
        ),
        inclusive: Object.fromEntries(
            INCLUSIVE.map((fn) => [fn, share(inclusive.get(fn) ?? 0)])
        ),
        topSelf: [...functions.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([name, cpu]) => ({ name, share: share(cpu) })),
    };
}

const results = [];
let browserVersion = null;
for (const position of positions) {
    const dir = mkdtempSync(path.join(tmpdir(), "brain-gecko-"));
    const { row, version, file } = await profileOne(position, dir);
    browserVersion = version;
    const profile = JSON.parse(readFileSync(file, "utf8"));
    results.push({ ...row, ...fold(profile) });
    process.stderr.write(`profiled ${position}\n`);
}

writeFileSync(
    out,
    JSON.stringify(
        {
            engine: "gecko",
            browser: `${release ? "release" : "playwright"} firefox ${browserVersion}`,
            thread: inWorker ? "worker" : "main",
            iterations,
            results,
        },
        null,
        1
    )
);
console.log(`wrote ${out}`);
