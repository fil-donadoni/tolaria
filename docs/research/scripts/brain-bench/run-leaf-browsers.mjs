// Leaf-parallel throughput (issue #10450): ONE tree in a coordinator Worker,
// its rollouts on K helper Workers, in Chromium, Firefox and WebKit through
// Playwright.
//
//   node docs/research/scripts/brain-bench/run-leaf-browsers.mjs <leaf.js> <out.json> \
//        [--positions 0,11,40,54] [--field <fixture.json>]... [--blade-cap 2000] \
//        [--field-cap 3000] [--rounds 3] [--engines chromium,firefox,webkit] \
//        [--arms base,clone1,...,replay4] [--handoff-iterations 200] [--handoff-field-iterations 20]
//
// <leaf.js> is `run-leaf.mjs build`'s. The search loop is synchronous, so the
// coordinator BLOCKS on a helper's answer: the helpers write each reward into
// a SharedArrayBuffer and wake it with `Atomics.notify`, the coordinator
// `Atomics.wait`s on the slot of the oldest leaf in flight
// (`leaf-parallel.mjs`'s batch rule) in a results ring; each job goes to the
// helper with the fewest outstanding. A SharedArrayBuffer needs a
// cross-origin-isolated page, so the page and the Worker script are served
// from 127.0.0.1 with COOP `same-origin` and COEP `require-corp`. The page
// wires one MessageChannel from the coordinator to each helper; nothing is
// nested.
//
// Per engine, one coordinator and four helpers are spawned once and warmed.
// Then, per position, per round (the first discarded as a warm-up), every arm
// in an order rotating by round: `base` (today's search in the coordinator,
// no helper), `k0s` (the seam at K = 0: today's search on the re-seeded dice
// every K plays), `cloneK` and `replayK` (K helpers, the transport of
// `leaf-parallel.mjs`), all from the round's seed until the cap. One rollout
// can cost ten times the next on a field board, so the seed changes by round
// and the reading is the ratio to `k0s` within a round, its median over
// rounds. After each search the coordinator waits until every helper is idle
// (a rollout dropped at the cap is still running there), outside the timed
// search. Chromium and Firefox also read the browser's process-tree RSS
// before the five Workers are spawned and after they are warmed, and
// Chromium its own per-Worker JS memory (`measureUserAgentSpecificMemory`).
//
// Then, in the coordinator Worker, `handoff` (`entry-leaf.mjs`): the
// per-rollout cost of a structured clone of the world and of a replay, in
// that engine.

import { chromium, firefox, webkit } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { parseArgs } from "node:util";

const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        positions: { type: "string", default: "0,11,40,54" },
        field: { type: "string", multiple: true, default: [] },
        "blade-cap": { type: "string", default: "2000" },
        "field-cap": { type: "string", default: "3000" },
        rounds: { type: "string", default: "3" },
        engines: { type: "string", default: "chromium,firefox,webkit" },
        arms: {
            type: "string",
            default:
                "base,k0s,clone1,clone2,clone3,clone4,replay1,replay2,replay3,replay4",
        },
        "handoff-iterations": { type: "string", default: "200" },
        "handoff-field-iterations": { type: "string", default: "20" },
    },
});
const [bundlePath, out] = positionals;
if (!bundlePath || !out) {
    console.error(
        "usage: run-leaf-browsers.mjs <leaf.js> <out.json> [options]"
    );
    process.exit(2);
}
const MAX_K = 4;
const ROUNDS = Number(flags.rounds) + 1; // + the discarded warm-up
const ENGINES = { chromium, firefox, webkit };
const load = () => Number(loadavg()[0].toFixed(1));
const ARMS = flags.arms.split(",").map((name) => {
    if (name === "base") return { name, K: "base" };
    if (name === "k0s") return { name, K: 0, transport: "clone" };
    // `clone4l8`: 4 helpers, 8 leaves in flight (`leaf-parallel.mjs`'s lag).
    const m = /^(clone|replay)(\d)(?:l(\d+))?$/.exec(name);
    if (!m) throw new Error(`bad arm ${name}`);
    return {
        name,
        K: Number(m[2]),
        L: m[3] ? Number(m[3]) : undefined,
        transport: m[1],
    };
});
const fixtures = flags.field.map((f) => JSON.parse(readFileSync(f, "utf8")));
const targets = [
    ...flags.positions
        .split(",")
        .map(Number)
        .map((index) => ({
            kind: "blade",
            index,
            cap: Number(flags["blade-cap"]),
        })),
    ...fixtures.map((f) => ({
        kind: "field",
        label: f.label,
        cap: Number(flags["field-cap"]),
    })),
];

