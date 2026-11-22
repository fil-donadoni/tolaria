// Rollout-policy speed in real browsers (issue #10134): each candidate
// policy's time per iteration against today's, in Chromium and Firefox
// through Playwright, running the rollout bundle (`run-rollout.mjs build`).
//
//   node docs/research/scripts/brain-bench/run-rollout-browsers.mjs <rollout-bundle.js> <out.json> \
//        --policies base,topk:3,... [--positions 0,11,38,52] [--iterations 200] [--rounds 3]
//        [--field <fixture.json> --field-iterations 10]
//
// `--field` adds one field fixture (`field-position.mjs`) as a position of
// its own, searched at `--field-iterations` (a late-game board costs a
// hundred times a blade one).
// A browser has only a wall clock, so the reading is a RATIO measured in
// interleaved rounds (`run-browsers.mjs`'s method): within one round every
// policy searches the same position back to back, the order rotating by
// round and position, and one warm-up round is discarded. Each position's
// ratio is the median of its rounds. The blade positions and the field board
// are read APART: `blade` is p10 / median / p90 over the blade positions,
// `field` the field board's own ratio — a late-game board is another regime
// (most of its search is the policy's probes) and must not sit in the blade's
// percentiles.

import { chromium, firefox } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { median, percentile } from "./stats.mjs";

const [bundlePath, out, ...rest] = process.argv.slice(2);
function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}
const policies = option("policies", "base").split(",");
const positions = option("positions", "0,11,38,52").split(",").map(Number);
const iterations = Number(option("iterations", "200"));
const rounds = Number(option("rounds", "3")) + 1; // + the warm-up
const fieldPath = option("field", null);
const fieldIterations = Number(option("field-iterations", "10"));
const fixture = fieldPath ? JSON.parse(readFileSync(fieldPath, "utf8")) : null;
if (fixture) positions.push("field");
if (!bundlePath || !out || policies[0] !== "base") {
    console.error(
        "usage: run-rollout-browsers.mjs <bundle.js> <out.json> --policies base,..."
    );
    process.exit(2);
}
const bundle = readFileSync(bundlePath, "utf8");

const rows = [];
const versions = {};
for (const [name, type] of Object.entries({ chromium, firefox })) {
    const browser = await type.launch();
    versions[name] = browser.version();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: bundle });
    for (let round = 0; round < rounds; round++) {
        for (const index of positions) {
            const offset = index === "field" ? positions.length : index;
            const order = policies.map(
                (_, i) => policies[(i + round + offset) % policies.length]
            );
            for (const policy of order) {
                const row = await page.evaluate(
                    ({ index, iterations, policy, fixture }) => {
                        const bench = window.__brainBench.rollout;
                        const r =
                            index === "field"
                                ? bench.runField(
                                      fixture,
                                      { iterations },
                                      policy
                                  )
                                : bench.run(index, { iterations }, policy);
                        return {
                            completed: r.completed,
                            wallMs: r.wallMs,
                            move: r.move,
                        };
                    },
                    {
                        index,
                        iterations:
                            index === "field" ? fieldIterations : iterations,
                        policy,
                        fixture: index === "field" ? fixture : null,
                    }
                );
                rows.push({
                    engine: name,
                    round,
                    index,
                    policy,
                    ...row,
                    load: Number(loadavg()[0].toFixed(1)),
                });
            }
        }
        process.stderr.write(`${name} round ${round + 1}/${rounds}\n`);
    }
    await browser.close();
}

const ratios = {};
for (const engine of Object.keys(versions)) {
    ratios[engine] = {};
    for (const policy of policies.slice(1)) {
        const ratioAt = (index) => {
            const per = [];
            for (let round = 1; round < rounds; round++) {
                const at = (p) =>
                    rows.find(
                        (r) =>
                            r.engine === engine &&
                            r.round === round &&
                            r.index === index &&
                            r.policy === p
                    );
                const b = at("base");
                const h = at(policy);
                // A forced position has no search: no ratio.
                if (!b.completed || !h.completed) return null;
                per.push(h.wallMs / h.completed / (b.wallMs / b.completed));
            }
            return median(per);
        };
        const blade = positions
            .filter((index) => index !== "field")
            .map(ratioAt)
            .filter((ratio) => ratio !== null);
        ratios[engine][policy] = {
            blade: blade.length
                ? {
                      positions: blade.length,
                      p10: percentile(blade, 10),
                      median: median(blade),
                      min: Math.min(...blade),
                      max: Math.max(...blade),
                      p90: percentile(blade, 90),
                  }
                : null,
            field: fixture ? ratioAt("field") : null,
        };
    }
}

writeFileSync(
    out,
    JSON.stringify(
        {
            versions,
            cpus: cpus().length,
            iterations,
            fieldIterations: fixture ? fieldIterations : null,
            field: fixture?.label ?? null,
            positions,
            ratios,
            rows,
        },
        null,
        1
    )
);
console.log(JSON.stringify({ versions, ratios }, null, 1));