// The Worker glue: one script, the role set by the first message.
const GLUE = `
;(() => {
    const leaf = self.__brainBench.leaf;
    const SLOT = 8; // Float64 per helper slot
    const RING = 32; // > the largest lag in flight
    let stamps, done, res, ports, fixtures = {}, seq = 0;
    const sent = new Array(${MAX_K}).fill(0);
    const now = () => performance.now();

    // Results ring: job seq s lands in slot s % RING (reward, margin and the
    // helper's timings), stamped with s once written. A job goes to the helper
    // with the fewest jobs outstanding; done[h] counts what helper h finished.
    function sabExecutor(K, transport, t) {
        const where = new Map();
        return {
            beginSearch(ctx) {
                const c = { ...ctx };
                if (transport === "clone") delete c.rootState;
                const t0 = now();
                for (let h = 0; h < K; h++) ports[h].postMessage({ type: "ctx", ctx: c });
                t.ctxPostMs += now() - t0;
            },
            dispatch(n, job) {
                let h = 0;
                let least = Infinity;
                for (let i = 0; i < K; i++) {
                    const out = sent[i] - Atomics.load(done, i);
                    if (out < least) {
                        least = out;
                        h = i;
                    }
                }
                const s = ++seq;
                sent[h]++;
                where.set(n, s);
                const payload = transport === "clone"
                    ? { world: job.world, seed: job.seed }
                    : { worldSeed: job.worldSeed, trail: job.trail, seed: job.seed };
                const t0 = now();
                ports[h].postMessage({ type: "job", seq: s, job: payload });
                t.postMs += now() - t0;
                t.jobs++;
            },
            wait(n) {
                const s = where.get(n);
                where.delete(n);
                const slot = s % RING;
                const t0 = now();
                for (;;) {
                    const v = Atomics.load(stamps, slot);
                    if (v === s) break;
                    Atomics.wait(stamps, slot, v);
                }
                t.waitMs += now() - t0;
                const o = slot * SLOT;
                t.recvMs += res[o + 2];
                t.replayMs += res[o + 3];
                t.rolloutMs += res[o + 4];
                t.settled++;
                return { reward: res[o], margin: res[o + 1] };
            },
            drop(n) { where.delete(n); t.dropped++; },
            endSearch() {},
        };
    }

    function quiesce() {
        for (let h = 0; h < ${MAX_K}; h++) {
            for (;;) {
                const v = Atomics.load(done, h);
                if (v >= sent[h]) break;
                Atomics.wait(done, h, v);
            }
        }
    }

    function coordinator(d) {
        if (d.type === "run") {
            const t = { jobs: 0, settled: 0, dropped: 0, postMs: 0, ctxPostMs: 0, waitMs: 0, recvMs: 0, replayMs: 0, rolloutMs: 0 };
            const cfg = d.K === "base"
                ? { K: "base" }
                : { K: d.K, L: d.L, transport: d.transport, executor: sabExecutor(d.K, d.transport, t) };
            const options = { iterations: 1e6, timeMs: d.cap, seed: d.seed };
            const row = d.target.kind === "blade"
                ? leaf.run(d.target.index, options, cfg)
                : leaf.runField(fixtures[d.target.label], options, cfg);
            const q0 = now();
            quiesce();
            self.postMessage({ id: d.id, row: { ...row, transfer: t, quiesceMs: now() - q0 } });
        } else if (d.type === "handoff") {
            const target = d.target.kind === "blade" ? d.target.index : fixtures[d.target.label];
            self.postMessage({ id: d.id, row: leaf.handoff(target, d.iterations) });
        }
    }

    function helperOn(port, h) {
        port.onmessage = (e) => {
            const t0 = now();
            const d = e.data; // Chromium deserialises here, on first access
            const job = d.job;
            const recvMs = now() - t0;
            if (d.type === "ctx") { leaf.helper.begin(d.ctx); return; }
            const r = leaf.helper.rollout(job);
            const slot = d.seq % RING;
            const o = slot * SLOT;
            res[o] = r.reward;
            res[o + 1] = r.margin;
            res[o + 2] = recvMs;
            res[o + 3] = r.replayMs;
            res[o + 4] = r.rolloutMs;
            Atomics.store(stamps, slot, d.seq);
            Atomics.notify(stamps, slot);
            Atomics.add(done, h, 1);
            Atomics.notify(done, h);
        };
    }

    self.onmessage = (e) => {
        const d = e.data;
        if (d.type === "init-coordinator") {
            stamps = new Int32Array(d.sab, 0, RING);
            done = new Int32Array(d.sab, RING * 4, ${MAX_K});
            res = new Float64Array(d.sab, RING * 4 + 64);
            ports = d.ports;
            for (const f of d.fixtures) fixtures[f.label] = f;
            self.onmessage = (ev) => {
                try {
                    coordinator(ev.data);
                } catch (err) {
                    self.postMessage({ id: ev.data.id, row: { error: String(err && err.stack || err) } });
                }
            };
            self.postMessage({ id: d.id, row: { isolated: self.crossOriginIsolated } });
        } else if (d.type === "init-helper") {
            stamps = new Int32Array(d.sab, 0, RING);
            done = new Int32Array(d.sab, RING * 4, ${MAX_K});
            res = new Float64Array(d.sab, RING * 4 + 64);
            helperOn(d.port, d.slot);
            self.postMessage({ id: d.id, row: { isolated: self.crossOriginIsolated } });
        }
    };
})();
`;

const PAGE = `<!doctype html><meta charset="utf-8"><title>leaf bench</title><body>leaf bench</body>`;
const script = readFileSync(bundlePath, "utf8") + GLUE;
const HEADERS = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
};
const server = createServer((req, res) => {
    if (req.url === "/bench.js") {
        res.writeHead(200, { ...HEADERS, "Content-Type": "text/javascript" });
        res.end(script);
    } else {
        res.writeHead(200, { ...HEADERS, "Content-Type": "text/html" });
        res.end(PAGE);
    }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

/** Resident set size, in MB, of `pid` and every process below it
 *  (`run-workers.mjs`'s reading; WebKit's content process is not the
 *  launcher's child, so WebKit is not read). */
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
    const pid = name === "webkit" ? null : (server.process()?.pid ?? null);
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await settle();
    const rssBefore = treeRssMB(pid);
    const isolated = await page.evaluate(
        async ({ maxK, fixtures }) => {
            if (!self.crossOriginIsolated) return { page: false };
            const ask = (w, msg, transfer = []) =>
                new Promise((resolve, reject) => {
                    const id = Math.random();
                    const on = (e) => {
                        if (e.data.id !== id) return;
                        w.removeEventListener("message", on);
                        resolve(e.data.row);
                    };
                    w.addEventListener("message", on);
                    w.addEventListener("error", (e) =>
                        reject(new Error(e.message ?? "worker error"))
                    );
                    w.postMessage({ ...msg, id }, transfer);
                });
            window.__ask = ask;
            // stamps (32 × Int32), done (≤ 16 × Int32), results (32 × 8 × Float64)
            const sab = new SharedArrayBuffer(32 * 4 + 64 + 32 * 8 * 8);
            const coord = new Worker("/bench.js");
            const helpers = Array.from(
                { length: maxK },
                () => new Worker("/bench.js")
            );
            const channels = helpers.map(() => new MessageChannel());
            const h = await Promise.all(
                helpers.map((w, slot) =>
                    ask(
                        w,
                        {
                            type: "init-helper",
                            sab,
                            slot,
                            port: channels[slot].port2,
                        },
                        [channels[slot].port2]
                    )
                )
            );
            const ports = channels.map((c) => c.port1);
            const c = await ask(
                coord,
                { type: "init-coordinator", sab, ports, fixtures },
                ports
            );
            window.__coord = coord;
            return {
                page: true,
                coordinator: c.isolated,
                helpers: h.map((x) => x.isolated),
            };
        },
        { maxK: MAX_K, fixtures }
    );
    return {
        name,
        server,
        browser,
        page,
        pid,
        rssBefore,
        isolated,
        version: browser.version(),
    };
}

async function ask(engine, msg) {
    const row = await engine.page.evaluate(
        (m) => window.__ask(window.__coord, m),
        msg
    );
    if (row?.error) throw new Error(`${engine.name} coordinator: ${row.error}`);
    return row;
}

const result = {
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memGB: Math.round(totalmem() / 2 ** 30),
    bladeCap: Number(flags["blade-cap"]),
    fieldCap: Number(flags["field-cap"]),
    targets,
    engines: [],
    rows: [],
    handoff: [],
};

for (const name of flags.engines.split(",")) {
    let engine;
    try {
        engine = await open(name);
    } catch (cause) {
        console.error(`${name}: could not start — ${cause.message}`);
        result.engines.push({ name, failed: String(cause.message) });
        continue;
    }
    const engineRow = {
        name,
        version: engine.version,
        isolated: engine.isolated,
    };
    result.engines.push(engineRow);
    if (!engine.isolated.page) {
        console.error(`${name}: page not cross-origin isolated`);
        await engine.server.close();
        continue;
    }
    process.stderr.write(`${name} ${engine.version} isolated\n`);
    // Warm: every arm's code path in the coordinator and the helpers.
    for (const target of targets) {
        for (const arm of [
            { K: "base" },
            { K: 4, transport: "clone" },
            { K: 4, transport: "replay" },
        ]) {
            await ask(engine, {
                type: "run",
                target,
                K: arm.K,
                transport: arm.transport,
                cap: Math.min(500, target.cap),
                seed: 0xb1ade,
            });
        }
    }
    await settle();
    const rssAfter = treeRssMB(engine.pid);
    // Five Workers: the coordinator and four helpers, the same bundle each.
    engineRow.rssPerWorkerMB =
        rssAfter === null || engine.rssBefore === null
            ? null
            : Number(((rssAfter - engine.rssBefore) / (MAX_K + 1)).toFixed(1));
    // The page's own attribution of its JS memory, per Worker (Chromium only:
    // it needs the cross-origin isolation this page already has).
    engineRow.workerHeapMB = await engine.page.evaluate(async () => {
        if (!performance.measureUserAgentSpecificMemory) return null;
        let m;
        try {
            m = await performance.measureUserAgentSpecificMemory();
        } catch (err) {
            return String(err.message ?? err);
        }
        return m.breakdown
            .filter((b) =>
                b.attribution.some(
                    (a) => a.scope === "DedicatedWorkerGlobalScope"
                )
            )
            .map((b) => Number((b.bytes / 2 ** 20).toFixed(1)));
    });
    for (let round = 0; round < ROUNDS; round++) {
        for (const [ti, target] of targets.entries()) {
            const shift = (round + ti) % ARMS.length;
            for (const arm of [...ARMS.slice(shift), ...ARMS.slice(0, shift)]) {
                const row = await ask(engine, {
                    type: "run",
                    target,
                    K: arm.K,
                    L: arm.L,
                    transport: arm.transport,
                    cap: target.cap,
                    seed: (0xb1ade + round * 7919) | 0,
                });
                result.rows.push({
                    engine: name,
                    round,
                    target:
                        target.kind === "blade" ? target.index : target.label,
                    kind: target.kind,
                    arm: arm.name,
                    completed: row.completed,
                    deviceMs: row.deviceMs,
                    wallMs: row.wallMs,
                    move: row.move,
                    transfer: row.transfer,
                    quiesceMs: row.quiesceMs,
                    load: load(),
                });
            }
        }
        process.stderr.write(
            `${name} round ${round + 1}/${ROUNDS} load ${load()}\n`
        );
    }
    for (const target of targets) {
        const iterations =
            target.kind === "blade"
                ? Number(flags["handoff-iterations"])
                : Number(flags["handoff-field-iterations"]);
        const row = await ask(engine, { type: "handoff", target, iterations });
        result.handoff.push({
            engine: name,
            kind: target.kind,
            ...row,
            load: load(),
        });
    }
    process.stderr.write(`${name} handoff done\n`);
    await engine.server.close();
    writeFileSync(out, JSON.stringify(result, null, 1));
}

writeFileSync(out, JSON.stringify(result, null, 1));
server.close();
console.log(`wrote ${out}`);
